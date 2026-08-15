from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.runs import RunCreate, RunCreateResponse, RunDetailResponse, RunListResponse
from app.services.runs import delete_run, get_owned_run, list_runs, run_detail_response, run_response, save_run


router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("", response_model=RunListResponse)
def get_runs(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RunListResponse:
    return list_runs(db, current_user, limit, cursor)


@router.get("/{run_id}", response_model=RunDetailResponse)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RunDetailResponse:
    return run_detail_response(get_owned_run(db, current_user, run_id))


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    delete_run(db, current_user, run_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
