import os
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import User


@pytest.fixture(scope="module")
def postgres_users_environment():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; users integration test skipped")
    database_name = make_url(database_url).database or ""
    if "test" not in database_name.lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")

    previous_url = os.environ.get("DATABASE_URL")
    previous_secret = os.environ.get("JWT_SECRET")
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = "postgres-users-test-secret-with-32-bytes"
    os.environ.setdefault("OPENAI_API_KEY", "")
    clear_settings_cache()
    clear_database_caches()
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()
        clear_database_caches()
        command.downgrade(config, "base")
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url
        if previous_secret is None:
            os.environ.pop("JWT_SECRET", None)
        else:
            os.environ["JWT_SECRET"] = previous_secret
        clear_settings_cache()


def authenticate(client: TestClient, device_uuid: str) -> str:
    response = client.post("/auth/device", json={"device_uuid": device_uuid})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_profile_round_trip_and_token_ownership(postgres_users_environment) -> None:
    device_a = f"profile-a-{uuid4()}"
    device_b = f"profile-b-{uuid4()}"
    with TestClient(create_app()) as client:
        token_a = authenticate(client, device_a)
        token_b = authenticate(client, device_b)
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        before = client.get("/users/me", headers=headers_a)
        patched = client.patch(
            "/users/me",
            headers=headers_a,
            json={
                "running_purpose": "COMPLETE",
                "experience_level": 0,
                "max_continuous_min": 10,
                "weekly_goal_count": 3,
                "baseline_cadence": 157,
                "weight_kg": 54.0,
            },
        )
        fetched = client.get("/users/me", headers=headers_a)
        other = client.get("/users/me", headers=headers_b)
        cleared = client.patch(
            "/users/me", headers=headers_a, json={"baseline_cadence": None}
        )

    assert before.status_code == 200
    assert before.json()["onboarded"] is False
    assert patched.status_code == fetched.status_code == other.status_code == 200
    assert patched.json() == fetched.json()
    assert patched.json()["onboarded"] is True
    assert patched.json()["weight_kg"] == 54.0
    assert other.json()["id"] != patched.json()["id"]
    assert other.json()["running_purpose"] is None
    assert cleared.status_code == 200
    assert cleared.json()["baseline_cadence"] is None
    assert cleared.json()["onboarded"] is False

    with Session(postgres_users_environment) as session:
        stored_a = session.scalar(select(User).where(User.device_uuid == device_a))
        stored_b = session.scalar(select(User).where(User.device_uuid == device_b))
        assert stored_a is not None and stored_b is not None
        assert stored_a.weight_kg.as_tuple().exponent == -1
        assert stored_a.baseline_cadence is None
        assert stored_b.running_purpose is None
        assert stored_a.updated_at > stored_a.created_at
