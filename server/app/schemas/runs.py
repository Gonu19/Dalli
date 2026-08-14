from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
SmallIntegerValue = Annotated[int, Field(strict=True, ge=-32768, le=32767)]
IntegerValue = Annotated[int, Field(strict=True, ge=-2147483648, le=2147483647)]
AnalysisLimitation = Literal["MANUAL_RUN", "TOO_SHORT", "INSUFFICIENT_SENSOR_DATA"]
EventType = Literal[
    "RUN_START", "TOO_FAST", "TOO_SLOW", "TARGET_ADJUSTED",
    "RECOVERY_MODE_ON", "PAUSE", "RESUME", "RUN_END",
]


class RunSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: FiniteNumber
    c: FiniteNumber
    p: FiniteNumber | None = None
    d: FiniteNumber | None = None


class RunEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: FiniteNumber
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_reason(self) -> "RunEvent":
        reason = self.payload.get("reason")
        allowed = {
            "TARGET_ADJUSTED": {"no_recovery", "severe", "walking"},
            "RECOVERY_MODE_ON": {"downshift_exhausted", "floor_reached"},
        }.get(self.type)
        if allowed is not None and reason is not None and reason not in allowed:
            raise ValueError("event reason is not allowed")
        return self


class RunCreateBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_run_id: str
    plan_id: UUID | None = None
    started_at: datetime
    duration_sec: IntegerValue
    distance_m: IntegerValue | None = None
    condition: SmallIntegerValue | None = None
    memo: str | None = None


class AppRunCreate(RunCreateBase):
    source: Literal["APP"]
    ended_at: datetime | None = None
    goal_type: Literal["TIME", "DISTANCE"]
    goal_value: IntegerValue
    condition: SmallIntegerValue
    target_cadence_min: SmallIntegerValue
    target_cadence_max: SmallIntegerValue
    final_target_min: SmallIntegerValue
    final_target_max: SmallIntegerValue
    avg_cadence: SmallIntegerValue | None
    avg_pace_sec_per_km: IntegerValue | None = None
    completed: bool
    intervention_count: SmallIntegerValue
    downshift_count: SmallIntegerValue
    samples: list[RunSample]
    events: list[RunEvent]


class ManualRunCreate(RunCreateBase):
    source: Literal["MANUAL"]
    completed: Literal[True] = True


RunCreate = Annotated[AppRunCreate | ManualRunCreate, Field(discriminator="source")]


class RunCreateResponse(BaseModel):
    id: UUID
    client_run_id: str
    created_at: datetime
    is_analyzable: bool
    analysis_limitation: AnalysisLimitation | None
    rhythm_score: Decimal | None
    late_drop_rate: Decimal | None
    fatigue_index: Decimal | None

    @field_serializer("rhythm_score", "late_drop_rate", "fatigue_index", when_used="json")
    def serialize_metric(self, value: Decimal | None) -> float | None:
        return None if value is None else float(value)
