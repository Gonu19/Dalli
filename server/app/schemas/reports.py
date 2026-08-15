from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer


class ReportMetricsResponse(BaseModel):
    rhythm_score: Decimal | None
    late_drop_rate: Decimal | None
    fatigue_index: Decimal | None
    in_range_sec: float | None

    @field_serializer(
        "rhythm_score",
        "late_drop_rate",
        "fatigue_index",
        when_used="json",
    )
    def serialize_decimal(self, value: Decimal | None) -> float | None:
        return None if value is None else float(value)


class ReportResponse(BaseModel):
    id: UUID
    run_id: UUID
    verdict: str
    evidence: list[str] = Field(min_length=1, max_length=3)
    hypothesis: str | None
    prescription: str | None
    next_goal_text: str
    next_target_min: int
    next_target_max: int
    recovery_note: str | None
    limitation: str | None
    metrics: ReportMetricsResponse
    is_fallback: bool
    model: str | None
    created_at: datetime
