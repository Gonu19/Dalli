from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy.exc import IntegrityError

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.main import create_app
from app.models import User
from app.schemas.auth import DeviceAuthRequest
from app.services.auth import (
    ACCESS_TOKEN_TTL,
    JWT_ALGORITHM,
    create_access_token,
    get_or_create_user,
)


TEST_SECRET = "test-only-jwt-secret-with-sufficient-length"


class FakeSession:
    def __init__(self) -> None:
        self.users: list[User] = []
        self.pending: User | None = None
        self.commit_count = 0

    def scalar(self, statement: Any) -> User | None:
        values = list(statement.compile().params.values())
        for user in self.users:
            if user.id in values or user.device_uuid in values:
                return user
        return None

    def add(self, user: User) -> None:
        self.pending = user

    def commit(self) -> None:
        self.commit_count += 1
        if self.pending is not None:
            self.pending.id = uuid4()
            self.users.append(self.pending)
            self.pending = None

    def refresh(self, user: User) -> None:
        assert user in self.users

    def rollback(self) -> None:
        self.pending = None


class RaceSession(FakeSession):
    def __init__(self, constraint_name: str) -> None:
        super().__init__()
        self.existing_user = User(id=uuid4(), device_uuid="race-device")
        self.constraint_name = constraint_name
        self.select_count = 0
        self.rolled_back = False

    def scalar(self, statement: Any) -> User | None:
        del statement
        self.select_count += 1
        return None if self.select_count == 1 else self.existing_user

    def commit(self) -> None:
        diagnostic = SimpleNamespace(constraint_name=self.constraint_name)
        original = SimpleNamespace(diag=diagnostic)
        raise IntegrityError("insert", {}, original)

    def rollback(self) -> None:
        self.rolled_back = True
        super().rollback()


def settings(secret: str = TEST_SECRET) -> Settings:
    return Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret=secret,
        openai_api_key="",
    )


def client_with_session(db: FakeSession) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = settings

    @app.get("/_test/current-user")
    def current_user(user: User = Depends(get_current_user)) -> dict[str, str]:
        return {"id": str(user.id)}

    return TestClient(app)


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("A", "A"),
        ("x" * 128, "x" * 128),
        ("  A1B2-C3D4  ", "A1B2-C3D4"),
        ("opaque value", "opaque value"),
        ("Mixed-Case", "Mixed-Case"),
    ],
)
def test_device_uuid_is_trimmed_but_otherwise_opaque(raw: str, normalized: str) -> None:
    assert DeviceAuthRequest(device_uuid=raw).device_uuid == normalized


@pytest.mark.parametrize("raw", ["", "   ", "x" * 129])
def test_device_uuid_rejects_invalid_trimmed_length(raw: str) -> None:
    with pytest.raises(ValidationError):
        DeviceAuthRequest(device_uuid=raw)


def test_new_and_existing_device_authentication_reuse_user() -> None:
    db = FakeSession()
    client = client_with_session(db)

    first = client.post("/auth/device", json={"device_uuid": "  A1B2-C3D4  "})
    existing_user = db.users[0]
    existing_user.running_purpose = "HABIT"
    second = client.post("/auth/device", json={"device_uuid": "A1B2-C3D4"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["is_new_user"] is True
    assert second.json()["is_new_user"] is False
    assert first.json()["token_type"] == second.json()["token_type"] == "bearer"
    assert set(first.json()) == {"access_token", "token_type", "is_new_user"}
    assert len(db.users) == 1
    assert db.commit_count == 1
    assert existing_user.device_uuid == "A1B2-C3D4"
    assert existing_user.running_purpose == "HABIT"

    claims = jwt.decode(
        first.json()["access_token"],
        TEST_SECRET,
        algorithms=[JWT_ALGORITHM],
        options={"require": ["sub", "iat", "exp"]},
    )
    assert claims["sub"] == str(existing_user.id)
    assert claims["exp"] - claims["iat"] == int(ACCESS_TOKEN_TTL.total_seconds())
    assert jwt.get_unverified_header(first.json()["access_token"])["alg"] == "HS256"


def test_device_uuid_unique_race_rolls_back_and_reuses_winner() -> None:
    db = RaceSession("uq_users_device_uuid")

    user, is_new_user = get_or_create_user(db, "race-device")  # type: ignore[arg-type]

    assert db.rolled_back is True
    assert user is db.existing_user
    assert is_new_user is False


def test_unexpected_integrity_error_is_not_hidden() -> None:
    db = RaceSession("some_other_constraint")

    with pytest.raises(IntegrityError):
        get_or_create_user(db, "race-device")  # type: ignore[arg-type]
    assert db.rolled_back is True


def test_device_auth_validation_uses_contract_error_shape() -> None:
    response = client_with_session(FakeSession()).post(
        "/auth/device", json={"device_uuid": " "}
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "VALIDATION_ERROR",
            "message": "요청 값이 올바르지 않습니다.",
        }
    }


def test_access_token_uses_injected_utc_time_and_exact_ttl() -> None:
    now = datetime(2026, 8, 15, 0, 0, tzinfo=timezone.utc)
    user_id = uuid4()
    token = create_access_token(user_id, SecretStr(TEST_SECRET), now=now)
    claims = jwt.decode(
        token,
        TEST_SECRET,
        algorithms=[JWT_ALGORITHM],
        options={
            "verify_exp": False,
            "verify_iat": False,
            "require": ["sub", "iat", "exp"],
        },
    )

    assert claims == {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=30)).timestamp()),
    }


def test_get_current_user_returns_subject_user() -> None:
    db = FakeSession()
    user = User(id=uuid4(), device_uuid="known-device")
    db.users.append(user)
    token = create_access_token(user.id, SecretStr(TEST_SECRET))

    response = client_with_session(db).get(
        "/_test/current-user", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json() == {"id": str(user.id)}


def make_token(payload: dict[str, Any], *, secret: str = TEST_SECRET, algorithm: str = "HS256") -> str:
    return jwt.encode(payload, secret, algorithm=algorithm)


@pytest.mark.parametrize(
    "authorization",
    [None, "Basic abc", "Bearer", "Bearer malformed-token"],
)
def test_get_current_user_rejects_missing_or_malformed_bearer(
    authorization: str | None,
) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    response = client_with_session(FakeSession()).get(
        "/_test/current-user", headers=headers
    )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {
        "detail": {"code": "UNAUTHORIZED", "message": "인증이 필요합니다."}
    }


def invalid_tokens() -> list[str]:
    now = int(datetime.now(timezone.utc).timestamp())
    user_id = str(uuid4())
    base = {"sub": user_id, "iat": now, "exp": now + 60}
    return [
        make_token(base, secret="wrong-secret-with-at-least-32-bytes"),
        make_token({**base, "exp": now - 1}),
        make_token({key: value for key, value in base.items() if key != "sub"}),
        make_token({key: value for key, value in base.items() if key != "iat"}),
        make_token({key: value for key, value in base.items() if key != "exp"}),
        make_token({**base, "sub": "not-a-uuid"}),
        make_token(
            base,
            secret="hs384-test-secret-that-is-deliberately-at-least-48-bytes-long",
            algorithm="HS384",
        ),
    ]


@pytest.mark.parametrize("token", invalid_tokens())
def test_get_current_user_rejects_invalid_jwt(token: str) -> None:
    response = client_with_session(FakeSession()).get(
        "/_test/current-user", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"


def test_get_current_user_rejects_unknown_subject() -> None:
    token = create_access_token(uuid4(), SecretStr(TEST_SECRET))
    response = client_with_session(FakeSession()).get(
        "/_test/current-user", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


def test_openapi_exposes_public_device_auth_schema() -> None:
    document = create_app().openapi()
    operation = document["paths"]["/auth/device"]["post"]
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]

    assert request_schema["$ref"].endswith("/DeviceAuthRequest")
    assert "security" not in operation
    assert set(document["components"]["schemas"]["DeviceAuthResponse"]["properties"]) == {
        "access_token",
        "token_type",
        "is_new_user",
    }
