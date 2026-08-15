from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.plans import PlanCreate, PlanListResponse, PlanResponse, PlanUpdate
from app.schemas.errors import error_response
from app.services.plans import create_plan, delete_plan, list_plans, update_plan


router = APIRouter(
    prefix="/plans",
    tags=["plans"],
    responses={401: error_response("인증 필요")},
)


@router.post(
    "",
    response_model=PlanResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: error_response("같은 날짜 계획 충돌"),
        422: error_response("요청 검증 실패"),
    },
)
def post_plan(payload: PlanCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PlanResponse:
    return create_plan(db, current_user, payload)


@router.get(
    "",
    response_model=PlanListResponse,
    responses={422: error_response("query 검증 실패")},
)
def get_plans(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanListResponse:
    return list_plans(db, current_user, date_from, date_to)


@router.patch(
    "/{plan_id}",
    response_model=PlanResponse,
    responses={
        404: error_response("계획 없음 또는 소유권 불일치"),
        422: error_response("요청 또는 path 검증 실패"),
    },
)
def patch_plan(plan_id: UUID, payload: PlanUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PlanResponse:
    return update_plan(db, current_user, plan_id, payload)


@router.delete(
    "/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: error_response("계획 없음 또는 소유권 불일치"),
        422: error_response("path 검증 실패"),
    },
)
def remove_plan(plan_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    delete_plan(db, current_user, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
