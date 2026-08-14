from fastapi.testclient import TestClient

from app.mock_main import create_mock_app


AUTH = {"Authorization": "Bearer mock.jwt.new-user"}


def test_mock_auth_and_onboarding_flow() -> None:
    client = TestClient(create_mock_app())

    auth = client.post("/auth/device", json={"device_uuid": "A1B2-C3D4"})
    assert auth.status_code == 200

    before = client.get("/users/me", headers=AUTH)
    assert before.status_code == 200
    assert before.json()["onboarded"] is False

    updated = client.patch(
        "/users/me",
        headers=AUTH,
        json={
            "running_purpose": "COMPLETE",
            "experience_level": 0,
            "max_continuous_min": 10,
            "weekly_goal_count": 3,
            "baseline_cadence": 157,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["onboarded"] is True


def test_mock_run_upload_is_idempotent() -> None:
    client = TestClient(create_mock_app())
    payload = {"client_run_id": "device-run-1", "source": "APP"}

    created = client.post("/runs", headers=AUTH, json=payload)
    repeated = client.post("/runs", headers=AUTH, json=payload)

    assert created.status_code == 201
    assert repeated.status_code == 200
    assert repeated.json() == created.json()


def test_mock_protected_route_requires_bearer_token() -> None:
    response = TestClient(create_mock_app()).get("/stats")

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"


def test_mock_report_scenarios() -> None:
    client = TestClient(create_mock_app())

    normal = client.post("/runs/run-1/report", headers=AUTH)
    fallback = client.post(
        "/runs/run-1/report",
        headers={**AUTH, "X-Mock-Scenario": "fallback"},
    )

    assert normal.status_code == 201
    assert normal.json()["is_fallback"] is False
    assert fallback.status_code == 200
    assert fallback.json()["is_fallback"] is True
