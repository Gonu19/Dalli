from datetime import date
from uuid import UUID

from pydantic import BaseModel


class RecentRunResponse(BaseModel):
    id: UUID
    date: date
    duration_sec: int
    completed: bool


class StatsResponse(BaseModel):
    total_run_days: int
    dalli_days: int
    this_month_days: int
    this_week_count: int
    next_milestone: int
    recent_run: RecentRunResponse | None
