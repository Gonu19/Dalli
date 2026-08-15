from __future__ import annotations

from dataclasses import asdict, dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import Settings
from app.exceptions import ApplicationError
from app.models import Report, Run, User
from app.schemas.reports import ReportMetricsResponse, ReportResponse
from app.services.fallback import build_fallback_report
from app.services.llm import generate_llm_report, llm_values
from app.services.metrics import compute_run_metrics
from app.services.run_quality import assess_run_quality


@dataclass(frozen=True)
class ReportSaveResult:
    report: Report
    run: Run
    created: bool
    is_analyzable: bool


def _not_found() -> ApplicationError:
    return ApplicationError(
        code="NOT_FOUND",
        message="리포트를 찾을 수 없습니다.",
        status_code=404,
    )


def _owned_run(
    db: Session,
    user: User,
    run_id: UUID,
    *,
    for_update: bool = False,
) -> Run:
    statement = select(Run).where(Run.id == run_id, Run.user_id == user.id)
    if for_update:
        statement = statement.with_for_update()
    run = db.scalar(statement)
    if run is None:
        raise _not_found()
    return run


def _constraint_name(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "diag", None), "constraint_name", None)


def create_report(
    db: Session,
    user: User,
    run_id: UUID,
    settings: Settings,
) -> ReportSaveResult:
    run = _owned_run(db, user, run_id, for_update=True)
    if run.source == "MANUAL":
        raise ApplicationError(
            code="VALIDATION_ERROR",
            message="수기 러닝에는 리포트를 생성할 수 없습니다.",
            status_code=422,
        )
    existing = db.scalar(select(Report).where(Report.run_id == run.id))
    quality = assess_run_quality(run)
    if existing is not None:
        return ReportSaveResult(existing, run, False, quality.is_analyzable)

    metrics = compute_run_metrics(run, quality)
    try:
        fallback = build_fallback_report(run, quality, metrics)
    except ValueError:
        raise ApplicationError(
            code="VALIDATION_ERROR",
            message="러닝의 목표 범위를 확인할 수 없습니다.",
            status_code=422,
        ) from None
    content = (
        generate_llm_report(run, quality, metrics, fallback, settings)
        if quality.is_analyzable
        else None
    )
    if content is None:
        values = asdict(fallback)
        values["evidence"] = list(fallback.evidence)
    else:
        values = llm_values(content, settings.openai_model)
    report = Report(run_id=run.id, **values)
    db.add(report)
    try:
        db.commit()
        db.refresh(report)
        return ReportSaveResult(report, run, True, quality.is_analyzable)
    except IntegrityError as exc:
        db.rollback()
        if _constraint_name(exc) == "uq_reports_run_id":
            existing = db.scalar(select(Report).where(Report.run_id == run.id))
            if existing is not None:
                return ReportSaveResult(existing, run, False, quality.is_analyzable)
        raise
    except SQLAlchemyError:
        db.rollback()
        raise


def get_report(db: Session, user: User, run_id: UUID) -> tuple[Report, Run]:
    run = _owned_run(db, user, run_id)
    report = db.scalar(select(Report).where(Report.run_id == run.id))
    if report is None:
        raise _not_found()
    return report, run


def report_response(report: Report, run: Run) -> ReportResponse:
    quality = assess_run_quality(run)
    metrics = compute_run_metrics(run, quality)
    return ReportResponse(
        id=report.id,
        run_id=report.run_id,
        verdict=report.verdict,
        evidence=report.evidence,
        hypothesis=report.hypothesis,
        prescription=report.prescription,
        next_goal_text=report.next_goal_text,
        next_target_min=report.next_target_min,
        next_target_max=report.next_target_max,
        recovery_note=report.recovery_note,
        limitation=report.limitation,
        metrics=ReportMetricsResponse(
            rhythm_score=run.rhythm_score,
            late_drop_rate=run.late_drop_rate,
            fatigue_index=run.fatigue_index,
            in_range_sec=metrics.in_range_sec,
        ),
        is_fallback=report.is_fallback,
        model=report.model,
        created_at=report.created_at,
    )
