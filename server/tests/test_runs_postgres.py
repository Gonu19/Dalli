from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import Plan, Run, User
from app.services.auth import decode_access_token

TEST_JWT_SECRET = "postgres-runs-test-secret-with-32-bytes"


@pytest.fixture(scope="module")
def postgres_runs_environment():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; runs integration tests skipped")
    if "test" not in (make_url(database_url).database or "").lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")
    previous = {name: os.environ.get(name) for name in ("DATABASE_URL", "JWT_SECRET")}
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = TEST_JWT_SECRET
    clear_settings_cache()
    clear_database_caches()
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()
        clear_database_caches()
        command.downgrade(Config("alembic.ini"), "base")
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        clear_settings_cache()


def authenticate(device: str) -> tuple[str, UUID]:
    with TestClient(create_app()) as client:
        response = client.post("/auth/device", json={"device_uuid": device})
    token = response.json()["access_token"]
    subject = decode_access_token(token, SecretStr(TEST_JWT_SECRET))["sub"]
    return token, UUID(subject)


def manual_payload(client_run_id: str, plan_id: str | None = None) -> dict:
    return {
        "client_run_id": client_run_id,
        "source": "MANUAL",
        "plan_id": plan_id,
        "started_at": "2026-08-15T00:00:00Z",
        "duration_sec": 900,
    }


def app_payload(client_run_id: str) -> dict:
    fixture_path = (
        Path(__file__).resolve().parents[2] / "docs" / "mock-data" / "api-fixtures.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    payload = deepcopy(fixture["requests"]["create_app_run_minimum_analyzable"])
    payload["client_run_id"] = client_run_id
    return payload


def concurrent_posts(token: str, payloads: list[dict]) -> list[tuple[int, str]]:
    barrier = Barrier(len(payloads))

    def post(payload: dict) -> tuple[int, str]:
        barrier.wait()
        with TestClient(create_app()) as client:
            response = client.post(
                "/runs", json=payload, headers={"Authorization": f"Bearer {token}"}
            )
        return response.status_code, response.json().get("id", "")

    with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
        return list(pool.map(post, payloads))


@pytest.mark.postgres
def test_app_run_repeat_returns_existing_row_without_applying_changed_body(
    postgres_runs_environment,
) -> None:
    token, user_id = authenticate(f"runs-repeat-{uuid4()}")
    key = f"repeat-{uuid4()}"
    first_payload = app_payload(key)
    with TestClient(create_app()) as client:
        first = client.post(
            "/runs", json=first_payload, headers={"Authorization": f"Bearer {token}"}
        )
        changed = app_payload(key)
        changed.update(duration_sec=999, distance_m=9999, memo="must not replace")
        second = client.post(
            "/runs", json=changed, headers={"Authorization": f"Bearer {token}"}
        )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["rhythm_score"] == second.json()["rhythm_score"] == 0.722
    assert first.json()["late_drop_rate"] is second.json()["late_drop_rate"] is None
    assert first.json()["fatigue_index"] is second.json()["fatigue_index"] is None
    assert first.json()["client_run_id"] == second.json()["client_run_id"] == key
    assert first.json()["created_at"] == second.json()["created_at"]
    with Session(postgres_runs_environment) as session:
        runs = session.scalars(
            select(Run).where(Run.user_id == user_id, Run.client_run_id == key)
        ).all()
    assert len(runs) == 1
    assert runs[0].duration_sec == first_payload["duration_sec"]
    assert runs[0].distance_m == first_payload["distance_m"]
    assert runs[0].memo == first_payload["memo"]
    assert runs[0].samples == first_payload["samples"]
    assert runs[0].events == first_payload["events"]
    assert runs[0].rhythm_score == Decimal("0.722")
    assert runs[0].late_drop_rate is None
    assert runs[0].fatigue_index is None


@pytest.mark.postgres
def test_six_minute_app_run_persists_numeric_metrics(postgres_runs_environment) -> None:
    token, user_id = authenticate(f"runs-metrics-{uuid4()}")
    key = f"metrics-{uuid4()}"
    payload = app_payload(key)
    payload["duration_sec"] = 360
    payload["goal_value"] = 360
    payload["ended_at"] = "2026-08-14T09:06:00Z"
    payload["samples"] = [
        {"t": t, "c": 160 if t < 240 else 144, "p": None, "d": None}
        for t in range(0, 360, 5)
    ]
    payload["events"] = [
        {"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}},
        {"t": 240, "type": "TARGET_ADJUSTED", "payload": {"min": 140, "max": 148, "reason": "no_recovery"}},
        {"t": 360, "type": "RUN_END", "payload": {"completed": True}},
    ]

    with TestClient(create_app()) as client:
        response = client.post(
            "/runs", json=payload, headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 201
    assert response.json()["rhythm_score"] == 1.0
    assert response.json()["late_drop_rate"] == 0.1
    assert response.json()["fatigue_index"] == 0.14
    with Session(postgres_runs_environment) as session:
        stored = session.scalar(
            select(Run).where(Run.user_id == user_id, Run.client_run_id == key)
        )
    assert stored is not None
    assert stored.rhythm_score == Decimal("1.000")
    assert stored.late_drop_rate == Decimal("0.100")
    assert stored.fatigue_index == Decimal("0.140")


@pytest.mark.postgres
def test_first_eligible_app_run_auto_persists_baseline_and_later_runs_do_not_overwrite(
    postgres_runs_environment,
) -> None:
    token, user_id = authenticate(f"runs-baseline-{uuid4()}")

    def payload(client_run_id: str, cadence: int) -> dict:
        value = app_payload(client_run_id)
        value.update(
            duration_sec=360,
            goal_value=360,
            samples=[{"t": t, "c": cadence, "p": None, "d": None} for t in range(0, 360, 5)],
            events=[
                {"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}},
                {"t": 360, "type": "RUN_END", "payload": {"completed": True}},
            ],
        )
        return value

    with TestClient(create_app()) as client:
        first = client.post(
            "/runs",
            json=payload(f"baseline-first-{uuid4()}", 157),
            headers={"Authorization": f"Bearer {token}"},
        )
        second = client.post(
            "/runs",
            json=payload(f"baseline-second-{uuid4()}", 170),
            headers={"Authorization": f"Bearer {token}"},
        )

    assert first.status_code == 201
    assert second.status_code == 201
    assert "baseline_cadence" not in first.json()
    with Session(postgres_runs_environment) as session:
        stored_user = session.get(User, user_id)
    assert stored_user is not None
    assert stored_user.baseline_cadence == 157


@pytest.mark.postgres
def test_metric_numeric_columns_store_zero_one_middle_and_null_boundaries(
    postgres_runs_environment,
) -> None:
    _, user_id = authenticate(f"runs-metric-boundaries-{uuid4()}")
    metric_sets = [
        (Decimal("0"), Decimal("0"), Decimal("0")),
        (Decimal("1"), Decimal("1"), Decimal("1")),
        (Decimal("0.5555"), Decimal("0.4444"), Decimal("0.3333")),
        (None, None, None),
    ]
    run_ids = []
    with Session(postgres_runs_environment) as session:
        for rhythm, late_drop, fatigue in metric_sets:
            stored = Run(
                user_id=user_id,
                client_run_id=f"metric-boundary-{uuid4()}",
                source="APP",
                started_at=datetime(2026, 8, 15, tzinfo=timezone.utc),
                duration_sec=600,
                active_duration_sec=600,
                completed=True,
                rhythm_score=rhythm,
                late_drop_rate=late_drop,
                fatigue_index=fatigue,
                samples=[],
                events=[],
            )
            session.add(stored)
            session.flush()
            run_ids.append(stored.id)
        session.commit()

    with Session(postgres_runs_environment) as session:
        rows = [session.get(Run, run_id) for run_id in run_ids]

    assert rows[0] is not None
    assert (rows[0].rhythm_score, rows[0].late_drop_rate, rows[0].fatigue_index) == (
        Decimal("0.000"), Decimal("0.000"), Decimal("0.000")
    )
    assert rows[1] is not None
    assert (rows[1].rhythm_score, rows[1].late_drop_rate, rows[1].fatigue_index) == (
        Decimal("1.000"), Decimal("1.000"), Decimal("1.000")
    )
    assert rows[2] is not None
    assert (rows[2].rhythm_score, rows[2].late_drop_rate, rows[2].fatigue_index) == (
        Decimal("0.556"), Decimal("0.444"), Decimal("0.333")
    )
    assert rows[3] is not None
    assert (rows[3].rhythm_score, rows[3].late_drop_rate, rows[3].fatigue_index) == (
        None, None, None
    )


@pytest.mark.postgres
def test_same_client_run_id_is_scoped_per_user(postgres_runs_environment) -> None:
    key = f"per-user-{uuid4()}"
    token_a, user_a = authenticate(f"runs-user-a-{uuid4()}")
    token_b, user_b = authenticate(f"runs-user-b-{uuid4()}")
    with TestClient(create_app()) as client:
        response_a = client.post(
            "/runs", json=manual_payload(key), headers={"Authorization": f"Bearer {token_a}"}
        )
        response_b = client.post(
            "/runs", json=manual_payload(key), headers={"Authorization": f"Bearer {token_b}"}
        )

    assert response_a.status_code == response_b.status_code == 201
    assert response_a.json()["id"] != response_b.json()["id"]
    with Session(postgres_runs_environment) as session:
        runs = session.scalars(select(Run).where(Run.client_run_id == key)).all()
    assert len(runs) == 2
    assert {run.user_id for run in runs} == {user_a, user_b}


@pytest.mark.postgres
def test_manual_run_defaults_completed_and_persists_nullable_contract(
    postgres_runs_environment,
) -> None:
    token, user_id = authenticate(f"runs-manual-{uuid4()}")
    key = f"manual-{uuid4()}"
    with TestClient(create_app()) as client:
        response = client.post(
            "/runs", json=manual_payload(key), headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 201
    assert response.json()["is_analyzable"] is False
    assert response.json()["analysis_limitation"] == "MANUAL_RUN"
    assert response.json()["rhythm_score"] is None
    with Session(postgres_runs_environment) as session:
        run = session.scalar(
            select(Run).where(Run.user_id == user_id, Run.client_run_id == key)
        )
    assert run is not None and run.completed is True
    for field in (
        "goal_type", "goal_value", "target_cadence_min", "target_cadence_max",
        "final_target_min", "final_target_max", "avg_cadence", "avg_pace_sec_per_km",
        "rhythm_score", "late_drop_rate", "fatigue_index", "intervention_count",
        "downshift_count", "samples", "events",
    ):
        assert getattr(run, field) is None


@pytest.mark.postgres
def test_same_client_run_concurrency_returns_one_resource(postgres_runs_environment):
    token, user_id = authenticate(f"runs-idempotency-{uuid4()}")
    key = f"same-{uuid4()}"
    results = concurrent_posts(token, [manual_payload(key), manual_payload(key)])

    assert sorted(status for status, _ in results) == [200, 201]
    assert len({run_id for _, run_id in results}) == 1
    with Session(postgres_runs_environment) as session:
        count = session.scalar(select(func.count()).select_from(Run).where(Run.user_id == user_id, Run.client_run_id == key))
    assert count == 1


@pytest.mark.postgres
def test_plan_concurrency_has_no_orphan_run(postgres_runs_environment):
    token, user_id = authenticate(f"runs-plan-{uuid4()}")
    with Session(postgres_runs_environment) as session:
        plan = Plan(user_id=user_id, planned_date=date(2026, 8, 15), status="PLANNED")
        session.add(plan)
        session.commit()
        plan_id = str(plan.id)
    keys = [f"plan-a-{uuid4()}", f"plan-b-{uuid4()}"]
    results = concurrent_posts(token, [manual_payload(keys[0], plan_id), manual_payload(keys[1], plan_id)])

    assert sorted(status for status, _ in results) == [201, 409]
    with Session(postgres_runs_environment) as session:
        runs = session.scalars(select(Run).where(Run.client_run_id.in_(keys))).all()
        stored_plan = session.get(Plan, UUID(plan_id))
    assert len(runs) == 1 and runs[0].plan_id is not None
    assert stored_plan is not None and stored_plan.status == "DONE"
