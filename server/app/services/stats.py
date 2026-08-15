from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import case, distinct, func, select
from sqlalchemy.orm import Session

from app.models import Run, User
from app.schemas.stats import RecentRunResponse, StatsResponse


KST = ZoneInfo("Asia/Seoul")


def _utc_boundaries(now: datetime) -> tuple[datetime, datetime, datetime]:
    local_now = now.astimezone(KST)
    month_start_local = datetime.combine(local_now.date().replace(day=1), time.min, KST)
    week_start_date = local_now.date() - timedelta(days=local_now.weekday())
    week_start_local = datetime.combine(week_start_date, time.min, KST)
    return (
        month_start_local.astimezone(timezone.utc),
        week_start_local.astimezone(timezone.utc),
        local_now.astimezone(timezone.utc),
    )


def get_stats(db: Session, user: User, now: datetime | None = None) -> StatsResponse:
    current = now or datetime.now(timezone.utc)
    month_start, week_start, current_utc = _utc_boundaries(current)
    local_date = func.date(func.timezone("Asia/Seoul", Run.started_at))
    totals = db.execute(
        select(
            func.count(distinct(local_date)),
            func.count(distinct(case((Run.source == "APP", local_date)))),
            func.count(distinct(case((Run.started_at >= month_start, local_date)))),
            func.count(
                distinct(
                    case(
                        (
                            (Run.started_at >= week_start) & (Run.started_at <= current_utc),
                            local_date,
                        )
                    )
                )
            ),
        ).where(Run.user_id == user.id)
    ).one()
    total_days, dalli_days, month_days, week_days = (int(value or 0) for value in totals)
    recent = db.execute(
        select(Run.id, Run.started_at, Run.duration_sec, Run.completed)
        .where(Run.user_id == user.id)
        .order_by(Run.started_at.desc(), Run.id.desc())
        .limit(1)
    ).one_or_none()
    recent_response = None
    if recent is not None:
        recent_response = RecentRunResponse(
            id=recent.id,
            date=recent.started_at.astimezone(KST).date(),
            duration_sec=recent.duration_sec,
            completed=recent.completed,
        )
    return StatsResponse(
        total_run_days=total_days,
        dalli_days=dalli_days,
        this_month_days=month_days,
        this_week_count=week_days,
        next_milestone=(total_days // 10 + 1) * 10,
        recent_run=recent_response,
    )
