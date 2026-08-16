from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models import Plan, Run, User
from app.schemas.calendar import (
    CalendarDayResponse,
    CalendarPlanResponse,
    CalendarResponse,
    CalendarRunResponse,
)
from app.services.plans import effective_plan_status


KST = ZoneInfo("Asia/Seoul")


def month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime, date, date]:
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    start = datetime.combine(first, time.min, KST).astimezone(timezone.utc)
    end = (datetime.combine(last, time.min, KST) + timedelta(days=1)).astimezone(timezone.utc)
    return start, end, first, last


def get_calendar(
    db: Session,
    user: User,
    year: int,
    month: int,
    *,
    today: date | None = None,
) -> CalendarResponse:
    start, end, first, last = month_bounds_utc(year, month)
    plans = db.execute(
        select(
            Plan.id,
            Plan.planned_date,
            Plan.status,
            Plan.goal_type,
            Plan.goal_value,
            exists(select(Run.id).where(Run.plan_id == Plan.id)).label("has_run"),
        )
        .where(Plan.user_id == user.id, Plan.planned_date.between(first, last))
        .order_by(Plan.planned_date, Plan.id)
    ).all()
    runs = db.execute(
        select(Run.id, Run.started_at, Run.source, Run.duration_sec, Run.completed)
        .where(Run.user_id == user.id, Run.started_at >= start, Run.started_at < end)
        .order_by(Run.started_at, Run.id)
    ).all()

    today = today or datetime.now(KST).date()
    days: dict[date, dict] = {}
    for plan in plans:
        days.setdefault(plan.planned_date, {"plan": None, "runs": []})["plan"] = CalendarPlanResponse(
            id=plan.id,
            status=effective_plan_status(
                stored_status=plan.status,
                planned_date=plan.planned_date,
                has_run=plan.has_run,
                today=today,
            ),
            goal_type=plan.goal_type,
            goal_value=plan.goal_value,
        )
    for run in runs:
        run_date = run.started_at.astimezone(KST).date()
        days.setdefault(run_date, {"plan": None, "runs": []})["runs"].append(
            CalendarRunResponse(
                id=run.id, source=run.source, duration_sec=run.duration_sec, completed=run.completed
            )
        )
    return CalendarResponse(
        days=[
            CalendarDayResponse(date=day, plan=values["plan"], runs=values["runs"])
            for day, values in sorted(days.items())
        ]
    )
