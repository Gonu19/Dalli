"""remove manual run count defaults

Revision ID: 5675c9406342
Revises: 0001_initial_schema
Create Date: 2026-08-16 22:47:56.642153
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '5675c9406342'
down_revision: str | Sequence[str] | None = '0001_initial_schema'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "runs",
        "intervention_count",
        existing_type=sa.SmallInteger(),
        existing_nullable=True,
        server_default=None,
        schema=None,
    )
    op.alter_column(
        "runs",
        "downshift_count",
        existing_type=sa.SmallInteger(),
        existing_nullable=True,
        server_default=None,
        schema=None,
    )


def downgrade() -> None:
    op.alter_column(
        "runs",
        "intervention_count",
        existing_type=sa.SmallInteger(),
        existing_nullable=True,
        server_default=sa.text("0"),
        schema=None,
    )
    op.alter_column(
        "runs",
        "downshift_count",
        existing_type=sa.SmallInteger(),
        existing_nullable=True,
        server_default=sa.text("0"),
        schema=None,
    )
