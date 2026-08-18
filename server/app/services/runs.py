from dataclasses import dataclass
import base64
import binascii
import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.exceptions import ApplicationError
from app.models import Plan, Run, User
from app.schemas.runs import (
    AppRunCreate,
    ManualRunCreate,
    RunCreate,
    RunCreateResponse,
    RunDetailResponse,
    RunListItem,
    RunListResponse,
)
from app.services.metrics import compute_measured_baseline, compute_run_metrics
from app.services.reports import report_response
from app.services.run_quality import assess_run_quality


@dataclass(frozen=True)
class RunSaveResult:
    run: Run
    created: bool


def _metric_decimal(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


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


def _not_found() -> ApplicationError:
    return ApplicationError(code="NOT_FOUND", message="러닝을 찾을 수 없습니다.", status_code=404)


def _encode_cursor(run: Run) -> str:
    raw = json.dumps(
        {"started_at": run.started_at.isoformat(), "id": str(run.id)},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded).decode())
        started_at = datetime.fromisoformat(value["started_at"])
        if started_at.tzinfo is None:
            raise ValueError
        return started_at, UUID(value["id"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error, UnicodeDecodeError):
        raise ApplicationError(
            code="VALIDATION_ERROR", message="cursor가 올바르지 않습니다.", status_code=422
        ) from None


def list_runs(db: Session, user: User, limit: int, cursor: str | None) -> RunListResponse:
    statement = (
        select(Run)
        .where(Run.user_id == user.id)
        .options(selectinload(Run.report))
        .order_by(Run.started_at.desc(), Run.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        started_at, run_id = _decode_cursor(cursor)
        statement = statement.where(
            or_(Run.started_at < started_at, and_(Run.started_at == started_at, Run.id < run_id))
        )
    rows = list(db.scalars(statement).all())
    has_more = len(rows) > limit
    page = rows[:limit]
    return RunListResponse(
        items=[
            RunListItem(
                id=run.id,
                started_at=run.started_at,
                duration_sec=run.duration_sec,
                distance_m=run.distance_m,
                avg_cadence=run.avg_cadence,
                completed=run.completed,
                source=run.source,
                rhythm_score=run.rhythm_score,
                has_report=run.report is not None,
            )
            for run in page
        ],
        next_cursor=_encode_cursor(page[-1]) if has_more else None,
    )


def get_owned_run(db: Session, user: User, run_id: UUID) -> Run:
    run = db.scalar(
        select(Run)
        .where(Run.id == run_id, Run.user_id == user.id)
        .options(selectinload(Run.report))
    )
    if run is None:
        raise _not_found()
    return run


def run_detail_response(run: Run) -> RunDetailResponse:
    quality = assess_run_quality(run)
    return RunDetailResponse(
        id=run.id,
        client_run_id=run.client_run_id,
        source=run.source,
        plan_id=run.plan_id,
        started_at=run.started_at,
        ended_at=run.ended_at,
        goal_type=run.goal_type,
        goal_value=run.goal_value,
        condition=run.condition,
        target_cadence_min=run.target_cadence_min,
        target_cadence_max=run.target_cadence_max,
        final_target_min=run.final_target_min,
        final_target_max=run.final_target_max,
        duration_sec=run.duration_sec,
        distance_m=run.distance_m,
        avg_cadence=run.avg_cadence,
        avg_pace_sec_per_km=run.avg_pace_sec_per_km,
        completed=run.completed,
        rhythm_score=run.rhythm_score if quality.is_analyzable else None,
        late_drop_rate=run.late_drop_rate if quality.is_analyzable else None,
        fatigue_index=run.fatigue_index if quality.is_analyzable else None,
        intervention_count=run.intervention_count,
        downshift_count=run.downshift_count,
        memo=run.memo,
        is_analyzable=quality.is_analyzable,
        analysis_limitation=quality.analysis_limitation,
        samples=run.samples,
        events=run.events,
        report=report_response(run.report, run) if run.report is not None else None,
    )


def delete_run(db: Session, user: User, run_id: UUID) -> None:
    run = db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user.id))
    if run is None:
        raise _not_found()
    db.delete(run)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


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
    quality = assess_run_quality(run)
    metrics = compute_run_metrics(run, quality)
    run.rhythm_score = _metric_decimal(metrics.rhythm_score)
    run.late_drop_rate = _metric_decimal(metrics.late_drop_rate)
    run.fatigue_index = _metric_decimal(metrics.fatigue_index)
    db.add(run)
    if user.baseline_cadence is None and run.source == "APP":
        measured_baseline = compute_measured_baseline(run.samples, run.duration_sec)
        if measured_baseline is not None:
            updated_at = datetime.now(timezone.utc)
            baseline_update = db.execute(
                update(User)
                .where(User.id == user.id, User.baseline_cadence.is_(None))
                .values(baseline_cadence=measured_baseline, updated_at=updated_at)
            )
            if baseline_update.rowcount == 1:
                set_committed_value(user, "baseline_cadence", measured_baseline)
                set_committed_value(user, "updated_at", updated_at)
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
