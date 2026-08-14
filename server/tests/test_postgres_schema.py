from __future__ import annotations

import os
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.models import Plan, Report, Run, User


@pytest.fixture(scope="module")
def postgres_engine() -> Engine:
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; PostgreSQL integration test skipped")
    database_name = make_url(database_url).database or ""
    if "test" not in database_name.lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")

    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    os.environ.setdefault("JWT_SECRET", "integration-test-secret")
    os.environ.setdefault("OPENAI_API_KEY", "")
    clear_settings_cache()
    alembic_config = Config("alembic.ini")
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()
        command.downgrade(alembic_config, "base")
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url
        clear_settings_cache()


def _user(session: Session, device_uuid: str) -> User:
    user = User(device_uuid=device_uuid)
    session.add(user)
    session.flush()
    return user


def _run(session: Session, user: User, client_run_id: str, **values) -> Run:
    run = Run(
        user_id=user.id,
        client_run_id=client_run_id,
        source="APP",
        started_at=datetime.now(timezone.utc),
        duration_sec=600,
        **values,
    )
    session.add(run)
    session.flush()
    return run


def test_migration_round_trip_and_autogenerate_check(postgres_engine: Engine) -> None:
    config = Config("alembic.ini")
    command.check(config)
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    assert set(inspect(postgres_engine).get_table_names()) >= {
        "users", "plans", "runs", "reports", "alembic_version"
    }


def test_constraints_jsonb_numeric_and_delete_policies(postgres_engine: Engine) -> None:
    with Session(postgres_engine) as session:
        user = _user(session, f"device-{uuid4()}")
        other_user = _user(session, f"device-{uuid4()}")
        plan = Plan(user_id=user.id, planned_date=date(2026, 8, 20))
        session.add(plan)
        session.flush()
        run = _run(
            session,
            user,
            "shared-client-id",
            plan_id=plan.id,
            rhythm_score=Decimal("0.723"),
            samples=[{"t": 0, "c": 158, "p": None, "d": 0}],
            events=[{"t": 0, "type": "RUN_START", "payload": {}}],
        )
        report = Report(
            run_id=run.id,
            verdict="안정적인 러닝이에요",
            evidence=["안정 구간 72%"],
            next_goal_text="다음 목표",
            next_target_min=153,
            next_target_max=161,
        )
        session.add(report)
        session.commit()
        run_id, plan_id, report_id = run.id, plan.id, report.id

    with Session(postgres_engine) as session:
        stored = session.get(Run, run_id)
        assert stored is not None
        assert stored.samples == [{"t": 0, "c": 158, "p": None, "d": 0}]
        assert stored.events[0]["type"] == "RUN_START"
        assert stored.rhythm_score == Decimal("0.723")
        assert session.get(Report, report_id).evidence == ["안정 구간 72%"]
        other = session.scalar(select(User).where(User.device_uuid.like("device-%"), User.id != stored.user_id))
        _run(session, other, "shared-client-id")
        session.commit()

    with Session(postgres_engine) as session:
        session.delete(session.get(Plan, plan_id))
        session.commit()
        assert session.get(Run, run_id).plan_id is None

    with Session(postgres_engine) as session:
        session.delete(session.get(Run, run_id))
        session.commit()
        assert session.get(Report, report_id) is None


@pytest.mark.parametrize(
    ("model_factory", "constraint_name"),
    [
        (lambda user: User(device_uuid=str(uuid4()), running_purpose="INVALID"), "ck_users_running_purpose"),
        (lambda user: User(device_uuid=str(uuid4()), gender="X"), "ck_users_gender"),
        (lambda user: Run(user_id=user.id, client_run_id=str(uuid4()), source="INVALID", started_at=datetime.now(timezone.utc), duration_sec=1), "ck_runs_source"),
        (lambda user: Run(user_id=user.id, client_run_id=str(uuid4()), source="APP", goal_type="INVALID", started_at=datetime.now(timezone.utc), duration_sec=1), "ck_runs_goal_type"),
        (lambda user: Run(user_id=user.id, client_run_id=str(uuid4()), source="APP", condition=6, started_at=datetime.now(timezone.utc), duration_sec=1), "ck_runs_condition"),
        (lambda user: Plan(user_id=user.id, planned_date=date(2026, 8, 21), goal_type="INVALID"), "ck_plans_goal_type"),
        (lambda user: Plan(user_id=user.id, planned_date=date(2026, 8, 21), status="INVALID"), "ck_plans_status"),
    ],
)
def test_check_constraints(postgres_engine: Engine, model_factory, constraint_name: str) -> None:
    with pytest.raises(IntegrityError, match=constraint_name):
        with Session(postgres_engine) as session:
            user = _user(session, f"check-{uuid4()}")
            session.add(model_factory(user))
            session.commit()


def test_unique_constraints_and_user_cascade(postgres_engine: Engine) -> None:
    device_uuid = f"unique-{uuid4()}"
    with Session(postgres_engine) as session:
        user = _user(session, device_uuid)
        other = _user(session, f"other-{uuid4()}")
        plan = Plan(user_id=user.id, planned_date=date(2026, 8, 22))
        session.add(plan)
        session.flush()
        run = _run(session, user, "unique-run", plan_id=plan.id)
        session.commit()
        user_id, other_user_id = user.id, other.id
        run_id, plan_id = run.id, plan.id

    duplicate_cases = [
        User(device_uuid=device_uuid),
        Plan(user_id=user_id, planned_date=date(2026, 8, 22)),
        Run(user_id=user_id, client_run_id="unique-run", source="APP", started_at=datetime.now(timezone.utc), duration_sec=1),
        Run(user_id=user_id, client_run_id=str(uuid4()), source="APP", plan_id=plan_id, started_at=datetime.now(timezone.utc), duration_sec=1),
        Report(run_id=run_id, verdict="a", evidence=["a"], next_goal_text="a", next_target_min=1, next_target_max=2),
    ]
    with Session(postgres_engine) as session:
        session.add(Report(run_id=run_id, verdict="a", evidence=["a"], next_goal_text="a", next_target_min=1, next_target_max=2))
        session.commit()

    for duplicate in duplicate_cases:
        with pytest.raises(IntegrityError):
            with Session(postgres_engine) as session:
                session.add(duplicate)
                session.commit()

    with Session(postgres_engine) as session:
        session.add(Plan(user_id=other_user_id, planned_date=date(2026, 8, 22)))
        stored_user = session.get(User, user_id)
        _run(session, stored_user, str(uuid4()))
        _run(session, stored_user, str(uuid4()))
        session.commit()
        session.delete(session.get(User, user_id))
        session.commit()
        assert session.get(Run, run_id) is None
        assert session.get(Plan, plan_id) is None
