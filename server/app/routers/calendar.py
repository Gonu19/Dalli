from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.calendar import CalendarResponse
from app.schemas.errors import error_response
from app.services.calendar import get_calendar


router = APIRouter(
    prefix="/calendar",
    tags=["calendar"],
    responses={401: error_response("인증 필요")},
)


@router.get(
    "",
    response_model=CalendarResponse,
    responses={422: error_response("query 검증 실패")},
)
def calendar_month(
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarResponse:
    return get_calendar(db, current_user, year, month)
