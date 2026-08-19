"""add nullable plan title and target cadence

Revision ID: c4f7a8b9d012
Revises: b6e4a9d12f30
Create Date: 2026-08-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c4f7a8b9d012"
down_revision: str | Sequence[str] | None = "b6e4a9d12f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plans", sa.Column("target_cadence", sa.SmallInteger(), nullable=True))
    op.add_column("plans", sa.Column("title", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_plans_target_cadence",
        "plans",
        "target_cadence IS NULL OR target_cadence BETWEEN 130 AND 185",
    )


def downgrade() -> None:
    op.drop_constraint("ck_plans_target_cadence", "plans", type_="check")
    op.drop_column("plans", "title")
    op.drop_column("plans", "target_cadence")
