from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


RunningPurpose = Literal["COMPLETE", "HABIT", "WEIGHT", "FITNESS", "PERFORMANCE"]
Gender = Literal["M", "F", "O"]
SmallIntegerValue = Annotated[int, Field(strict=True, ge=-32768, le=32767)]
WeightValue = Annotated[
    Decimal,
    Field(ge=Decimal("-999.9"), le=Decimal("999.9"), max_digits=4, decimal_places=1),
]


class UserMeResponse(BaseModel):
    id: UUID
    onboarded: bool
    running_purpose: RunningPurpose | None
    experience_level: int | None
    max_continuous_min: int | None
    weekly_goal_count: int | None
    baseline_cadence: int | None
    height_cm: int | None
    weight_kg: Decimal | None
    birth_year: int | None
    gender: Gender | None

    @field_serializer("weight_kg", when_used="json")
    def serialize_weight_kg(self, value: Decimal | None) -> float | None:
        return None if value is None else float(value)


class UserMeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    running_purpose: RunningPurpose | None = None
    experience_level: SmallIntegerValue | None = None
    max_continuous_min: SmallIntegerValue | None = None
    weekly_goal_count: SmallIntegerValue | None = None
    baseline_cadence: SmallIntegerValue | None = None
    height_cm: SmallIntegerValue | None = None
    weight_kg: WeightValue | None = None
    birth_year: SmallIntegerValue | None = None
    gender: Gender | None = None

    @field_validator("weight_kg", mode="before")
    @classmethod
    def reject_non_numeric_weight(cls, value: object) -> object:
        if value is not None and (isinstance(value, (str, bool))):
            raise ValueError("weight_kg must be a JSON number or null")
        return value
