from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


RunningPurpose = Literal["COMPLETE", "HABIT", "WEIGHT", "FITNESS", "PERFORMANCE"]
ExperienceLevel = Literal[0, 1, 2]
Gender = Literal["M", "F", "O"]
SmallIntegerValue = Annotated[int, Field(strict=True, ge=-32768, le=32767)]
BirthMonthValue = Annotated[int, Field(strict=True, ge=1, le=12)]
BirthDayValue = Annotated[int, Field(strict=True, ge=1, le=31)]
WeightValue = Annotated[
    float,
    Field(allow_inf_nan=False, ge=-999.9, le=999.9),
]


class UserMeResponse(BaseModel):
    id: UUID
    onboarded: bool
    running_purpose: RunningPurpose | None
    experience_level: ExperienceLevel | None
    max_continuous_min: int | None
    weekly_goal_count: int | None
    baseline_cadence: int | None
    name: str | None
    height_cm: int | None
    weight_kg: float | None
    birth_year: int | None
    birth_month: int | None
    birth_day: int | None
    gender: Gender | None


class UserMeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    running_purpose: RunningPurpose | None = None
    experience_level: ExperienceLevel | None = None
    max_continuous_min: SmallIntegerValue | None = None
    weekly_goal_count: SmallIntegerValue | None = None
    baseline_cadence: SmallIntegerValue | None = None
    name: str | None = None
    height_cm: SmallIntegerValue | None = None
    weight_kg: WeightValue | None = None
    birth_year: SmallIntegerValue | None = None
    birth_month: BirthMonthValue | None = None
    birth_day: BirthDayValue | None = None
    gender: Gender | None = None

    @field_validator("weight_kg", mode="before")
    @classmethod
    def reject_non_numeric_weight(cls, value: object) -> object:
        if value is not None and (isinstance(value, (str, bool))):
            raise ValueError("weight_kg must be a JSON number or null")
        if value is None:
            return value
        try:
            decimal_value = Decimal(str(value))
        except (InvalidOperation, ValueError):
            raise ValueError("weight_kg must be a JSON number or null") from None
        if not decimal_value.is_finite() or decimal_value.as_tuple().exponent < -1:
            raise ValueError("weight_kg must have at most one decimal place")
        return value
