from datetime import date
import os
from uuid import UUID, uuid4

import pytest
import httpx
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import Plan, Report, Run, User
from app.seed import (
    PLAN_DONE_ID,
    PRIMARY_DEVICE_UUID,
    PRIMARY_USER_ID,
    REPORT_ID,
    RUN_LINKED_ID,
    RUN_MANUAL_ID,
    SeedError,
    run_seed,
)


@pytest.fixture(scope="module")
def seed_postgres_engine():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; seed PostgreSQL tests skipped")
    if "test" not in (make_url(database_url).database or "").lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")
    previous = {name: os.environ.get(name) for name in ("DATABASE_URL", "JWT_SECRET", "OPENAI_API_KEY")}
    os.environ.update(
        DATABASE_URL=database_url,
        JWT_SECRET="seed-postgres-test-secret-with-32-bytes",
        OPENAI_API_KEY="",
    )
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


def _counts(session: Session) -> tuple[int, int, int, int]:
    return tuple(
        session.scalar(select(func.count()).select_from(model))
        for model in (User, Plan, Run, Report)
    )


@pytest.mark.postgres
def test_seed_is_idempotent_preserves_general_data_and_relationships(seed_postgres_engine) -> None:
    general_id = uuid4()
    with Session(seed_postgres_engine) as session:
        session.add(User(id=general_id, device_uuid=f"general-{uuid4()}", running_purpose="HABIT"))
        session.commit()
        run_seed(app_env="test", session=session)
        first_counts = _counts(session)

        session.get(Run, RUN_LINKED_ID).plan_id = None
        session.get(Plan, PLAN_DONE_ID).status = "SKIPPED"
        session.get(Report, REPORT_ID).verdict = "변경된 값"
        session.commit()
        run_seed(app_env="test", session=session)
        second_counts = _counts(session)

        assert first_counts == second_counts == (3, 3, 5, 1)
        assert session.get(User, general_id).running_purpose == "HABIT"
        assert session.get(User, PRIMARY_USER_ID).device_uuid == PRIMARY_DEVICE_UUID
        assert session.get(Run, RUN_LINKED_ID).plan_id == PLAN_DONE_ID
        assert session.get(Plan, PLAN_DONE_ID).status == "DONE"
        assert session.get(Report, REPORT_ID).run_id == RUN_LINKED_ID
        assert session.get(Report, REPORT_ID).verdict == "오늘의 리듬을 무리 없이 이어간 러닝이에요."
        assert session.get(Run, RUN_MANUAL_ID).source == "MANUAL"


@pytest.mark.postgres
def test_seed_refuses_identifier_collision(seed_postgres_engine) -> None:
    with Session(seed_postgres_engine) as session:
        run_seed(app_env="test", session=session)
        expected_counts = _counts(session)
        existing = session.get(User, PRIMARY_USER_ID)
        try:
            existing.device_uuid = f"changed-{uuid4()}"
            session.add(User(device_uuid=PRIMARY_DEVICE_UUID))
            session.commit()
            with pytest.raises(SeedError, match="device_uuid 충돌"):
                run_seed(app_env="test", session=session)
        finally:
            session.rollback()
            collision_user = session.scalar(
                select(User).where(
                    User.device_uuid == PRIMARY_DEVICE_UUID,
                    User.id != PRIMARY_USER_ID,
                )
            )
            if collision_user is not None:
                session.delete(collision_user)
                session.flush()
            existing = session.get(User, PRIMARY_USER_ID)
            existing.device_uuid = PRIMARY_DEVICE_UUID
            session.commit()

        assert session.get(User, PRIMARY_USER_ID).device_uuid == PRIMARY_DEVICE_UUID
        assert session.scalar(
            select(func.count()).select_from(User).where(User.device_uuid == PRIMARY_DEVICE_UUID)
        ) == 1
        run_seed(app_env="test", session=session)
        assert _counts(session) == expected_counts


@pytest.mark.postgres
def test_seed_data_is_visible_through_authenticated_apis(seed_postgres_engine) -> None:
    with Session(seed_postgres_engine) as session:
        run_seed(app_env="test", session=session)
    with TestClient(create_app()) as client:
        auth = client.post("/auth/device", json={"device_uuid": PRIMARY_DEVICE_UUID})
        assert auth.status_code == 200 and auth.json()["is_new_user"] is False
        headers = {"Authorization": f"Bearer {auth.json()['access_token']}"}

        runs = client.get("/runs", headers=headers)
        assert runs.status_code == 200 and len(runs.json()["items"]) == 4
        detail = client.get(f"/runs/{RUN_LINKED_ID}", headers=headers)
        assert detail.status_code == 200 and detail.json()["report"]["is_fallback"] is True

        plans = client.get(
            "/plans", params={"from": "2026-08-01", "to": "2026-09-30"}, headers=headers
        )
        assert plans.status_code == 200 and len(plans.json()["items"]) == 3
        assert next(item for item in plans.json()["items"] if item["id"] == str(PLAN_DONE_ID))["run_id"] == str(RUN_LINKED_ID)

        august = client.get("/calendar", params={"year": 2026, "month": 8}, headers=headers)
        september = client.get("/calendar", params={"year": 2026, "month": 9}, headers=headers)
        assert august.status_code == september.status_code == 200
        assert {day["date"] for day in august.json()["days"]} == {"2026-08-14", "2026-08-15", "2026-08-16"}
        assert {day["date"] for day in september.json()["days"]} == {"2026-09-01"}

        stats = client.get("/stats", headers=headers)
        assert stats.status_code == 200
        assert stats.json()["total_run_days"] == 3
        assert stats.json()["dalli_days"] == 3
        assert stats.json()["next_milestone"] == 10


@pytest.mark.postgres
def test_seed_requires_current_alembic_head(seed_postgres_engine, monkeypatch) -> None:
    from app import seed as seed_module

    monkeypatch.setattr(seed_module.ScriptDirectory, "get_heads", lambda self: ["future_head"])
    with Session(seed_postgres_engine) as session, pytest.raises(SeedError, match="최신 head"):
        run_seed(app_env="test", session=session)


@pytest.mark.postgres
def test_seed_does_not_call_external_http_or_llm(seed_postgres_engine, monkeypatch) -> None:
    def fail_request(*args, **kwargs):
        raise AssertionError("seed must not call external HTTP")

    monkeypatch.setattr(httpx.Client, "request", fail_request)
    monkeypatch.setattr(httpx.AsyncClient, "request", fail_request)
    with Session(seed_postgres_engine) as session:
        summary = run_seed(app_env="test", session=session)
    assert summary.reports == 1
