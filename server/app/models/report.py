from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, SmallInteger, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.run import Run


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("run_id", name="uq_reports_run_id"),)

    id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    run_id: Mapped[UUID] = mapped_column(
        PostgreSQLUUID(as_uuid=True),
        ForeignKey("runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    hypothesis: Mapped[str | None] = mapped_column(Text)
    prescription: Mapped[str | None] = mapped_column(Text)
    next_goal_text: Mapped[str] = mapped_column(Text, nullable=False)
    next_target_min: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    next_target_max: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    recovery_note: Mapped[str | None] = mapped_column(Text)
    limitation: Mapped[str | None] = mapped_column(Text)
    is_fallback: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    model: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    run: Mapped[Run] = relationship(back_populates="report")
