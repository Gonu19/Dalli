from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.plans import PlanCreate, PlanListResponse, PlanResponse, PlanUpdate
from app.services.plans import create_plan, delete_plan, list_plans, update_plan


router = APIRouter(prefix="/plans", tags=["plans"])


@router.post("", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
def post_plan(payload: PlanCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PlanResponse:
    return create_plan(db, current_user, payload)


@router.get("", response_model=PlanListResponse)
def get_plans(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanListResponse:
    return list_plans(db, current_user, date_from, date_to)


@router.patch("/{plan_id}", response_model=PlanResponse)
def patch_plan(plan_id: UUID, payload: PlanUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PlanResponse:
    return update_plan(db, current_user, plan_id, payload)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_plan(plan_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    delete_plan(db, current_user, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
