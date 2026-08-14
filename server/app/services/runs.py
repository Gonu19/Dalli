from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.exceptions import ApplicationError
from app.models import Plan, Run, User
from app.schemas.runs import AppRunCreate, ManualRunCreate, RunCreate, RunCreateResponse
from app.services.run_quality import assess_run_quality


@dataclass(frozen=True)
class RunSaveResult:
    run: Run
    created: bool


def run_response(run: Run) -> RunCreateResponse:
    quality = assess_run_quality(run)
    return RunCreateResponse(
        id=run.id,
        client_run_id=run.client_run_id,
        created_at=run.created_at,
        is_analyzable=quality.is_analyzable,
        analysis_limitation=quality.analysis_limitation,
        rhythm_score=run.rhythm_score if quality.is_analyzable else None,
        late_drop_rate=run.late_drop_rate if quality.is_analyzable else None,
        fatigue_index=run.fatigue_index if quality.is_analyzable else None,
    )


def _constraint_name(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "diag", None), "constraint_name", None)


def save_run(db: Session, user: User, payload: RunCreate) -> RunSaveResult:
    existing = db.scalar(
        select(Run).where(Run.user_id == user.id, Run.client_run_id == payload.client_run_id)
    )
    if existing is not None:
        return RunSaveResult(existing, False)

    plan = None
    if payload.plan_id is not None:
        plan = db.scalar(
            select(Plan)
            .where(Plan.id == payload.plan_id, Plan.user_id == user.id)
            .with_for_update()
        )
        if plan is None:
            db.rollback()
            raise ApplicationError(code="NOT_FOUND", message="계획을 찾을 수 없습니다.", status_code=404)
        linked = db.scalar(select(Run).where(Run.plan_id == plan.id))
        if linked is not None:
            db.rollback()
            raise ApplicationError(code="CONFLICT", message="이미 러닝이 연결된 계획입니다.", status_code=409)

    common = payload.model_dump(mode="python")
    if isinstance(payload, AppRunCreate):
        common["samples"] = [sample.model_dump(mode="json") for sample in payload.samples]
        common["events"] = [event.model_dump(mode="json") for event in payload.events]
    common["user_id"] = user.id
    if isinstance(payload, ManualRunCreate):
        common.update(
            goal_type=None, goal_value=None, target_cadence_min=None,
            target_cadence_max=None, final_target_min=None, final_target_max=None,
            avg_cadence=None, avg_pace_sec_per_km=None, intervention_count=None,
            downshift_count=None, samples=None, events=None,
        )
    run = Run(**common)
    db.add(run)
    if plan is not None:
        plan.status = "DONE"
        plan.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
        db.refresh(run)
        return RunSaveResult(run, True)
    except IntegrityError as exc:
        db.rollback()
        constraint = _constraint_name(exc)
        if constraint == "uq_runs_user_client_run":
            existing = db.scalar(
                select(Run).where(Run.user_id == user.id, Run.client_run_id == payload.client_run_id)
            )
            if existing is not None:
                return RunSaveResult(existing, False)
        if constraint == "uq_runs_plan":
            raise ApplicationError(code="CONFLICT", message="이미 러닝이 연결된 계획입니다.", status_code=409) from None
        raise
    except SQLAlchemyError:
        db.rollback()
        raise
