from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import configure_mappers

from app.database import Base
from app.models import Plan, Report, Run, User


def test_all_domain_tables_are_registered() -> None:
    assert set(Base.metadata.tables) == {"users", "plans", "runs", "reports"}


def test_model_column_sets_match_erd() -> None:
    assert set(User.__table__.columns.keys()) == {
        "id", "device_uuid", "running_purpose", "experience_level",
        "max_continuous_min", "weekly_goal_count", "baseline_cadence",
        "name", "height_cm", "weight_kg", "birth_year", "birth_month",
        "birth_day", "gender", "created_at",
        "updated_at",
    }
    assert set(Plan.__table__.columns.keys()) == {
        "id", "user_id", "planned_date", "goal_type", "goal_value", "memo",
        "status", "created_at", "updated_at",
    }
    assert set(Run.__table__.columns.keys()) == {
        "id", "user_id", "client_run_id", "source", "plan_id", "started_at",
        "ended_at", "goal_type", "goal_value", "condition",
        "target_cadence_min", "target_cadence_max", "final_target_min",
        "final_target_max", "duration_sec", "distance_m", "avg_cadence",
        "avg_pace_sec_per_km", "completed", "rhythm_score", "late_drop_rate",
        "fatigue_index", "intervention_count", "downshift_count", "samples",
        "events", "memo", "created_at",
    }
    assert set(Report.__table__.columns.keys()) == {
        "id", "run_id", "verdict", "evidence", "hypothesis", "prescription",
        "next_goal_text", "next_target_min", "next_target_max", "recovery_note",
        "limitation", "is_fallback", "model", "created_at",
    }


def test_postgresql_types_nullability_and_defaults() -> None:
    for model in (User, Plan, Run, Report):
        assert isinstance(model.__table__.c.id.type, UUID)
        assert model.__table__.c.id.primary_key
        assert str(model.__table__.c.id.server_default.arg) == "gen_random_uuid()"

    assert isinstance(Run.__table__.c.samples.type, JSONB)
    assert isinstance(Run.__table__.c.events.type, JSONB)
    assert isinstance(Report.__table__.c.evidence.type, JSONB)
    assert Run.__table__.c.rhythm_score.type.precision == 4
    assert Run.__table__.c.rhythm_score.type.scale == 3
    assert User.__table__.c.weight_kg.type.precision == 4
    assert User.__table__.c.weight_kg.type.scale == 1

    assert not User.__table__.c.device_uuid.nullable
    assert not Plan.__table__.c.user_id.nullable
    assert Run.__table__.c.plan_id.nullable
    assert Run.__table__.c.intervention_count.nullable
    assert Run.__table__.c.downshift_count.nullable
    assert not Report.__table__.c.evidence.nullable
    assert Run.__table__.c.completed.server_default is not None
    assert Plan.__table__.c.status.server_default is not None
    assert Report.__table__.c.is_fallback.server_default is not None


def test_foreign_keys_and_delete_policies() -> None:
    expected = {
        ("plans", "user_id"): ("users.id", "CASCADE"),
        ("runs", "user_id"): ("users.id", "CASCADE"),
        ("runs", "plan_id"): ("plans.id", "SET NULL"),
        ("reports", "run_id"): ("runs.id", "CASCADE"),
    }
    for (table_name, column_name), (target, ondelete) in expected.items():
        foreign_key = next(iter(Base.metadata.tables[table_name].c[column_name].foreign_keys))
        assert foreign_key.target_fullname == target
        assert foreign_key.ondelete == ondelete


def test_checks_unique_constraints_and_indexes() -> None:
    check_names = {
        constraint.name
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert check_names == {
        "ck_users_running_purpose", "ck_users_gender", "ck_plans_goal_type",
        "ck_plans_status", "ck_runs_source", "ck_runs_goal_type",
        "ck_runs_condition",
    }

    unique_names = {
        constraint.name
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert {"uq_users_device_uuid", "uq_reports_run_id"} <= unique_names

    indexes = {
        index.name: index for table in Base.metadata.tables.values() for index in table.indexes
    }
    assert set(indexes) == {
        "idx_plans_user_date", "uq_plans_user_date", "idx_runs_user_started",
        "uq_runs_user_client_run", "uq_runs_plan",
    }
    assert indexes["uq_plans_user_date"].unique
    assert indexes["uq_runs_user_client_run"].unique
    assert indexes["uq_runs_plan"].unique
    assert indexes["uq_runs_plan"].dialect_options["postgresql"]["where"] is not None
    assert "DESC" in str(indexes["idx_runs_user_started"].expressions[1]).upper()


def test_bidirectional_relationships_are_configured() -> None:
    configure_mappers()
    assert User.runs.property.back_populates == "user"
    assert User.plans.property.back_populates == "user"
    assert Plan.run.property.back_populates == "plan"
    assert Plan.run.property.uselist is False
    assert Run.report.property.back_populates == "run"
    assert Run.report.property.uselist is False
    assert User.runs.property.passive_deletes
    assert User.plans.property.passive_deletes
    assert Plan.run.property.passive_deletes
    assert Run.report.property.passive_deletes
