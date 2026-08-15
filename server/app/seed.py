from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import sys
from typing import Any
from uuid import UUID

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session_factory
from app.models import Plan, Report, Run, User


ALLOWED_SEED_ENVIRONMENTS = frozenset({"development", "test"})
SERVER_ROOT = Path(__file__).resolve().parents[1]


class SeedError(RuntimeError):
    pass


class SeedEnvironmentSettings(BaseSettings):
    app_env: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@dataclass(frozen=True)
class SeedSummary:
    users: int
    plans: int
    runs: int
    reports: int


PRIMARY_USER_ID = UUID("d1500000-0000-4000-8000-000000000001")
SECONDARY_USER_ID = UUID("d1500000-0000-4000-8000-000000000002")
PRIMARY_DEVICE_UUID = "dalli-seed-demo-device"
SECONDARY_DEVICE_UUID = "dalli-seed-ownership-device"

PLAN_DONE_ID = UUID("d1500000-0000-4000-8000-000000000101")
PLAN_PLANNED_ID = UUID("d1500000-0000-4000-8000-000000000102")
PLAN_SKIPPED_ID = UUID("d1500000-0000-4000-8000-000000000103")

RUN_LINKED_ID = UUID("d1500000-0000-4000-8000-000000000201")
RUN_APP_NO_PLAN_ID = UUID("d1500000-0000-4000-8000-000000000202")
RUN_MANUAL_ID = UUID("d1500000-0000-4000-8000-000000000203")
RUN_MONTH_BOUNDARY_ID = UUID("d1500000-0000-4000-8000-000000000204")
RUN_OTHER_USER_ID = UUID("d1500000-0000-4000-8000-000000000205")
REPORT_ID = UUID("d1500000-0000-4000-8000-000000000301")


def validate_seed_environment(app_env: str | None) -> str:
    normalized = app_env.strip().lower() if app_env else ""
    if normalized not in ALLOWED_SEED_ENVIRONMENTS:
        raise SeedError(
            "seed는 APP_ENV=development 또는 APP_ENV=test에서만 실행할 수 있습니다."
        )
    return normalized


def ensure_alembic_head(session: Session) -> None:
    config = Config(str(SERVER_ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    expected = set(script.get_heads())
    current = set(MigrationContext.configure(session.connection()).get_current_heads())
    if current != expected:
        raise SeedError(
            "Alembic migration이 최신 head가 아닙니다. "
            f"current={sorted(current)}, expected={sorted(expected)}"
        )


def _set_values(instance: Any, values: dict[str, Any]) -> None:
    for name, value in values.items():
        setattr(instance, name, value)


def _owned_entity(
    session: Session,
    model: type[Any],
    entity_id: UUID,
    values: dict[str, Any],
    *,
    owner_id: UUID | None = None,
) -> Any:
    instance = session.get(model, entity_id)
    if instance is not None and owner_id is not None and instance.user_id != owner_id:
        raise SeedError(f"seed 식별자 소유권 충돌: {model.__name__} {entity_id}")
    if instance is None:
        instance = model(id=entity_id, **values)
        session.add(instance)
    else:
        _set_values(instance, values)
    return instance


def _seed_user(session: Session, user_id: UUID, device_uuid: str, values: dict[str, Any]) -> User:
    by_device = session.scalar(select(User).where(User.device_uuid == device_uuid))
    if by_device is not None and by_device.id != user_id:
        raise SeedError(f"seed device_uuid 충돌: {device_uuid}")
    return _owned_entity(
        session,
        User,
        user_id,
        {"device_uuid": device_uuid, **values},
    )


def _samples(duration_sec: int, cadence: int) -> list[dict[str, int | None]]:
    return [
        {"t": second, "c": cadence, "p": 430, "d": round(second * 2.3)}
        for second in range(0, duration_sec, 5)
    ]


def seed_database(session: Session) -> SeedSummary:
    ensure_alembic_head(session)
    fixed_created_at = datetime(2026, 8, 10, tzinfo=timezone.utc)
    primary = _seed_user(
        session,
        PRIMARY_USER_ID,
        PRIMARY_DEVICE_UUID,
        {
            "running_purpose": "COMPLETE",
            "experience_level": 0,
            "max_continuous_min": 20,
            "weekly_goal_count": 3,
            "baseline_cadence": 157,
            "height_cm": 165,
            "weight_kg": Decimal("54.0"),
            "birth_year": 2004,
            "gender": "F",
            "created_at": fixed_created_at,
            "updated_at": fixed_created_at,
        },
    )
    secondary = _seed_user(
        session,
        SECONDARY_USER_ID,
        SECONDARY_DEVICE_UUID,
        {
            "running_purpose": "HABIT",
            "experience_level": 1,
            "max_continuous_min": 30,
            "weekly_goal_count": 2,
            "baseline_cadence": 154,
            "height_cm": None,
            "weight_kg": None,
            "birth_year": None,
            "gender": None,
            "created_at": fixed_created_at,
            "updated_at": fixed_created_at,
        },
    )

    plans = [
        (PLAN_DONE_ID, date(2026, 8, 14), "TIME", 1200, "저녁 러닝", "DONE"),
        (PLAN_PLANNED_ID, date(2026, 8, 16), "TIME", 1500, "아침 러닝", "PLANNED"),
        (PLAN_SKIPPED_ID, date(2026, 9, 1), "DISTANCE", 3000, None, "SKIPPED"),
    ]
    for plan_id, planned_date, goal_type, goal_value, memo, status in plans:
        _owned_entity(
            session,
            Plan,
            plan_id,
            {
                "user_id": primary.id,
                "planned_date": planned_date,
                "goal_type": goal_type,
                "goal_value": goal_value,
                "memo": memo,
                "status": status,
                "created_at": fixed_created_at,
                "updated_at": fixed_created_at,
            },
            owner_id=primary.id,
        )
    session.flush()

    common_app = {
        "source": "APP",
        "goal_type": "TIME",
        "condition": 3,
        "target_cadence_min": 153,
        "target_cadence_max": 161,
        "final_target_min": 153,
        "final_target_max": 161,
        "avg_cadence": 157,
        "avg_pace_sec_per_km": 430,
        "intervention_count": 0,
        "downshift_count": 0,
        "memo": None,
        "created_at": fixed_created_at,
    }
    run_specs = [
        (
            RUN_LINKED_ID,
            primary.id,
            "dalli-seed-app-linked",
            {
                **common_app,
                "plan_id": PLAN_DONE_ID,
                "started_at": datetime(2026, 8, 14, 9, tzinfo=timezone.utc),
                "ended_at": datetime(2026, 8, 14, 9, 20, tzinfo=timezone.utc),
                "goal_value": 1200,
                "duration_sec": 1200,
                "distance_m": 2800,
                "completed": True,
                "rhythm_score": Decimal("0.750"),
                "late_drop_rate": Decimal("0.080"),
                "fatigue_index": Decimal("0.232"),
                "samples": _samples(1200, 157),
                "events": [
                    {"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}},
                    {"t": 1200, "type": "RUN_END", "payload": {"completed": True}},
                ],
            },
        ),
        (
            RUN_APP_NO_PLAN_ID,
            primary.id,
            "dalli-seed-app-unfinished",
            {
                **common_app,
                "plan_id": None,
                "started_at": datetime(2026, 8, 15, 8, tzinfo=timezone.utc),
                "ended_at": datetime(2026, 8, 15, 8, 10, tzinfo=timezone.utc),
                "goal_value": 1200,
                "duration_sec": 600,
                "distance_m": 1250,
                "completed": False,
                "rhythm_score": Decimal("0.600"),
                "late_drop_rate": Decimal("0.120"),
                "fatigue_index": Decimal("0.308"),
                "samples": _samples(600, 157),
                "events": [{"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}}],
            },
        ),
        (
            RUN_MANUAL_ID,
            primary.id,
            "dalli-seed-manual-same-day",
            {
                "source": "MANUAL",
                "plan_id": None,
                "started_at": datetime(2026, 8, 15, 11, tzinfo=timezone.utc),
                "ended_at": None,
                "goal_type": None,
                "goal_value": None,
                "condition": 3,
                "target_cadence_min": None,
                "target_cadence_max": None,
                "final_target_min": None,
                "final_target_max": None,
                "duration_sec": 900,
                "distance_m": 2100,
                "avg_cadence": None,
                "avg_pace_sec_per_km": None,
                "completed": True,
                "rhythm_score": None,
                "late_drop_rate": None,
                "fatigue_index": None,
                "intervention_count": None,
                "downshift_count": None,
                "samples": None,
                "events": None,
                "memo": "공원에서 가볍게 달림",
                "created_at": fixed_created_at,
            },
        ),
        (
            RUN_MONTH_BOUNDARY_ID,
            primary.id,
            "dalli-seed-app-month-boundary",
            {
                **common_app,
                "plan_id": None,
                "started_at": datetime(2026, 8, 31, 15, 30, tzinfo=timezone.utc),
                "ended_at": datetime(2026, 8, 31, 15, 40, tzinfo=timezone.utc),
                "goal_value": 600,
                "duration_sec": 600,
                "distance_m": 1400,
                "completed": True,
                "rhythm_score": Decimal("0.700"),
                "late_drop_rate": Decimal("0.050"),
                "fatigue_index": Decimal("0.240"),
                "samples": _samples(600, 157),
                "events": [
                    {"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}},
                    {"t": 600, "type": "RUN_END", "payload": {"completed": True}},
                ],
            },
        ),
        (
            RUN_OTHER_USER_ID,
            secondary.id,
            "dalli-seed-other-user-run",
            {
                **common_app,
                "plan_id": None,
                "started_at": datetime(2026, 8, 14, 10, tzinfo=timezone.utc),
                "ended_at": datetime(2026, 8, 14, 10, 10, tzinfo=timezone.utc),
                "goal_value": 600,
                "duration_sec": 600,
                "distance_m": 1350,
                "completed": True,
                "rhythm_score": Decimal("0.650"),
                "late_drop_rate": Decimal("0.100"),
                "fatigue_index": Decimal("0.290"),
                "samples": _samples(600, 154),
                "events": [
                    {"t": 0, "type": "RUN_START", "payload": {"min": 150, "max": 158}},
                    {"t": 600, "type": "RUN_END", "payload": {"completed": True}},
                ],
                "target_cadence_min": 150,
                "target_cadence_max": 158,
                "final_target_min": 150,
                "final_target_max": 158,
                "avg_cadence": 154,
            },
        ),
    ]
    for run_id, user_id, client_run_id, values in run_specs:
        by_client = session.scalar(
            select(Run).where(Run.user_id == user_id, Run.client_run_id == client_run_id)
        )
        if by_client is not None and by_client.id != run_id:
            raise SeedError(f"seed client_run_id 충돌: {client_run_id}")
        _owned_entity(
            session,
            Run,
            run_id,
            {"user_id": user_id, "client_run_id": client_run_id, **values},
            owner_id=user_id,
        )
    session.flush()

    report = session.get(Report, REPORT_ID)
    report_values = {
        "run_id": RUN_LINKED_ID,
        "verdict": "오늘의 리듬을 무리 없이 이어간 러닝이에요.",
        "evidence": ["안정 구간 75%", "오늘의 부담: 여유로움"],
        "hypothesis": None,
        "prescription": None,
        "next_goal_text": "다음 목표: 20분 완주, 리듬 157",
        "next_target_min": 153,
        "next_target_max": 161,
        "recovery_note": None,
        "limitation": None,
        "is_fallback": True,
        "model": None,
        "created_at": fixed_created_at,
    }
    by_run = session.scalar(select(Report).where(Report.run_id == RUN_LINKED_ID))
    if by_run is not None and by_run.id != REPORT_ID:
        raise SeedError(f"seed report run_id 충돌: {RUN_LINKED_ID}")
    if report is None:
        session.add(Report(id=REPORT_ID, **report_values))
    else:
        if report.run_id != RUN_LINKED_ID:
            raise SeedError(f"seed report 식별자 충돌: {REPORT_ID}")
        _set_values(report, report_values)

    session.commit()
    return SeedSummary(users=2, plans=3, runs=5, reports=1)


def run_seed(*, app_env: str, session: Session | None = None) -> SeedSummary:
    validate_seed_environment(app_env)
    if session is not None:
        return seed_database(session)
    with get_session_factory()() as managed_session:
        try:
            return seed_database(managed_session)
        except Exception:
            managed_session.rollback()
            raise


def main() -> int:
    try:
        app_env = validate_seed_environment(SeedEnvironmentSettings().app_env)
        get_settings()
        summary = run_seed(app_env=app_env)
    except Exception as exc:
        print(f"seed 실패: {exc}", file=sys.stderr)
        return 1
    print(
        "seed 완료: "
        f"users={summary.users}, plans={summary.plans}, "
        f"runs={summary.runs}, reports={summary.reports}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
