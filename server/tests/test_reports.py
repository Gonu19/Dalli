from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.main import create_app
from app.models import Report, Run, User


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def user() -> User:
    return User(id=uuid4(), device_uuid="report-device", created_at=NOW, updated_at=NOW)


def app_run(owner: User, **changes) -> Run:
    values = dict(
        id=uuid4(),
        user_id=owner.id,
        client_run_id="report-run",
        source="APP",
        started_at=NOW,
        goal_type="TIME",
        goal_value=180,
        condition=3,
        target_cadence_min=153,
        target_cadence_max=161,
        final_target_min=153,
        final_target_max=161,
        duration_sec=180,
        distance_m=None,
        completed=True,
        rhythm_score=Decimal("1.000"),
        late_drop_rate=None,
        fatigue_index=None,
        intervention_count=0,
        downshift_count=0,
        samples=[{"t": t, "c": 157} for t in range(0, 180, 5)],
        events=[],
        created_at=NOW,
    )
    values.update(changes)
    return Run(**values)


def report(run: Run) -> Report:
    return Report(
        id=uuid4(),
        run_id=run.id,
        verdict="오늘의 안정 구간을 확인했어요.",
        evidence=["안정 구간 100% (180초)"],
        hypothesis=None,
        prescription=None,
        next_goal_text="다음 목표: 3분 완주, 리듬 159",
        next_target_min=155,
        next_target_max=163,
        recovery_note=None,
        limitation="위치 정보가 없어 거리와 페이스는 분석하지 않았어요.",
        is_fallback=True,
        model=None,
        created_at=NOW,
    )


class FakeSession:
    def __init__(self, scalars=()):
        self.scalars = list(scalars)
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
            if isinstance(value, Report):
                value.id = value.id or uuid4()
                value.created_at = value.created_at or NOW

    def refresh(self, value):
        del value

    def rollback(self):
        self.rollbacks += 1


def client_for(owner: User, db: FakeSession) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: owner
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def unauthenticated_client(db: FakeSession) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key="",
    )
    return TestClient(app)


def test_report_endpoints_require_authentication():
    run_id = uuid4()
    for method in ("post", "get"):
        response = getattr(unauthenticated_client(FakeSession()), method)(
            f"/runs/{run_id}/report"
        )
        assert response.status_code == 401


def test_post_missing_or_other_users_run_returns_same_404():
    owner = user()
    for db in (FakeSession([None]), FakeSession([None])):
        response = client_for(owner, db).post(f"/runs/{uuid4()}/report")
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "NOT_FOUND"
        assert not db.added


def test_post_manual_run_returns_422_without_report_creation():
    owner = user()
    manual = app_run(owner, source="MANUAL", samples=None, events=None)
    db = FakeSession([manual])
    response = client_for(owner, db).post(f"/runs/{manual.id}/report")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert not db.added and db.commits == 0


def test_first_analyzable_post_creates_fallback_report_with_201():
    owner = user()
    run = app_run(owner)
    db = FakeSession([run, None])
    response = client_for(owner, db).post(f"/runs/{run.id}/report")

    assert response.status_code == 201
    assert db.commits == 1 and len(db.added) == 1
    body = response.json()
    assert set(body) == {
        "id", "run_id", "verdict", "evidence", "hypothesis", "prescription",
        "next_goal_text", "next_target_min", "next_target_max", "recovery_note",
        "limitation", "metrics", "is_fallback", "model", "created_at",
    }
    assert body["run_id"] == str(run.id)
    assert body["metrics"] == {
        "rhythm_score": 1.0,
        "late_drop_rate": None,
        "fatigue_index": None,
        "in_range_sec": 180.0,
    }
    assert body["hypothesis"] is body["prescription"] is body["recovery_note"] is None
    assert body["is_fallback"] is True and body["model"] is None


def test_first_unanalyzable_app_post_creates_report_but_returns_200():
    owner = user()
    run = app_run(
        owner,
        duration_sec=179,
        rhythm_score=None,
        samples=[{"t": 0, "c": 157}],
    )
    db = FakeSession([run, None])
    response = client_for(owner, db).post(f"/runs/{run.id}/report")
    assert response.status_code == 200
    assert db.commits == 1 and len(db.added) == 1
    assert response.json()["metrics"] == {
        "rhythm_score": None,
        "late_drop_rate": None,
        "fatigue_index": None,
        "in_range_sec": None,
    }
    assert "3분 미만" in response.json()["limitation"]


def test_post_corrupted_app_run_without_target_range_returns_422():
    owner = user()
    run = app_run(
        owner,
        target_cadence_min=None,
        target_cadence_max=None,
        final_target_min=None,
        final_target_max=None,
    )
    db = FakeSession([run, None])
    response = client_for(owner, db).post(f"/runs/{run.id}/report")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert not db.added and db.commits == 0


def test_duplicate_post_returns_existing_report_unchanged_without_write():
    owner = user()
    run = app_run(owner)
    existing = report(run)
    db = FakeSession([run, existing])
    response = client_for(owner, db).post(f"/runs/{run.id}/report")
    assert response.status_code == 200
    assert response.json()["id"] == str(existing.id)
    assert response.json()["created_at"] == NOW.isoformat().replace("+00:00", "Z")
    assert response.json()["verdict"] == existing.verdict
    assert not db.added and db.commits == 0


def test_get_existing_report_matches_post_shape_without_db_write():
    owner = user()
    run = app_run(owner)
    existing = report(run)
    db = FakeSession([run, existing])
    response = client_for(owner, db).get(f"/runs/{run.id}/report")
    assert response.status_code == 200
    assert response.json()["id"] == str(existing.id)
    assert not db.added and db.commits == 0


def test_get_without_report_and_other_user_both_return_404_without_creation():
    owner = user()
    run = app_run(owner)
    for db in (FakeSession([run, None]), FakeSession([None])):
        response = client_for(owner, db).get(f"/runs/{run.id}/report")
        assert response.status_code == 404
        assert not db.added and db.commits == 0


def test_openapi_registers_report_post_and_get_contract():
    path = create_app().openapi()["paths"]["/runs/{run_id}/report"]
    assert {"post", "get"} <= set(path)
    assert path["post"]["security"] == [{"HTTPBearer": []}]
    assert path["get"]["security"] == [{"HTTPBearer": []}]
    assert {"200", "201", "401", "404", "422"} <= set(path["post"]["responses"])
