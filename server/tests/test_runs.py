from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.deps import get_current_user, get_db
from app.main import create_app
from app.models import Plan, Run, User
from app.schemas.runs import RunCreate
from app.services.runs import run_response, save_run


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def app_payload(**changes):
    payload = {
        "client_run_id": "opaque-run-key",
        "source": "APP",
        "plan_id": None,
        "started_at": "2026-08-15T00:00:00Z",
        "ended_at": None,
        "goal_type": "TIME",
        "goal_value": 180,
        "condition": 3,
        "target_cadence_min": 153,
        "target_cadence_max": 161,
        "final_target_min": 153,
        "final_target_max": 161,
        "duration_sec": 180,
        "distance_m": None,
        "avg_cadence": 157,
        "avg_pace_sec_per_km": None,
        "completed": True,
        "intervention_count": 0,
        "downshift_count": 0,
        "memo": None,
        "samples": [{"t": t, "c": 157, "p": None, "d": float(t)} for t in range(0, 180, 5)],
        "events": [{"t": 0, "type": "RUN_START", "payload": {}}],
    }
    payload.update(changes)
    return payload


def manual_payload(**changes):
    payload = {
        "client_run_id": "manual-key",
        "source": "MANUAL",
        "started_at": "2026-08-15T00:00:00Z",
        "duration_sec": 900,
    }
    payload.update(changes)
    return payload


class FakeSession:
    def __init__(self, scalars=None):
        self.scalars = list(scalars or [])
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def scalar(self, statement):
        del statement
        return self.scalars.pop(0) if self.scalars else None

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1
        for value in self.added:
            if isinstance(value, Run):
                value.id = value.id or uuid4()
                value.created_at = value.created_at or NOW

    def refresh(self, value):
        del value

    def rollback(self):
        self.rollbacks += 1


def user():
    return User(id=uuid4(), device_uuid="device", created_at=NOW, updated_at=NOW)


def client_for(current_user, db):
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: current_user
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_app_create_and_idempotent_repeat_statuses():
    current_user = user()
    first_db = FakeSession([None])
    first = client_for(current_user, first_db).post("/runs", json=app_payload())
    stored = first_db.added[0]
    repeat = client_for(current_user, FakeSession([stored])).post(
        "/runs", json=app_payload(duration_sec=999)
    )

    assert first.status_code == 201
    assert repeat.status_code == 200
    assert first.json()["id"] == repeat.json()["id"]
    assert stored.duration_sec == 180
    assert stored.user_id == current_user.id
    assert first.json()["is_analyzable"] is True
    assert first.json()["rhythm_score"] is None


def test_manual_fields_are_null_and_analysis_is_limited():
    db = FakeSession([None])
    response = client_for(user(), db).post("/runs", json=manual_payload())
    stored = db.added[0]

    assert response.status_code == 201
    assert response.json()["analysis_limitation"] == "MANUAL_RUN"
    assert stored.completed is True
    for field in (
        "goal_type", "goal_value", "target_cadence_min", "target_cadence_max",
        "final_target_min", "final_target_max", "avg_cadence", "avg_pace_sec_per_km",
        "intervention_count", "downshift_count", "samples", "events",
    ):
        assert getattr(stored, field) is None


@pytest.mark.parametrize("extra", [
    {"completed": False}, {"goal_type": "TIME"}, {"samples": []},
    {"avg_cadence": 150}, {"rhythm_score": 0.5}, {"user_id": str(uuid4())},
])
def test_manual_rejects_app_and_server_owned_fields(extra):
    response = client_for(user(), FakeSession()).post("/runs", json=manual_payload(**extra))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("bad", [
    {"samples": [{"t": float("nan"), "c": 1, "d": 0}]},
    {"events": [{"t": 0, "type": "STABLE", "payload": {}}]},
    {"events": [{"t": 0, "type": "TARGET_ADJUSTED", "payload": {"reason": "other"}}]},
])
def test_jsonb_schema_rejects_invalid_values(bad):
    with pytest.raises(ValidationError):
        TypeAdapter(RunCreate).validate_python(app_payload(**bad))


def test_sample_allows_missing_gps_values_used_by_frontend():
    parsed = TypeAdapter(RunCreate).validate_python(
        app_payload(samples=[{"t": 0, "c": 157, "p": None, "d": None}, {"t": 5, "c": 157}])
    )
    assert parsed.samples[0].d is None and parsed.samples[1].d is None


def test_plan_is_owned_locked_linked_and_marked_done_without_copying_goal():
    current_user = user()
    plan = Plan(id=uuid4(), user_id=current_user.id, status="PLANNED", goal_type="TIME", goal_value=1200)
    db = FakeSession([None, plan, None])
    payload = TypeAdapter(RunCreate).validate_python(manual_payload(plan_id=str(plan.id)))

    result = save_run(db, current_user, payload)

    assert result.created is True
    assert db.commits == 1
    assert result.run.plan_id == plan.id
    assert result.run.goal_type is None
    assert plan.status == "DONE"
    assert plan.updated_at.tzinfo is not None


def test_missing_or_already_linked_plan_does_not_create_run():
    current_user = user()
    missing_db = FakeSession([None, None])
    missing = client_for(current_user, missing_db).post(
        "/runs", json=manual_payload(plan_id=str(uuid4()))
    )
    plan = Plan(id=uuid4(), user_id=current_user.id, status="DONE")
    linked = Run(id=uuid4(), user_id=current_user.id, client_run_id="other", source="MANUAL", duration_sec=1, completed=True, created_at=NOW)
    conflict_db = FakeSession([None, plan, linked])
    conflict = client_for(current_user, conflict_db).post(
        "/runs", json=manual_payload(plan_id=str(plan.id))
    )

    assert missing.status_code == 404
    assert conflict.status_code == 409
    assert not missing_db.added and not conflict_db.added
    assert missing_db.rollbacks == conflict_db.rollbacks == 1


def test_openapi_exposes_run_union_security_and_statuses():
    operation = create_app().openapi()["paths"]["/runs"]["post"]
    schema = operation["requestBody"]["content"]["application/json"]["schema"]

    assert operation["security"] == [{"HTTPBearer": []}]
    assert {"200", "201", "401", "404", "409", "422"} <= set(operation["responses"])
    assert schema["discriminator"]["propertyName"] == "source"
    assert len(schema["oneOf"]) == 2
