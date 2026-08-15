from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class CalendarPlanResponse(BaseModel):
    id: UUID
    status: Literal["PLANNED", "DONE", "SKIPPED"]
    goal_type: Literal["TIME", "DISTANCE"]
    goal_value: int


class CalendarRunResponse(BaseModel):
    id: UUID
    source: Literal["APP", "MANUAL"]
    duration_sec: int
    completed: bool


class CalendarDayResponse(BaseModel):
    date: date
    plan: CalendarPlanResponse | None
    runs: list[CalendarRunResponse]


class CalendarResponse(BaseModel):
    days: list[CalendarDayResponse]
