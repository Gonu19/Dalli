from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, SmallInteger, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.run import Run
    from app.models.user import User


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint(
            "goal_type IN ('TIME','DISTANCE')", name="ck_plans_goal_type"
        ),
        CheckConstraint(
            "status IN ('PLANNED','DONE','SKIPPED')", name="ck_plans_status"
        ),
        CheckConstraint(
            "target_cadence IS NULL OR target_cadence BETWEEN 130 AND 185",
            name="ck_plans_target_cadence",
        ),
        Index("idx_plans_user_date", "user_id", "planned_date"),
        Index("uq_plans_user_date", "user_id", "planned_date", unique=True),
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
    planned_date: Mapped[date] = mapped_column(Date, nullable=False)
    goal_type: Mapped[str | None] = mapped_column(Text)
    goal_value: Mapped[int | None] = mapped_column(Integer)
    target_cadence: Mapped[int | None] = mapped_column(SmallInteger)
    title: Mapped[str | None] = mapped_column(Text)
    memo: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'PLANNED'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="plans")
    run: Mapped[Run | None] = relationship(
        back_populates="plan", uselist=False, passive_deletes=True
    )
