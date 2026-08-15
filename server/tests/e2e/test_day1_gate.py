from copy import deepcopy
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import httpx
import jwt
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


LOCAL_HOSTS = {"127.0.0.1", "localhost"}
PROFILE_FIELDS = (
    "running_purpose", "experience_level", "max_continuous_min",
    "weekly_goal_count", "baseline_cadence", "height_cm", "weight_kg",
    "birth_year", "gender",
)


def load_requests() -> dict:
    fixture_path = Path(__file__).resolve().parents[3] / "docs" / "mock-data" / "api-fixtures.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))["requests"]


def e2e_environment() -> tuple[str, str]:
    base_url = os.getenv("DALLI_E2E_BASE_URL")
    database_url = os.getenv("DALLI_E2E_DATABASE_URL")
    if not base_url or not database_url:
        pytest.skip("set DALLI_E2E_BASE_URL and DALLI_E2E_DATABASE_URL for the explicit E2E run")
    api_host = (urlparse(base_url).hostname or "").lower()
    db_url = make_url(database_url)
    db_host = (db_url.host or "").lower()
    db_name = (db_url.database or "").lower()
    if api_host not in LOCAL_HOSTS or db_host not in LOCAL_HOSTS:
        pytest.fail("Day 1 E2E refuses non-local API or database hosts")
    if "day1" not in db_name and "test" not in db_name:
        pytest.fail("E2E database name must contain 'day1' or 'test'")
    return base_url.rstrip("/"), database_url


def assert_status(response: httpx.Response, expected: int, step: str) -> dict:
    try:
        diagnostic = response.json()
        if isinstance(diagnostic, dict) and "access_token" in diagnostic:
            diagnostic = {**diagnostic, "access_token": "<redacted>"}
    except ValueError:
        diagnostic = response.text[:1000]
    assert response.status_code == expected, (
        f"{step}: expected HTTP {expected}, got {response.status_code}; "
        f"body={diagnostic}"
    )
    return {} if response.status_code == 204 else response.json()


@pytest.mark.e2e
def test_day1_auth_profile_app_run_idempotency_gate() -> None:
    base_url, database_url = e2e_environment()
    requests = load_requests()
    device_uuid = f"E2E-DAY1-{uuid4()}"
    client_run_id = f"E2E-RUN-{uuid4()}"
    profile_patch = deepcopy(requests["patch_user_onboarding"])
    run_request = deepcopy(requests["create_app_run_minimum_analyzable"])
    run_request["client_run_id"] = client_run_id

    with httpx.Client(base_url=base_url, timeout=5.0) as client:
        assert assert_status(client.get("/health"), 200, "health") == {"status": "ok"}
        first_auth = assert_status(client.post("/auth/device", json={"device_uuid": device_uuid}), 200, "first device auth")
        assert first_auth["token_type"] == "bearer"
        assert first_auth["is_new_user"] is True
        token = first_auth["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert jwt.get_unverified_header(token)["alg"] == "HS256"
        claims = jwt.decode(token, options={"verify_signature": False})
        assert {"sub", "iat", "exp"} <= set(claims)

        before = assert_status(client.get("/users/me", headers=headers), 200, "profile before onboarding")
        user_id = before["id"]
        assert user_id == claims["sub"]
        assert before["onboarded"] is False
        assert "device_uuid" not in before
        assert all(before[field] is None for field in PROFILE_FIELDS)

        patched = assert_status(client.patch("/users/me", headers=headers, json=profile_patch), 200, "profile patch")
        assert patched["id"] == user_id
        assert patched["onboarded"] is True
        assert all(patched[field] == value for field, value in profile_patch.items())
        assert assert_status(client.get("/users/me", headers=headers), 200, "profile after onboarding") == patched

        first_run = assert_status(client.post("/runs", headers=headers, json=run_request), 201, "first APP run upload")
        assert first_run["client_run_id"] == client_run_id
        assert first_run["created_at"]
        assert set(first_run) == {"id", "client_run_id", "created_at", "is_analyzable", "analysis_limitation", "rhythm_score", "late_drop_rate", "fatigue_index"}
        assert first_run["is_analyzable"] is True
        assert first_run["analysis_limitation"] is None
        assert first_run["rhythm_score"] == 0.722
        assert first_run["late_drop_rate"] is None
        assert first_run["fatigue_index"] is None
        repeated_run = assert_status(client.post("/runs", headers=headers, json=run_request), 200, "idempotent APP run upload")
        assert repeated_run == first_run

        second_auth = assert_status(client.post("/auth/device", json={"device_uuid": device_uuid}), 200, "second device auth")
        assert second_auth["is_new_user"] is False
        second_token = second_auth["access_token"]
        second_claims = jwt.decode(second_token, options={"verify_signature": False})
        assert second_claims["sub"] == user_id
        second_headers = {"Authorization": f"Bearer {second_token}"}
        assert assert_status(client.get("/users/me", headers=second_headers), 200, "profile with renewed token") == patched
        assert assert_status(client.post("/runs", headers=second_headers, json=run_request), 200, "idempotent upload with renewed token") == first_run

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            counts = {
                "users": connection.execute(
                    text("SELECT COUNT(*) FROM users WHERE id = CAST(:id AS uuid)"),
                    {"id": user_id},
                ).scalar_one(),
                "runs": connection.execute(
                    text("SELECT COUNT(*) FROM runs WHERE user_id = CAST(:id AS uuid)"),
                    {"id": user_id},
                ).scalar_one(),
                "plans": connection.execute(
                    text("SELECT COUNT(*) FROM plans WHERE user_id = CAST(:id AS uuid)"),
                    {"id": user_id},
                ).scalar_one(),
                "reports": connection.execute(
                    text(
                        "SELECT COUNT(*) FROM reports r JOIN runs x ON x.id = r.run_id "
                        "WHERE x.user_id = CAST(:id AS uuid)"
                    ),
                    {"id": user_id},
                ).scalar_one(),
            }
            user = connection.execute(text("SELECT * FROM users WHERE id = CAST(:id AS uuid)"), {"id": user_id}).mappings().one()
            run = connection.execute(text("SELECT * FROM runs WHERE user_id = CAST(:user_id AS uuid) AND client_run_id = :client_run_id"), {"user_id": user_id, "client_run_id": client_run_id}).mappings().one()
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            pgcrypto = connection.execute(text("SELECT COUNT(*) FROM pg_extension WHERE extname = 'pgcrypto'")).scalar_one()
    finally:
        engine.dispose()

    assert counts == {"users": 1, "runs": 1, "plans": 0, "reports": 0}
    assert str(user["id"]) == user_id
    assert user["device_uuid"] == device_uuid
    for field, value in profile_patch.items():
        actual = float(user[field]) if field == "weight_kg" else user[field]
        assert actual == value
    assert str(run["user_id"]) == user_id
    assert run["client_run_id"] == client_run_id
    assert run["source"] == "APP"
    assert run["samples"] == run_request["samples"]
    assert run["events"] == run_request["events"]
    assert float(run["rhythm_score"]) == first_run["rhythm_score"]
    assert run["late_drop_rate"] is None
    assert run["fatigue_index"] is None
    assert revision == ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    assert pgcrypto == 1
