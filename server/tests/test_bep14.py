from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.main import create_app
from app.models import Run
from app.schemas.plans import PlanCreate, PlanUpdate
from app.services.calendar import month_bounds_utc
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


def test_plan_contract_rejects_invalid_goal_and_undocumented_patch_fields() -> None:
    with pytest.raises(ValidationError):
        PlanCreate(planned_date=date.today(), goal_type="TIME", goal_value=0)
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({})
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({"goal_value": None})
    with pytest.raises(ValidationError):
        PlanUpdate.model_validate({"planned_date": "2026-08-16"})
