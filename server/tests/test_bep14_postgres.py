from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import Plan, Report, Run
from app.services.auth import decode_access_token


@pytest.fixture(scope="module")
def bep14_postgres_engine():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; BE-P14 PostgreSQL tests skipped")
    if "test" not in (make_url(database_url).database or "").lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")
    previous = {name: os.environ.get(name) for name in ("DATABASE_URL", "JWT_SECRET")}
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = "bep14-postgres-test-secret-with-32-bytes"
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


def _auth(device: str) -> tuple[str, UUID]:
    with TestClient(create_app()) as client:
        response = client.post("/auth/device", json={"device_uuid": device})
    token = response.json()["access_token"]
    user_id = UUID(
        decode_access_token(token, "bep14-postgres-test-secret-with-32-bytes")["sub"]
    )
    return token, user_id


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _manual(key: str, started_at: str, plan_id: str | None = None) -> dict:
    return {
        "client_run_id": key,
        "source": "MANUAL",
        "plan_id": plan_id,
        "started_at": started_at,
        "duration_sec": 900,
        "completed": True,
    }


def _app(key: str, started_at: str, plan_id: str | None = None, completed: bool = True) -> dict:
    fixture_path = Path(__file__).resolve().parents[2] / "docs" / "mock-data" / "api-fixtures.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    payload = deepcopy(fixture["requests"]["create_app_run_minimum_analyzable"])
    payload.update(client_run_id=key, started_at=started_at, plan_id=plan_id, completed=completed)
    return payload


@pytest.mark.postgres
def test_run_queries_cursor_ownership_report_and_hard_delete(bep14_postgres_engine) -> None:
    token, user_id = _auth(f"bep14-runs-a-{uuid4()}")
    other_token, _ = _auth(f"bep14-runs-b-{uuid4()}")
    same_time = "2026-08-15T01:00:00Z"
    with TestClient(create_app()) as client:
        plan = client.post(
            "/plans",
            json={"planned_date": "2026-08-15", "goal_type": "TIME", "goal_value": 180},
            headers=_headers(token),
        )
        assert plan.status_code == 201
        plan_id = plan.json()["id"]
        created = [
            client.post(
                "/runs",
                json=_app(f"page-{uuid4()}", same_time, plan_id if index == 0 else None),
                headers=_headers(token),
            )
            for index in range(3)
        ]
        run_id = created[0].json()["id"]
        report = client.post(f"/runs/{run_id}/report", headers=_headers(token))
        assert report.status_code in (200, 201)

        seen: list[str] = []
        cursor = None
        while True:
            params = {"limit": 1}
            if cursor:
                params["cursor"] = cursor
            page = client.get("/runs", params=params, headers=_headers(token)).json()
            seen.extend(item["id"] for item in page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        expected = {response.json()["id"] for response in created}
        assert set(seen) >= expected
        assert len(seen) == len(set(seen))

        listing = client.get("/runs", headers=_headers(token)).json()["items"]
        assert next(item for item in listing if item["id"] == run_id)["has_report"] is True
        detail = client.get(f"/runs/{run_id}", headers=_headers(token))
        assert detail.status_code == 200 and detail.json()["report"]["run_id"] == run_id
        assert client.get(f"/runs/{run_id}", headers=_headers(other_token)).status_code == 404
        assert client.delete(f"/runs/{run_id}", headers=_headers(other_token)).status_code == 404
        deleted = client.delete(f"/runs/{run_id}", headers=_headers(token))
        assert deleted.status_code == 204 and deleted.content == b""

    with Session(bep14_postgres_engine) as session:
        assert session.get(Run, UUID(run_id)) is None
        assert session.scalar(select(Report).where(Report.run_id == UUID(run_id))) is None
        stored_plan = session.get(Plan, UUID(plan_id))
        assert stored_plan is not None and stored_plan.status == "DONE" and stored_plan.run is None
        assert session.scalar(select(Run).where(Run.user_id == user_id)) is not None


@pytest.mark.postgres
def test_plan_crud_ownership_delete_link_and_concurrent_date_constraint(bep14_postgres_engine) -> None:
    token, _ = _auth(f"bep14-plans-a-{uuid4()}")
    other_token, _ = _auth(f"bep14-plans-b-{uuid4()}")
    with TestClient(create_app()) as client:
        created = client.post(
            "/plans",
            json={"planned_date": "2026-08-20", "goal_type": "TIME", "goal_value": 1200, "memo": "저녁"},
            headers=_headers(token),
        )
        assert created.status_code == 201
        plan_id = created.json()["id"]
        assert client.patch(f"/plans/{plan_id}", json={"status": "SKIPPED"}, headers=_headers(other_token)).status_code == 404
        patched = client.patch(
            f"/plans/{plan_id}", json={"status": "PLANNED", "goal_type": "DISTANCE", "goal_value": 3000}, headers=_headers(token)
        )
        assert patched.status_code == 200 and patched.json()["goal_value"] == 3000
        listed = client.get(
            "/plans", params={"from": "2026-08-20", "to": "2026-08-20"}, headers=_headers(token)
        )
        assert listed.status_code == 200 and [item["id"] for item in listed.json()["items"]] == [plan_id]
        linked = client.post(
            "/runs", json=_manual(f"linked-{uuid4()}", "2026-08-20T01:00:00Z", plan_id), headers=_headers(token)
        )
        assert linked.status_code == 201
        run_id = linked.json()["id"]
        assert client.delete(f"/plans/{plan_id}", headers=_headers(other_token)).status_code == 404
        assert client.delete(f"/plans/{plan_id}", headers=_headers(token)).status_code == 204

    with Session(bep14_postgres_engine) as session:
        assert session.get(Plan, UUID(plan_id)) is None
        assert session.get(Run, UUID(run_id)).plan_id is None

    barrier = Barrier(2)

    def create_competing(index: int) -> int:
        barrier.wait()
        with TestClient(create_app()) as client:
            return client.post(
                "/plans",
                json={"planned_date": "2026-08-21", "goal_type": "TIME", "goal_value": 600 + index},
                headers=_headers(token),
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(create_competing, range(2)))
    assert sorted(statuses) == [201, 409]


@pytest.mark.postgres
def test_calendar_and_stats_kst_day_aggregation(bep14_postgres_engine) -> None:
    token, _ = _auth(f"bep14-aggregate-{uuid4()}")
    with TestClient(create_app()) as client:
        plan_only = client.post(
            "/plans",
            json={"planned_date": "2026-08-17", "goal_type": "TIME", "goal_value": 600},
            headers=_headers(token),
        )
        both = client.post(
            "/plans",
            json={"planned_date": "2026-08-18", "goal_type": "DISTANCE", "goal_value": 2000},
            headers=_headers(token),
        )
        assert plan_only.status_code == both.status_code == 201
        runs = [
            _manual(f"manual-{uuid4()}", "2026-08-15T15:30:00Z"),
            _app(f"app-{uuid4()}", "2026-08-15T16:00:00Z", completed=False),
            _app(f"both-{uuid4()}", "2026-08-18T01:00:00Z", both.json()["id"]),
        ]
        for payload in runs:
            assert client.post("/runs", json=payload, headers=_headers(token)).status_code == 201

        calendar = client.get("/calendar", params={"year": 2026, "month": 8}, headers=_headers(token))
        assert calendar.status_code == 200
        days = {item["date"]: item for item in calendar.json()["days"]}
        assert days["2026-08-16"]["plan"] is None and len(days["2026-08-16"]["runs"]) == 2
        assert days["2026-08-17"]["plan"] is not None and days["2026-08-17"]["runs"] == []
        assert days["2026-08-18"]["plan"] is not None and len(days["2026-08-18"]["runs"]) == 1
        assert client.get("/calendar", params={"year": 2025, "month": 1}, headers=_headers(token)).json() == {"days": []}
        assert client.get("/calendar", params={"year": 2026, "month": 13}, headers=_headers(token)).status_code == 422

        stats = client.get("/stats", headers=_headers(token))
        assert stats.status_code == 200
        body = stats.json()
        assert body["total_run_days"] == 2
        assert body["dalli_days"] == 2
        assert body["this_month_days"] == 2
        assert body["next_milestone"] == 10
        assert body["recent_run"]["date"] == "2026-08-18"


@pytest.mark.postgres
def test_bep14_requires_authentication(bep14_postgres_engine) -> None:
    with TestClient(create_app()) as client:
        for method, path in [
            ("get", "/runs"),
            ("get", "/plans?from=2026-08-01&to=2026-08-31"),
            ("get", "/calendar?year=2026&month=8"),
            ("get", "/stats"),
        ]:
            assert getattr(client, method)(path).status_code == 401
