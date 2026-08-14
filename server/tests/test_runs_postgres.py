from concurrent.futures import ThreadPoolExecutor
from datetime import date
import os
from threading import Barrier
from uuid import uuid4

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


def authenticate(device: str) -> tuple[str, str]:
    with TestClient(create_app()) as client:
        response = client.post("/auth/device", json={"device_uuid": device})
    token = response.json()["access_token"]
    return token, decode_access_token(token, "postgres-runs-test-secret-with-32-bytes")["sub"]


def manual_payload(client_run_id: str, plan_id: str | None = None) -> dict:
    return {
        "client_run_id": client_run_id,
        "source": "MANUAL",
        "plan_id": plan_id,
        "started_at": "2026-08-15T00:00:00Z",
        "duration_sec": 900,
    }


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
        stored_plan = session.get(Plan, plan_id)
    assert len(runs) == 1 and runs[0].plan_id is not None
    assert stored_plan is not None and stored_plan.status == "DONE"
