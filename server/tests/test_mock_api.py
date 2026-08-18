from fastapi.testclient import TestClient

from app.mock_main import create_mock_app


AUTH = {"Authorization": "Bearer mock.jwt.new-user"}


def test_mock_health_matches_real_liveness_contract() -> None:
    response = TestClient(create_mock_app()).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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


def test_mock_short_app_run_returns_too_short_fixture() -> None:
    client = TestClient(create_mock_app())

    too_short = client.post(
        "/runs",
        headers=AUTH,
        json={
            "client_run_id": "device-run-too-short",
            "source": "APP",
            "duration_sec": 179,
        },
    )
    boundary = client.post(
        "/runs",
        headers=AUTH,
        json={
            "client_run_id": "device-run-boundary",
            "source": "APP",
            "duration_sec": 180,
        },
    )

    assert too_short.status_code == 201
    assert too_short.json()["is_analyzable"] is False
    assert too_short.json()["analysis_limitation"] == "TOO_SHORT"
    assert too_short.json()["rhythm_score"] is None
    assert boundary.status_code == 201
    assert boundary.json()["is_analyzable"] is True


def test_mock_first_eligible_run_auto_persists_baseline_once() -> None:
    client = TestClient(create_mock_app())
    samples = [{"t": t, "c": 157} for t in range(0, 360, 5)]

    first = client.post(
        "/runs",
        headers=AUTH,
        json={
            "client_run_id": "device-run-baseline-1",
            "source": "APP",
            "duration_sec": 360,
            "samples": samples,
        },
    )
    second = client.post(
        "/runs",
        headers=AUTH,
        json={
            "client_run_id": "device-run-baseline-2",
            "source": "APP",
            "duration_sec": 360,
            "samples": [{"t": t, "c": 170} for t in range(0, 360, 5)],
        },
    )
    profile = client.get("/users/me", headers=AUTH)

    assert first.status_code == 201
    assert second.status_code == 201
    assert "baseline_cadence" not in first.json()
    assert profile.json()["baseline_cadence"] == 157


def test_mock_protected_route_requires_bearer_token() -> None:
    client = TestClient(create_mock_app())
    response = client.get("/stats")
    empty_bearer = client.get("/stats", headers={"Authorization": "Bearer "})

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"
    assert empty_bearer.status_code == 401


def test_mock_plan_gets_apply_derived_statuses() -> None:
    client = TestClient(create_mock_app())

    plans = client.get("/plans", headers=AUTH)
    calendar = client.get("/calendar", headers=AUTH)

    assert plans.status_code == 200
    assert plans.json()["items"][0]["status"] == "DONE"
    assert calendar.status_code == 200
    planned_day = next(day for day in calendar.json()["days"] if day["date"] == "2026-08-16")
    assert planned_day["plan"]["status"] == "SKIPPED"


def test_mock_report_scenarios() -> None:
    client = TestClient(create_mock_app())

    normal = client.post("/runs/run-1/report", headers=AUTH)
    fallback = client.post(
        "/runs/run-2/report",
        headers={**AUTH, "X-Mock-Scenario": "fallback"},
    )
    insufficient_data = client.post(
        "/runs/run-3/report",
        headers={**AUTH, "X-Mock-Scenario": "insufficient_data"},
    )

    assert normal.status_code == 200
    assert normal.json()["is_fallback"] is False
    assert fallback.status_code == 200
    assert fallback.json()["is_fallback"] is True
    assert fallback.json()["limitation"] is None
    assert insufficient_data.status_code == 200
    assert insufficient_data.json()["is_fallback"] is True
    assert insufficient_data.json()["metrics"] == {
        "rhythm_score": None,
        "late_drop_rate": None,
        "fatigue_index": None,
        "in_range_sec": None,
    }
    assert insufficient_data.json()["limitation"]


def test_mock_report_creation_is_idempotent() -> None:
    client = TestClient(create_mock_app())

    created = client.post("/runs/run-1/report", headers=AUTH)
    repeated = client.post(
        "/runs/run-1/report",
        headers={**AUTH, "X-Mock-Scenario": "fallback"},
    )

    assert created.status_code == 200
    assert repeated.status_code == 200
    assert repeated.json() == created.json()


def test_mock_validation_error_uses_contract_shape() -> None:
    response = TestClient(create_mock_app()).post(
        "/auth/device",
        content="{",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "VALIDATION_ERROR",
            "message": "요청 값이 올바르지 않습니다.",
        }
    }
