"""create initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-14
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("device_uuid", sa.Text(), nullable=False),
        sa.Column("running_purpose", sa.Text(), nullable=True),
        sa.Column("experience_level", sa.SmallInteger(), nullable=True),
        sa.Column("max_continuous_min", sa.SmallInteger(), nullable=True),
        sa.Column("weekly_goal_count", sa.SmallInteger(), nullable=True),
        sa.Column("baseline_cadence", sa.SmallInteger(), nullable=True),
        sa.Column("height_cm", sa.SmallInteger(), nullable=True),
        sa.Column("weight_kg", sa.Numeric(4, 1), nullable=True),
        sa.Column("birth_year", sa.SmallInteger(), nullable=True),
        sa.Column("gender", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "running_purpose IN ('COMPLETE','HABIT','WEIGHT','FITNESS','PERFORMANCE')",
            name="ck_users_running_purpose",
        ),
        sa.CheckConstraint("gender IN ('M','F','O')", name="ck_users_gender"),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("device_uuid", name="uq_users_device_uuid"),
    )

    op.create_table(
        "plans",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("planned_date", sa.Date(), nullable=False),
        sa.Column("goal_type", sa.Text(), nullable=True),
        sa.Column("goal_value", sa.Integer(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'PLANNED'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "goal_type IN ('TIME','DISTANCE')", name="ck_plans_goal_type"
        ),
        sa.CheckConstraint(
            "status IN ('PLANNED','DONE','SKIPPED')", name="ck_plans_status"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_plans_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_plans"),
    )
    op.create_index("idx_plans_user_date", "plans", ["user_id", "planned_date"])
    op.create_index(
        "uq_plans_user_date",
        "plans",
        ["user_id", "planned_date"],
        unique=True,
    )

    op.create_table(
        "runs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_run_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("goal_type", sa.Text(), nullable=True),
        sa.Column("goal_value", sa.Integer(), nullable=True),
        sa.Column("condition", sa.SmallInteger(), nullable=True),
        sa.Column("target_cadence_min", sa.SmallInteger(), nullable=True),
        sa.Column("target_cadence_max", sa.SmallInteger(), nullable=True),
        sa.Column("final_target_min", sa.SmallInteger(), nullable=True),
        sa.Column("final_target_max", sa.SmallInteger(), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=False),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("avg_cadence", sa.SmallInteger(), nullable=True),
        sa.Column("avg_pace_sec_per_km", sa.Integer(), nullable=True),
        sa.Column(
            "completed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("rhythm_score", sa.Numeric(4, 3), nullable=True),
        sa.Column("late_drop_rate", sa.Numeric(4, 3), nullable=True),
        sa.Column("fatigue_index", sa.Numeric(4, 3), nullable=True),
        sa.Column(
            "intervention_count",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=True,
        ),
        sa.Column(
            "downshift_count",
            sa.SmallInteger(),
            server_default=sa.text("0"),
            nullable=True,
        ),
        sa.Column("samples", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("events", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("source IN ('APP','MANUAL')", name="ck_runs_source"),
        sa.CheckConstraint(
            "goal_type IN ('TIME','DISTANCE')", name="ck_runs_goal_type"
        ),
        sa.CheckConstraint("condition BETWEEN 1 AND 5", name="ck_runs_condition"),
        sa.ForeignKeyConstraint(
            ["plan_id"], ["plans.id"], name="fk_runs_plan_id_plans", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_runs_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_runs"),
    )
    op.create_index(
        "idx_runs_user_started",
        "runs",
        ["user_id", sa.text("started_at DESC")],
    )
    op.create_index(
        "uq_runs_user_client_run",
        "runs",
        ["user_id", "client_run_id"],
        unique=True,
    )
    op.create_index(
        "uq_runs_plan",
        "runs",
        ["plan_id"],
        unique=True,
        postgresql_where=sa.text("plan_id IS NOT NULL"),
    )

    op.create_table(
        "reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("evidence", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("hypothesis", sa.Text(), nullable=True),
        sa.Column("prescription", sa.Text(), nullable=True),
        sa.Column("next_goal_text", sa.Text(), nullable=False),
        sa.Column("next_target_min", sa.SmallInteger(), nullable=False),
        sa.Column("next_target_max", sa.SmallInteger(), nullable=False),
        sa.Column("recovery_note", sa.Text(), nullable=True),
        sa.Column("limitation", sa.Text(), nullable=True),
        sa.Column(
            "is_fallback",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["runs.id"], name="fk_reports_run_id_runs", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reports"),
        sa.UniqueConstraint("run_id", name="uq_reports_run_id"),
    )


def downgrade() -> None:
    op.drop_table("reports")
    op.drop_index("uq_runs_plan", table_name="runs")
    op.drop_index("uq_runs_user_client_run", table_name="runs")
    op.drop_index("idx_runs_user_started", table_name="runs")
    op.drop_table("runs")
    op.drop_index("uq_plans_user_date", table_name="plans")
    op.drop_index("idx_plans_user_date", table_name="plans")
    op.drop_table("plans")
    op.drop_table("users")
    # pgcrypto may be shared by other schemas or applications, so it is retained.
