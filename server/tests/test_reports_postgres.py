from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import clear_settings_cache
from app.database import clear_database_caches
from app.main import create_app
from app.models import Report, Run
from app.services.auth import decode_access_token
from app.services.report_quality import LLMReportContent

TEST_JWT_SECRET = "postgres-reports-test-secret-with-32-bytes"


@pytest.fixture(scope="module")
def postgres_reports_environment():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not set; report integration tests skipped")
    if "test" not in (make_url(database_url).database or "").lower():
        pytest.fail("TEST_DATABASE_URL must point to a database whose name contains 'test'")
    previous = {name: os.environ.get(name) for name in ("DATABASE_URL", "JWT_SECRET")}
    os.environ["DATABASE_URL"] = database_url
    os.environ["JWT_SECRET"] = TEST_JWT_SECRET
    clear_settings_cache()
    clear_database_caches()
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()
        clear_database_caches()
        command.downgrade(Config("alembic.ini"), "base")
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        clear_settings_cache()


def authenticate(device: str) -> tuple[str, UUID]:
    with TestClient(create_app()) as client:
        response = client.post("/auth/device", json={"device_uuid": device})
    token = response.json()["access_token"]
    subject = decode_access_token(
        token,
        SecretStr(TEST_JWT_SECRET),
    )["sub"]
    return token, UUID(subject)


def app_payload(client_run_id: str) -> dict:
    fixture_path = (
        Path(__file__).resolve().parents[2]
        / "docs"
        / "mock-data"
        / "api-fixtures.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    payload = deepcopy(fixture["requests"]["create_app_run_minimum_analyzable"])
    payload["client_run_id"] = client_run_id
    return payload


@pytest.mark.postgres
def test_concurrent_fallback_report_posts_create_one_row_and_return_200(
    postgres_reports_environment,
) -> None:
    token, user_id = authenticate(f"reports-concurrent-{uuid4()}")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(create_app()) as client:
        run_response = client.post(
            "/runs",
            json=app_payload(f"report-run-{uuid4()}"),
            headers=headers,
        )
    assert run_response.status_code == 201
    run_id = run_response.json()["id"]
    barrier = Barrier(2)

    def post_report() -> tuple[int, str, dict]:
        barrier.wait()
        with TestClient(create_app()) as client:
            response = client.post(f"/runs/{run_id}/report", headers=headers)
        return response.status_code, response.json()["id"], response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: post_report(), range(2)))

    assert [status for status, _, _ in results] == [200, 200]
    assert len({report_id for _, report_id, _ in results}) == 1
    assert results[0][2] == results[1][2]
    with Session(postgres_reports_environment) as session:
        report_count = session.scalar(
            select(func.count())
            .select_from(Report)
            .join(Run, Report.run_id == Run.id)
            .where(Run.user_id == user_id, Run.id == UUID(run_id))
        )
    assert report_count == 1


@pytest.mark.postgres
def test_report_post_get_persistence_and_run_delete_cascade(
    postgres_reports_environment,
) -> None:
    token, user_id = authenticate(f"reports-persistence-{uuid4()}")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(create_app()) as client:
        run_response = client.post(
            "/runs",
            json=app_payload(f"report-persist-{uuid4()}"),
            headers=headers,
        )
        run_id = run_response.json()["id"]
        created = client.post(f"/runs/{run_id}/report", headers=headers)
        fetched = client.get(f"/runs/{run_id}/report", headers=headers)

    assert created.status_code == 200
    assert fetched.status_code == 200
    assert fetched.json() == created.json()
    with Session(postgres_reports_environment) as session:
        stored_run = session.scalar(
            select(Run).where(Run.id == UUID(run_id), Run.user_id == user_id)
        )
        stored_report = session.scalar(
            select(Report).where(Report.run_id == UUID(run_id))
        )
        assert stored_run is not None and stored_report is not None
        assert stored_report.is_fallback is True
        assert stored_report.model is None
        assert stored_report.evidence == created.json()["evidence"]
        report_id = stored_report.id
        session.delete(stored_run)
        session.commit()
        assert session.get(Report, report_id) is None


@pytest.mark.postgres
def test_fake_structured_llm_report_persists_as_non_fallback(
    postgres_reports_environment,
    monkeypatch,
) -> None:
    token, user_id = authenticate(f"reports-fake-llm-{uuid4()}")
    headers = {"Authorization": f"Bearer {token}"}

    def fake_report(run, quality, metrics, fallback, settings):
        del run, quality, metrics, settings
        return LLMReportContent(
            verdict="오늘은 안정적인 리듬을 이어간 러닝이에요.",
            evidence=["안정 구간 100%"],
            hypothesis="일정한 리듬의 영향일 수 있어요.",
            prescription="다음 러닝도 같은 리듬으로 시작해 보세요.",
            next_goal_text="다음 목표: 리듬 159",
            next_target_min=fallback.next_target_min,
            next_target_max=fallback.next_target_max,
            recovery_note=None,
            limitation=fallback.limitation,
        )

    monkeypatch.setattr("app.services.reports.generate_llm_report", fake_report)
    with TestClient(create_app()) as client:
        run_response = client.post(
            "/runs",
            json=app_payload(f"report-fake-llm-run-{uuid4()}"),
            headers=headers,
        )
        assert run_response.status_code == 201
        run_id = run_response.json()["id"]
        report_response = client.post(f"/runs/{run_id}/report", headers=headers)

    assert report_response.status_code == 200
    assert report_response.json()["is_fallback"] is False
    assert report_response.json()["model"] == "gpt-4o-mini"
    with Session(postgres_reports_environment) as session:
        stored = session.scalar(
            select(Report)
            .join(Run, Report.run_id == Run.id)
            .where(Run.id == UUID(run_id), Run.user_id == user_id)
        )
        assert stored is not None
        assert stored.is_fallback is False
        assert stored.model == "gpt-4o-mini"
