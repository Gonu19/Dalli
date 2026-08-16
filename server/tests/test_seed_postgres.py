from datetime import date
import os
from uuid import uuid4

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
    PLAN_PLANNED_ID,
    PLAN_SKIPPED_ID,
    PRIMARY_DEVICE_UUID,
    PRIMARY_USER_ID,
    REPORT_ID,
    RUN_APP_NO_PLAN_ID,
    RUN_LINKED_ID,
    RUN_MANUAL_ID,
    RUN_MONTH_BOUNDARY_ID,
    RUN_OTHER_USER_ID,
    SECONDARY_USER_ID,
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
    collision_user_id = uuid4()
    general_user_id = uuid4()
    with Session(seed_postgres_engine) as session:
        original_primary = session.get(User, PRIMARY_USER_ID)
        original_primary_state = {
            "exists": original_primary is not None,
            "device_uuid": original_primary.device_uuid if original_primary is not None else None,
        }
        session.add(
            User(
                id=general_user_id,
                device_uuid=f"general-{uuid4()}",
                running_purpose="HABIT",
            )
        )
        session.commit()
        run_seed(app_env="test", session=session)
        baseline_counts = _counts(session)
        baseline_primary = session.get(User, PRIMARY_USER_ID)
        assert baseline_primary is not None
        baseline_primary_device_uuid = baseline_primary.device_uuid
        assert baseline_primary_device_uuid == PRIMARY_DEVICE_UUID
        baseline_general = session.get(User, general_user_id)
        assert baseline_general is not None
        fixed_ids = (
            (User, PRIMARY_USER_ID),
            (User, SECONDARY_USER_ID),
            (Plan, PLAN_DONE_ID),
            (Plan, PLAN_PLANNED_ID),
            (Plan, PLAN_SKIPPED_ID),
            (Run, RUN_LINKED_ID),
            (Run, RUN_APP_NO_PLAN_ID),
            (Run, RUN_MANUAL_ID),
            (Run, RUN_MONTH_BOUNDARY_ID),
            (Run, RUN_OTHER_USER_ID),
            (Report, REPORT_ID),
        )

        def fixed_counts() -> tuple[int, ...]:
            return tuple(
                session.scalar(
                    select(func.count()).select_from(model).where(model.id == entity_id)
                )
                for model, entity_id in fixed_ids
            )

        baseline_fixed_counts = fixed_counts()
        collision_prepared = False
        try:
            existing = session.get(User, PRIMARY_USER_ID)
            assert existing is not None
            existing.device_uuid = f"changed-{uuid4()}"
            session.add(User(id=collision_user_id, device_uuid=PRIMARY_DEVICE_UUID))
            session.commit()
            collision_prepared = True
            with pytest.raises(SeedError, match="device_uuid 충돌"):
                run_seed(app_env="test", session=session)
        finally:
            session.rollback()
            collision_users = session.scalars(
                select(User).where(User.id == collision_user_id)
            ).all()
            if collision_prepared and len(collision_users) != 1:
                pytest.fail(
                    "collision 사용자 cleanup 대상이 정확히 1개가 아닙니다: "
                    f"{len(collision_users)}"
                )
            if len(collision_users) > 1:
                pytest.fail(
                    "collision 사용자 cleanup 대상이 여러 개입니다: "
                    f"{len(collision_users)}"
                )
            if collision_users:
                session.delete(collision_users[0])
                session.flush()
            if session.scalar(
                select(func.count()).select_from(User).where(User.id == collision_user_id)
            ) != 0:
                pytest.fail("collision 사용자 DELETE가 DB에 반영되지 않았습니다.")

            restored = session.get(User, PRIMARY_USER_ID)
            if restored is None:
                pytest.fail("고정 Seed 사용자가 cleanup 후 존재하지 않습니다.")
            restored.device_uuid = baseline_primary_device_uuid
            session.commit()
            session.expire_all()

        primary_rows = session.scalars(
            select(User).where(User.id == PRIMARY_USER_ID)
        ).all()
        assert len(primary_rows) == 1
        primary_device_rows = session.scalars(
            select(User).where(User.device_uuid == baseline_primary_device_uuid)
        ).all()
        assert len(primary_device_rows) == 1
        assert primary_device_rows[0].id == PRIMARY_USER_ID
        assert session.scalar(
            select(func.count()).select_from(User).where(User.id == collision_user_id)
        ) == 0
        assert _counts(session) == baseline_counts
        assert fixed_counts() == baseline_fixed_counts
        general_after_cleanup = session.get(User, general_user_id)
        assert general_after_cleanup is not None
        assert general_after_cleanup.running_purpose == baseline_general.running_purpose
        assert original_primary_state["exists"] == (
            original_primary_state["device_uuid"] is not None
        )

        run_seed(app_env="test", session=session)
        assert _counts(session) == baseline_counts
        assert fixed_counts() == baseline_fixed_counts
        session.expire_all()
        assert session.get(User, PRIMARY_USER_ID).device_uuid == baseline_primary_device_uuid
        assert session.get(User, general_user_id).running_purpose == "HABIT"


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
