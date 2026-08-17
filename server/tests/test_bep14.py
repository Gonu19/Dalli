from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.main import create_app
from app.models import Run
from app.schemas.plans import PlanCreate, PlanUpdate
from app.services.calendar import month_bounds_utc
from app.services.plans import effective_plan_status, list_plans
from app.services.runs import _decode_cursor, _encode_cursor
from app.services.stats import _utc_boundaries


def test_bep14_routes_are_authenticated_and_documented() -> None:
    paths = create_app().openapi()["paths"]
    operations = [
        ("/runs", "get"),
        ("/runs/{run_id}", "get"),
        ("/runs/{run_id}", "delete"),
        ("/plans", "post"),
        ("/plans", "get"),
        ("/plans/{plan_id}", "patch"),
        ("/plans/{plan_id}", "delete"),
        ("/calendar", "get"),
        ("/stats", "get"),
    ]
    for path, method in operations:
        assert paths[path][method]["security"] == [{"HTTPBearer": []}]


def test_cursor_round_trip_preserves_tie_breaker() -> None:
    run = Run(
        id=uuid4(),
        user_id=uuid4(),
        client_run_id="cursor",
        source="MANUAL",
        started_at=datetime(2026, 8, 15, 12, 34, tzinfo=timezone.utc),
        duration_sec=1,
        completed=True,
    )
    assert _decode_cursor(_encode_cursor(run)) == (run.started_at, run.id)


@pytest.mark.parametrize("cursor", ["bad", "e30", "%%%%"])
def test_invalid_cursor_is_validation_error(cursor: str) -> None:
    with pytest.raises(Exception) as exc_info:
        _decode_cursor(cursor)
    assert getattr(exc_info.value, "code", None) == "VALIDATION_ERROR"


def test_kst_month_and_monday_week_boundaries() -> None:
    start, end, first, last = month_bounds_utc(2026, 8)
    assert (first, last) == (date(2026, 8, 1), date(2026, 8, 31))
    assert start == datetime(2026, 7, 31, 15, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 31, 15, tzinfo=timezone.utc)

    month_start, week_start, current = _utc_boundaries(
        datetime(2026, 8, 15, 3, tzinfo=timezone.utc)
    )
    assert month_start == datetime(2026, 7, 31, 15, tzinfo=timezone.utc)
    assert week_start == datetime(2026, 8, 9, 15, tzinfo=timezone.utc)
    assert current == datetime(2026, 8, 15, 3, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("stored_status", "planned_date", "has_run", "expected"),
    [
        ("PLANNED", date(2026, 8, 14), False, "SKIPPED"),
        ("PLANNED", date(2026, 8, 14), True, "DONE"),
        ("PLANNED", date(2026, 8, 17), False, "PLANNED"),
        ("DONE", date(2026, 8, 14), False, "DONE"),
        ("SKIPPED", date(2026, 8, 17), True, "SKIPPED"),
    ],
)
def test_plan_status_derivation_preserves_explicit_done_or_skipped(
    stored_status, planned_date, has_run, expected
) -> None:
    assert (
        effective_plan_status(
            stored_status=stored_status,
            planned_date=planned_date,
            has_run=has_run,
            today=date(2026, 8, 17),
        )
        == expected
    )


def test_list_plans_uses_injected_today_without_writing_stored_status() -> None:
    user = type("UserStub", (), {"id": uuid4()})()
    plan = type(
        "PlanStub",
        (),
        {
            "id": uuid4(),
            "user_id": user.id,
            "planned_date": date(2026, 8, 16),
            "goal_type": "TIME",
            "goal_value": 600,
            "memo": None,
            "status": "PLANNED",
            "run": None,
        },
    )()

    class ScalarResult:
        def all(self):
            return [plan]

    class ReadOnlySession:
        def scalars(self, _query):
            return ScalarResult()

    response = list_plans(
        ReadOnlySession(),
        user,
        date(2026, 8, 1),
        date(2026, 8, 31),
        today=date(2026, 8, 17),
    )

    assert response.items[0].status == "SKIPPED"
    assert plan.status == "PLANNED"


def test_plan_contract_rejects_invalid_goal_and_undocumented_patch_fields() -> None:
    with pytest.raises(ValidationError):
        PlanCreate(planned_date=date.today(), goal_type="TIME", goal_value=0)
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({})
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({"goal_value": None})
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({"planned_date": "2026-08-16"})
