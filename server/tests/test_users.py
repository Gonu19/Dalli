from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.main import create_app
from app.models import User
from app.schemas.users import UserMeUpdate
from app.services.users import is_onboarded, update_user_profile


PROFILE_FIELDS = {
    "id",
    "onboarded",
    "running_purpose",
    "experience_level",
    "max_continuous_min",
    "weekly_goal_count",
    "baseline_cadence",
    "name",
    "height_cm",
    "weight_kg",
    "birth_year",
    "birth_month",
    "birth_day",
    "gender",
}


class ProfileSession:
    def __init__(self, *, fail_commit: bool = False) -> None:
        self.fail_commit = fail_commit
        self.commit_count = 0
        self.refresh_count = 0
        self.rollback_count = 0

    def commit(self) -> None:
        self.commit_count += 1
        if self.fail_commit:
            raise SQLAlchemyError("commit failed")

    def refresh(self, user: User) -> None:
        del user
        self.refresh_count += 1

    def rollback(self) -> None:
        self.rollback_count += 1


def user(**values) -> User:
    defaults = {
        "id": uuid4(),
        "device_uuid": f"device-{uuid4()}",
        "created_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
    }
    defaults.update(values)
    return User(**defaults)


def client_for(current_user: User, db: ProfileSession) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: current_user
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def auth_settings() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key="",
    )


def unauthenticated_client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: ProfileSession()
    app.dependency_overrides[get_settings] = auth_settings
    return TestClient(app)


def fixture_body(name: str) -> dict:
    path = Path(__file__).resolve().parents[2] / "docs" / "mock-data" / "api-fixtures.json"
    fixtures = json.loads(path.read_text(encoding="utf-8"))
    return fixtures["users"][name]["body"]


def fixture_patch() -> dict:
    path = Path(__file__).resolve().parents[2] / "docs" / "mock-data" / "api-fixtures.json"
    fixtures = json.loads(path.read_text(encoding="utf-8"))
    return fixtures["requests"]["patch_user_onboarding"]


def test_users_me_requires_authentication() -> None:
    client = unauthenticated_client()

    for method in (client.get, lambda path: client.patch(path, json={})):
        response = method("/users/me")
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.json()["detail"]["code"] == "UNAUTHORIZED"
        assert response.json()["detail"]["message"]
        assert isinstance(response.json()["detail"], dict)


def test_users_me_rejects_malformed_token() -> None:
    response = unauthenticated_client().get(
        "/users/me", headers={"Authorization": "Bearer malformed"}
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"


def test_get_not_onboarded_profile_matches_fixture_shape() -> None:
    current_user = user(id=UUID("00000000-0000-4000-8000-000000000001"))
    response = client_for(current_user, ProfileSession()).get("/users/me")

    assert response.status_code == 200
    assert response.json() == fixture_body("not_onboarded")
    assert set(response.json()) == PROFILE_FIELDS


def test_get_onboarded_profile_matches_fixture_and_serializes_weight_as_number() -> None:
    expected = fixture_body("onboarded")
    current_user = user(
        id=UUID(expected["id"]),
        running_purpose="COMPLETE",
        experience_level=0,
        max_continuous_min=10,
        weekly_goal_count=3,
        baseline_cadence=157,
        name="홍길동",
        height_cm=165,
        weight_kg=Decimal("54.0"),
        birth_year=2004,
        birth_month=5,
        birth_day=12,
        gender="F",
    )
    response = client_for(current_user, ProfileSession()).get("/users/me")

    assert response.status_code == 200
    assert response.json() == expected
    assert isinstance(response.json()["weight_kg"], float)


@pytest.mark.parametrize(
    "missing_field",
    [
        "running_purpose",
        "experience_level",
        "max_continuous_min",
        "weekly_goal_count",
        "baseline_cadence",
    ],
)
def test_onboarded_requires_each_required_field(missing_field: str) -> None:
    values = {
        "running_purpose": "COMPLETE",
        "experience_level": 0,
        "max_continuous_min": 0,
        "weekly_goal_count": 0,
        "baseline_cadence": 0,
    }
    values[missing_field] = None

    assert is_onboarded(user(**values)) is False


def test_onboarded_accepts_zeroes_and_ignores_optional_body_fields() -> None:
    current_user = user(
        running_purpose="COMPLETE",
        experience_level=0,
        max_continuous_min=0,
        weekly_goal_count=0,
        baseline_cadence=0,
    )

    assert is_onboarded(current_user) is True


def test_full_patch_persists_fixture_and_matches_followup_get() -> None:
    current_user = user()
    before = current_user.updated_at
    db = ProfileSession()
    client = client_for(current_user, db)

    patched = client.patch("/users/me", json=fixture_patch())
    fetched = client.get("/users/me")

    assert patched.status_code == 200
    assert patched.json() == fetched.json()
    assert patched.json()["onboarded"] is True
    assert db.commit_count == 1
    assert db.refresh_count == 1
    assert current_user.updated_at > before
    assert current_user.weight_kg == Decimal("54.0")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("running_purpose", "HABIT"),
        ("weekly_goal_count", 4),
        ("baseline_cadence", 160),
        ("height_cm", 170),
        ("name", "홍길동"),
        ("birth_month", 5),
        ("birth_day", 12),
    ],
)
def test_partial_patch_only_changes_explicit_field(field: str, value: object) -> None:
    current_user = user(
        running_purpose="COMPLETE",
        experience_level=0,
        max_continuous_min=10,
        weekly_goal_count=3,
        baseline_cadence=157,
        height_cm=165,
    )
    original_device_uuid = current_user.device_uuid
    db = ProfileSession()
    response = client_for(current_user, db).patch("/users/me", json={field: value})

    assert response.status_code == 200
    assert response.json()[field] == value
    assert current_user.experience_level == 0
    assert current_user.max_continuous_min == 10
    assert current_user.device_uuid == original_device_uuid
    assert db.commit_count == 1


def test_explicit_null_clears_field_but_omitted_fields_remain() -> None:
    current_user = user(
        running_purpose="COMPLETE",
        experience_level=0,
        max_continuous_min=10,
        weekly_goal_count=3,
        baseline_cadence=157,
        height_cm=165,
    )
    response = client_for(current_user, ProfileSession()).patch(
        "/users/me", json={"baseline_cadence": None, "height_cm": None}
    )

    assert response.status_code == 200
    assert response.json()["baseline_cadence"] is None
    assert response.json()["height_cm"] is None
    assert response.json()["running_purpose"] == "COMPLETE"
    assert response.json()["onboarded"] is False


def test_empty_and_same_value_patch_are_noops() -> None:
    updated_at = datetime(2026, 8, 14, tzinfo=timezone.utc)
    current_user = user(weekly_goal_count=3, updated_at=updated_at)
    db = ProfileSession()
    client = client_for(current_user, db)

    empty = client.patch("/users/me", json={})
    same = client.patch("/users/me", json={"weekly_goal_count": 3})

    assert empty.status_code == same.status_code == 200
    assert db.commit_count == 0
    assert current_user.updated_at == updated_at


@pytest.mark.parametrize(
    "payload",
    [
        {"running_purpose": "FINISH"},
        {"running_purpose": "RECORD"},
        {"running_purpose": "complete"},
        {"gender": "X"},
        {"experience_level": "0"},
        {"experience_level": 3},
        {"weekly_goal_count": 1.5},
        {"height_cm": 32768},
        {"weight_kg": 1000.0},
        {"weight_kg": 54.05},
        {"weight_kg": "54.0"},
        {"birth_month": 0},
        {"birth_month": 13},
        {"birth_day": 0},
        {"birth_day": 32},
        {"unknown": "value"},
        {"onboarded": True},
        {"id": str(uuid4())},
        {"device_uuid": "other-device"},
    ],
)
def test_patch_rejects_invalid_or_immutable_fields(payload: dict) -> None:
    response = client_for(user(), ProfileSession()).patch("/users/me", json=payload)

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "VALIDATION_ERROR",
            "message": "요청 값이 올바르지 않습니다.",
        }
    }


def test_token_owner_is_the_only_profile_changed() -> None:
    user_a = user(running_purpose="COMPLETE")
    user_b = user(running_purpose="HABIT")
    db_a = ProfileSession()

    response = client_for(user_a, db_a).patch(
        "/users/me", json={"running_purpose": "FITNESS"}
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(user_a.id)
    assert user_a.running_purpose == "FITNESS"
    assert user_b.running_purpose == "HABIT"


def test_profile_commit_failure_rolls_back_and_propagates() -> None:
    current_user = user(weekly_goal_count=3)
    db = ProfileSession(fail_commit=True)

    with pytest.raises(SQLAlchemyError):
        update_user_profile(
            db, current_user, UserMeUpdate(weekly_goal_count=4)
        )  # type: ignore[arg-type]
    assert db.rollback_count == 1


def test_update_timestamp_uses_injected_timezone_aware_utc() -> None:
    current_user = user(weekly_goal_count=3)
    db = ProfileSession()
    now = datetime(2026, 8, 15, 8, 0, tzinfo=timezone.utc)

    changed = update_user_profile(
        db,
        current_user,
        UserMeUpdate(weekly_goal_count=4),
        now=now,
    )  # type: ignore[arg-type]

    assert changed is True
    assert current_user.updated_at == now


def test_openapi_users_me_contract() -> None:
    document = create_app().openapi()
    get_operation = document["paths"]["/users/me"]["get"]
    patch_operation = document["paths"]["/users/me"]["patch"]
    update_properties = document["components"]["schemas"]["UserMeUpdate"]["properties"]
    response_properties = document["components"]["schemas"]["UserMeResponse"]["properties"]

    assert get_operation["security"] == [{"HTTPBearer": []}]
    assert patch_operation["security"] == [{"HTTPBearer": []}]
    assert set(update_properties) == PROFILE_FIELDS - {"id", "onboarded"}
    assert set(response_properties) == PROFILE_FIELDS
    assert "device_uuid" not in update_properties
    assert "device_uuid" not in response_properties
