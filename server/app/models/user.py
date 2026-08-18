from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Numeric, SmallInteger, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.plan import Plan
    from app.models.run import Run


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "running_purpose IN ('COMPLETE','HABIT','WEIGHT','FITNESS','PERFORMANCE')",
            name="ck_users_running_purpose",
        ),
        CheckConstraint("gender IN ('M','F','O')", name="ck_users_gender"),
        UniqueConstraint("device_uuid", name="uq_users_device_uuid"),
    )

    id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    device_uuid: Mapped[str] = mapped_column(Text, nullable=False)
    running_purpose: Mapped[str | None] = mapped_column(Text)
    experience_level: Mapped[int | None] = mapped_column(SmallInteger)
    max_continuous_min: Mapped[int | None] = mapped_column(SmallInteger)
    weekly_goal_count: Mapped[int | None] = mapped_column(SmallInteger)
    baseline_cadence: Mapped[int | None] = mapped_column(SmallInteger)
    name: Mapped[str | None] = mapped_column(Text)
    height_cm: Mapped[int | None] = mapped_column(SmallInteger)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    birth_year: Mapped[int | None] = mapped_column(SmallInteger)
    birth_month: Mapped[int | None] = mapped_column(SmallInteger)
    birth_day: Mapped[int | None] = mapped_column(SmallInteger)
    gender: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    runs: Mapped[list[Run]] = relationship(
        back_populates="user", passive_deletes=True
    )
    plans: Mapped[list[Plan]] = relationship(
        back_populates="user", passive_deletes=True
    )
