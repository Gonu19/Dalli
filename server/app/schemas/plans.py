from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


GoalType = Literal["TIME", "DISTANCE"]
PlanStatus = Literal["PLANNED", "DONE", "SKIPPED"]


class PlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    planned_date: date
    goal_type: GoalType
    goal_value: int = Field(strict=True, ge=1)
    memo: str | None = None


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: PlanStatus | None = None
    goal_type: GoalType | None = None
    goal_value: int | None = Field(default=None, strict=True, ge=1)

    @model_validator(mode="after")
    def require_a_field(self) -> "PlanUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("updated fields cannot be null")
        return self


class PlanResponse(BaseModel):
    id: UUID
    planned_date: date
    goal_type: GoalType
    goal_value: int
    memo: str | None
    status: PlanStatus
    run_id: UUID | None


class PlanListResponse(BaseModel):
    items: list[PlanResponse]
