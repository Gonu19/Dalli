from typing import Annotated

from fastapi import APIRouter, Body, Depends, Response, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.runs import RunCreate, RunCreateResponse
from app.services.runs import run_response, save_run


router = APIRouter(prefix="/runs", tags=["runs"])


@router.post(
    "",
    response_model=RunCreateResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": RunCreateResponse, "description": "멱등 재요청"},
        401: {"description": "인증 필요"},
        404: {"description": "계획 없음 또는 소유권 불일치"},
        409: {"description": "계획 연결 충돌"},
        422: {"description": "요청 검증 실패"},
    },
)
def create_run(
    payload: Annotated[RunCreate, Body(discriminator="source")],
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RunCreateResponse:
    result = save_run(db, current_user, payload)
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return run_response(result.run)
