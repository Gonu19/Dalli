"""add nullable user name and birth date fields

Revision ID: 8d2f0a1c4b6e
Revises: 5675c9406342
Create Date: 2026-08-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "8d2f0a1c4b6e"
down_revision: str | Sequence[str] | None = "5675c9406342"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("birth_month", sa.SmallInteger(), nullable=True))
    op.add_column("users", sa.Column("birth_day", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "birth_day")
    op.drop_column("users", "birth_month")
    op.drop_column("users", "name")
