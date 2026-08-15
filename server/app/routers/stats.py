from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.schemas.stats import StatsResponse
from app.schemas.errors import error_response
from app.services.stats import get_stats


router = APIRouter(
    prefix="/stats",
    tags=["stats"],
    responses={401: error_response("인증 필요")},
)


@router.get("", response_model=StatsResponse)
def stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> StatsResponse:
    return get_stats(db, current_user)
