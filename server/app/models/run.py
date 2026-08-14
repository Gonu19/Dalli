from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.plan import Plan
    from app.models.report import Report
    from app.models.user import User


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint("source IN ('APP','MANUAL')", name="ck_runs_source"),
        CheckConstraint(
            "goal_type IN ('TIME','DISTANCE')", name="ck_runs_goal_type"
        ),
        CheckConstraint(
            "condition BETWEEN 1 AND 5", name="ck_runs_condition"
        ),
        Index("idx_runs_user_started", "user_id", text("started_at DESC")),
        Index("uq_runs_user_client_run", "user_id", "client_run_id", unique=True),
        Index(
            "uq_runs_plan",
            "plan_id",
            unique=True,
            postgresql_where=text("plan_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_run_id: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    plan_id: Mapped[UUID | None] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("plans.id", ondelete="SET NULL"),
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    goal_type: Mapped[str | None] = mapped_column(Text)
    goal_value: Mapped[int | None] = mapped_column(Integer)
    condition: Mapped[int | None] = mapped_column(SmallInteger)
    target_cadence_min: Mapped[int | None] = mapped_column(SmallInteger)
    target_cadence_max: Mapped[int | None] = mapped_column(SmallInteger)
    final_target_min: Mapped[int | None] = mapped_column(SmallInteger)
    final_target_max: Mapped[int | None] = mapped_column(SmallInteger)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    distance_m: Mapped[int | None] = mapped_column(Integer)
    avg_cadence: Mapped[int | None] = mapped_column(SmallInteger)
    avg_pace_sec_per_km: Mapped[int | None] = mapped_column(Integer)
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    rhythm_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    late_drop_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    fatigue_index: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    intervention_count: Mapped[int | None] = mapped_column(
        SmallInteger, server_default=text("0")
    )
    downshift_count: Mapped[int | None] = mapped_column(
        SmallInteger, server_default=text("0")
    )
    samples: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    memo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="runs")
    plan: Mapped[Plan | None] = relationship(back_populates="run")
    report: Mapped[Report | None] = relationship(
        back_populates="run", uselist=False, passive_deletes=True
    )
