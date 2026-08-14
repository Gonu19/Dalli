from concurrent.futures import ThreadPoolExecutor
import os
from uuid import uuid4

import jwt
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import User
from app.services.auth import JWT_ALGORITHM


@pytest.fixture(scope="module")
def postgres_auth_environment():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; auth concurrency test skipped")
    database_name = make_url(database_url).database or ""
    if "test" not in database_name.lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")

    previous_url = os.environ.get("DATABASE_URL")
    previous_secret = os.environ.get("JWT_SECRET")
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = "postgres-auth-test-secret"
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


def test_concurrent_device_auth_creates_exactly_one_user(
    postgres_auth_environment,
) -> None:
    device_uuid = f"concurrent-{uuid4()}"

    def authenticate() -> tuple[int, dict]:
        with TestClient(create_app()) as client:
            response = client.post("/auth/device", json={"device_uuid": device_uuid})
            return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: authenticate(), range(2)))

    assert [status for status, _ in results] == [200, 200]
    assert sorted(body["is_new_user"] for _, body in results) == [False, True]
    subjects = {
        jwt.decode(
            body["access_token"],
            "postgres-auth-test-secret",
            algorithms=[JWT_ALGORITHM],
        )["sub"]
        for _, body in results
    }
    assert len(subjects) == 1

    with Session(postgres_auth_environment) as session:
        count = session.scalar(
            select(func.count()).select_from(User).where(User.device_uuid == device_uuid)
        )
    assert count == 1
