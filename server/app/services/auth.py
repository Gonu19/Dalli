from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User


JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(days=30)
DEVICE_UUID_UNIQUE_CONSTRAINT = "uq_users_device_uuid"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    user_id: UUID,
    secret: SecretStr,
    *,
    now: datetime | None = None,
) -> str:
    issued_at = now or utc_now()
    if issued_at.tzinfo is None or issued_at.utcoffset() is None:
        raise ValueError("JWT issuance time must be timezone-aware")
    issued_at_timestamp = int(issued_at.timestamp())
    payload = {
        "sub": str(user_id),
        "iat": issued_at_timestamp,
        "exp": issued_at_timestamp + int(ACCESS_TOKEN_TTL.total_seconds()),
    }
    return jwt.encode(
        payload,
        secret.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str, secret: SecretStr) -> dict[str, Any]:
    return jwt.decode(
        token,
        secret.get_secret_value(),
        algorithms=[JWT_ALGORITHM],
        options={
            "require": ["sub", "iat", "exp"],
            "verify_sub": True,
            "verify_iat": True,
            "verify_exp": True,
        },
    )


def get_user_by_device_uuid(db: Session, device_uuid: str) -> User | None:
    return db.scalar(select(User).where(User.device_uuid == device_uuid))


def _is_device_uuid_unique_violation(exc: IntegrityError) -> bool:
    diagnostic = getattr(exc.orig, "diag", None)
    return (
        getattr(diagnostic, "constraint_name", None)
        == DEVICE_UUID_UNIQUE_CONSTRAINT
    )


def get_or_create_user(db: Session, device_uuid: str) -> tuple[User, bool]:
    user = get_user_by_device_uuid(db, device_uuid)
    if user is not None:
        return user, False

    user = User(device_uuid=device_uuid)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if not _is_device_uuid_unique_violation(exc):
            raise
        existing_user = get_user_by_device_uuid(db, device_uuid)
        if existing_user is None:
            raise
        return existing_user, False

    db.refresh(user)
    return user, True
