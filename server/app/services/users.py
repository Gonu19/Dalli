from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import User
from app.schemas.users import UserMeResponse, UserMeUpdate


ONBOARDING_FIELDS = (
    "running_purpose",
    "experience_level",
    "max_continuous_min",
    "weekly_goal_count",
    "baseline_cadence",
)


def is_onboarded(user: User) -> bool:
    return all(getattr(user, field) is not None for field in ONBOARDING_FIELDS)


def user_me_response(user: User) -> UserMeResponse:
    return UserMeResponse(
        id=user.id,
        onboarded=is_onboarded(user),
        running_purpose=user.running_purpose,
        experience_level=user.experience_level,
        max_continuous_min=user.max_continuous_min,
        weekly_goal_count=user.weekly_goal_count,
        baseline_cadence=user.baseline_cadence,
        height_cm=user.height_cm,
        weight_kg=user.weight_kg,
        birth_year=user.birth_year,
        gender=user.gender,
    )


def update_user_profile(
    db: Session,
    user: User,
    update: UserMeUpdate,
    *,
    now: datetime | None = None,
) -> bool:
    values: dict[str, Any] = update.model_dump(exclude_unset=True)
    changed_values = {
        field: value
        for field, value in values.items()
        if getattr(user, field) != value
    }
    if not changed_values:
        return False

    for field, value in changed_values.items():
        setattr(user, field, value)
    user.updated_at = now or datetime.now(timezone.utc)

    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError:
        db.rollback()
        raise
    return True
