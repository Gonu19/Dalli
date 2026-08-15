from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.exceptions import ApplicationError
from app.models import Plan, User
from app.schemas.plans import PlanCreate, PlanListResponse, PlanResponse, PlanUpdate


def _not_found() -> ApplicationError:
    return ApplicationError(code="NOT_FOUND", message="계획을 찾을 수 없습니다.", status_code=404)


def _conflict() -> ApplicationError:
    return ApplicationError(code="CONFLICT", message="해당 날짜에 이미 계획이 있습니다.", status_code=409)


def _constraint_name(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "diag", None), "constraint_name", None)


def plan_response(plan: Plan) -> PlanResponse:
    return PlanResponse(
        id=plan.id,
        planned_date=plan.planned_date,
        goal_type=plan.goal_type,
        goal_value=plan.goal_value,
        memo=plan.memo,
        status=plan.status,
        run_id=plan.run.id if plan.run is not None else None,
    )


def create_plan(db: Session, user: User, payload: PlanCreate) -> PlanResponse:
    plan = Plan(user_id=user.id, status="PLANNED", **payload.model_dump())
    db.add(plan)
    try:
        db.commit()
        db.refresh(plan)
        return plan_response(plan)
    except IntegrityError as exc:
        db.rollback()
        if _constraint_name(exc) == "uq_plans_user_date":
            raise _conflict() from None
        raise


def list_plans(db: Session, user: User, date_from, date_to) -> PlanListResponse:
    if date_from > date_to:
        raise ApplicationError(
            code="VALIDATION_ERROR", message="from은 to보다 늦을 수 없습니다.", status_code=422
        )
    plans = db.scalars(
        select(Plan)
        .where(Plan.user_id == user.id, Plan.planned_date.between(date_from, date_to))
        .options(selectinload(Plan.run))
        .order_by(Plan.planned_date, Plan.id)
    ).all()
    return PlanListResponse(items=[plan_response(plan) for plan in plans])


def get_owned_plan(db: Session, user: User, plan_id: UUID) -> Plan:
    plan = db.scalar(
        select(Plan)
        .where(Plan.id == plan_id, Plan.user_id == user.id)
        .options(selectinload(Plan.run))
    )
    if plan is None:
        raise _not_found()
    return plan


def update_plan(db: Session, user: User, plan_id: UUID, payload: PlanUpdate) -> PlanResponse:
    plan = get_owned_plan(db, user, plan_id)
    values = payload.model_dump(exclude_unset=True)
    for name, value in values.items():
        setattr(plan, name, value)
    plan.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
        db.refresh(plan)
        return plan_response(plan)
    except IntegrityError as exc:
        db.rollback()
        if _constraint_name(exc) == "uq_plans_user_date":
            raise _conflict() from None
        raise


def delete_plan(db: Session, user: User, plan_id: UUID) -> None:
    plan = get_owned_plan(db, user, plan_id)
    db.delete(plan)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
