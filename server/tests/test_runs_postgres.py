from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
import json
import os
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import Plan, Run
from app.services.auth import decode_access_token


@pytest.fixture(scope="module")
def postgres_runs_environment():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; runs integration tests skipped")
    if "test" not in (make_url(database_url).database or "").lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")
    previous = {name: os.environ.get(name) for name in ("DATABASE_URL", "JWT_SECRET")}
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = "postgres-runs-test-secret-with-32-bytes"
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
    subject = decode_access_token(token, "postgres-runs-test-secret-with-32-bytes")["sub"]
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
