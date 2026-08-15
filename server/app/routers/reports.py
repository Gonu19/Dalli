from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.reports import ReportResponse
from app.schemas.errors import error_response
from app.services.reports import (
    create_report as create_report_service,
    get_report,
    report_response,
)


router = APIRouter(
    prefix="/runs",
    tags=["reports"],
    responses={401: error_response("인증 필요")},
)


@router.post(
    "/{run_id}/report",
    response_model=ReportResponse,
    status_code=status.HTTP_200_OK,
    responses={
        200: {"model": ReportResponse, "description": "생성 또는 기존 리포트"},
        404: error_response("러닝 없음 또는 소유권 불일치"),
        422: error_response("수기 러닝 또는 잘못된 목표 범위"),
    },
)
def create_report(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ReportResponse:
    result = create_report_service(db, current_user, run_id, settings)
    return report_response(result.report, result.run)


@router.get(
    "/{run_id}/report",
    response_model=ReportResponse,
    responses={
        404: error_response("러닝 또는 리포트 없음"),
        422: error_response("path 검증 실패"),
    },
)
def read_report(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportResponse:
    report, run = get_report(db, current_user, run_id)
    return report_response(report, run)
