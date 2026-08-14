from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.deps import get_db
from app.schemas.auth import DeviceAuthRequest, DeviceAuthResponse
from app.services.auth import create_access_token, get_or_create_user


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/device", response_model=DeviceAuthResponse)
def authenticate_device(
    payload: DeviceAuthRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DeviceAuthResponse:
    user, is_new_user = get_or_create_user(db, payload.device_uuid)
    return DeviceAuthResponse(
        access_token=create_access_token(user.id, settings.jwt_secret),
        is_new_user=is_new_user,
    )
