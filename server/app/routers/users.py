from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.users import UserMeResponse, UserMeUpdate
from app.services.users import update_user_profile, user_me_response


router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMeResponse)
def get_me(current_user: User = Depends(get_current_user)) -> UserMeResponse:
    return user_me_response(current_user)


@router.patch("/me", response_model=UserMeResponse)
def patch_me(
    payload: UserMeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserMeResponse:
    update_user_profile(db, current_user, payload)
    return user_me_response(current_user)
