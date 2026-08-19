from datetime import datetime, timezone
from decimal import Decimal
import json
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.main import create_app
from app.models import Report, Run, User
from app.services.llm import LLMReportContent


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
    def __init__(self, scalars=(), commit_error: Exception | None = None):
        self.scalars = list(scalars)
        self.commit_error = commit_error
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
        if self.commit_error is not None:
            raise self.commit_error
        for value in self.added:
            if isinstance(value, Report):
                value.id = value.id or uuid4()
                value.created_at = value.created_at or NOW

    def refresh(self, value):
        del value

    def rollback(self):
        self.rollbacks += 1


def client_for(
    owner: User,
    db: FakeSession,
    report_settings: Settings | None = None,
) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: owner
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: report_settings or Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
    )
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


def test_first_analyzable_post_creates_fallback_report_with_200():
    owner = user()
    run = app_run(owner)
    db = FakeSession([run, None])
    response = client_for(owner, db).post(f"/runs/{run.id}/report")

    assert response.status_code == 200
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
    assert body["hypothesis"] is body["recovery_note"] is None
    assert body["prescription"]
    assert body["is_fallback"] is True and body["model"] is None


def test_valid_llm_report_is_saved_with_server_metrics_and_200(monkeypatch):
    owner = user()
    run = app_run(owner)
    db = FakeSession([run, None])
    llm_content = LLMReportContent(
        verdict="오늘은 안정적인 리듬을 이어간 러닝이에요.",
        evidence=["안정 구간 100%"],
        hypothesis="일정한 리듬의 영향일 수 있어요.",
        prescription="다음에도 같은 리듬으로 시작해 보세요.",
        next_goal_text="다음 목표: 3분 완주, 리듬 159",
        next_target_min=155,
        next_target_max=163,
        recovery_note=None,
        limitation="위치 정보가 없어 거리와 페이스는 분석하지 않았어요.",
    )
    monkeypatch.setattr(
        "app.services.reports.generate_llm_report",
        lambda *_: llm_content,
    )
    llm_settings = Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key="test-key",
        llm_enabled=True,
        openai_model="gpt-4o-mini",
    )

    response = client_for(owner, db, llm_settings).post(f"/runs/{run.id}/report")

    assert response.status_code == 200
    assert response.json()["is_fallback"] is False
    assert response.json()["model"] == "gpt-4o-mini"
    assert response.json()["metrics"]["rhythm_score"] == 1.0
    assert db.added[0].is_fallback is False
    assert db.added[0].model == "gpt-4o-mini"
    assert run.rhythm_score == Decimal("1.000")


def test_llm_persistence_failure_is_logged_without_faking_fallback(monkeypatch, caplog):
    owner = user()
    run = app_run(owner)
    db = FakeSession(
        [run, None],
        commit_error=SQLAlchemyError("database secret detail"),
    )
    llm_content = LLMReportContent(
        verdict="오늘은 안정적인 리듬을 이어간 러닝이에요.",
        evidence=["안정 구간 100%"],
        hypothesis="일정한 리듬의 영향일 수 있어요.",
        prescription="다음 러닝도 같은 리듬으로 시작해 보세요.",
        next_goal_text="다음 목표: 3분 완주, 리듬 159",
        next_target_min=153,
        next_target_max=161,
        recovery_note=None,
        limitation="위치 정보가 없어 거리와 페이스는 분석하지 않았어요.",
    )
    monkeypatch.setattr(
        "app.services.reports.generate_llm_report",
        lambda *_: llm_content,
    )
    llm_settings = Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key="test-key",
        llm_enabled=True,
        openai_model="gpt-4o-mini",
    )
    caplog.set_level("INFO", logger="app.services.llm")

    with pytest.raises(SQLAlchemyError):
        client_for(owner, db, llm_settings).post(f"/runs/{run.id}/report")

    diagnostic = json.loads(caplog.records[-1].message)
    assert diagnostic["event"] == "llm_report_persistence_failure"
    assert diagnostic["stage"] == "persistence"
    assert diagnostic["reason_codes"] == ["persistence_failure"]
    assert diagnostic["fallback"] is False
    assert diagnostic["model"] == "gpt-4o-mini"
    assert "database secret detail" not in caplog.text


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


def test_duplicate_post_returns_existing_report_unchanged_without_write(monkeypatch):
    owner = user()
    run = app_run(owner)
    existing = report(run)
    db = FakeSession([run, existing])
    monkeypatch.setattr(
        "app.services.reports.generate_llm_report",
        lambda *_: (_ for _ in ()).throw(AssertionError("LLM must not be called")),
    )
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
    assert {"200", "401", "404", "422"} <= set(path["post"]["responses"])
    assert "201" not in path["post"]["responses"]
