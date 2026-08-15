from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import os
from threading import Barrier
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
import jwt
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.models import Plan, Report, Run, User
from tests.e2e.test_day1_gate import assert_status, e2e_environment, load_requests


KST = ZoneInfo("Asia/Seoul")


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _auth(client: httpx.Client, device_uuid: str) -> tuple[str, dict]:
    body = assert_status(
        client.post("/auth/device", json={"device_uuid": device_uuid}),
        200,
        f"auth {device_uuid}",
    )
    return body["access_token"], body


def _local_noon(day) -> datetime:
    return datetime(day.year, day.month, day.day, 12, tzinfo=KST).astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _app_payload(client_run_id: str, started_at: datetime, plan_id: str | None = None) -> dict:
    payload = deepcopy(load_requests()["create_app_run_minimum_analyzable"])
    payload.update(
        client_run_id=client_run_id,
        plan_id=plan_id,
        started_at=_iso(started_at),
        ended_at=_iso(started_at + timedelta(seconds=payload["duration_sec"])),
    )
    return payload


def _manual_payload(client_run_id: str, started_at: datetime, plan_id: str | None = None) -> dict:
    return {
        "client_run_id": client_run_id,
        "source": "MANUAL",
        "plan_id": plan_id,
        "started_at": _iso(started_at),
        "duration_sec": 900,
        "distance_m": 2100,
        "condition": 3,
        "completed": True,
        "memo": "E2E 수기 러닝",
    }


def _assert_error(response: httpx.Response, status_code: int, code: str, step: str) -> dict:
    body = assert_status(response, status_code, step)
    assert body["detail"]["code"] == code, f"{step}: body={body}"
    assert body["detail"]["message"]
    return body


@pytest.mark.e2e
def test_full_backend_http_flow_and_database_policies() -> None:
    base_url, database_url = e2e_environment()
    current_month = datetime.now(KST).date().replace(day=1)
    next_day = current_month + timedelta(days=1)
    app_started_at = _local_noon(current_month)
    manual_started_at = _local_noon(next_day)
    device_uuid = f"E2E-FLOW-{uuid4()}"
    other_device_uuid = f"E2E-OTHER-{uuid4()}"

    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        assert assert_status(client.get("/health"), 200, "health") == {"status": "ok"}
        token, first_auth = _auth(client, device_uuid)
        headers = _headers(token)
        profile_before = assert_status(client.get("/users/me", headers=headers), 200, "profile before")
        user_id = profile_before["id"]
        assert first_auth["is_new_user"] is True

        renewed_token, second_auth = _auth(client, device_uuid)
        renewed_profile = assert_status(
            client.get("/users/me", headers=_headers(renewed_token)), 200, "profile after reauth"
        )
        assert second_auth["is_new_user"] is False
        assert renewed_profile["id"] == user_id

        profile_patch = deepcopy(load_requests()["patch_user_onboarding"])
        patched = assert_status(
            client.patch("/users/me", headers=headers, json=profile_patch), 200, "profile patch"
        )
        assert patched["onboarded"] is True
        assert assert_status(client.get("/users/me", headers=headers), 200, "profile reread") == patched

        plan_response = assert_status(
            client.post(
                "/plans",
                headers=headers,
                json={
                    "planned_date": current_month.isoformat(),
                    "goal_type": "TIME",
                    "goal_value": 1200,
                    "memo": "E2E APP 계획",
                },
            ),
            201,
            "create APP plan",
        )
        app_plan_id = plan_response["id"]
        listed_plans = assert_status(
            client.get(
                "/plans",
                headers=headers,
                params={"from": current_month.isoformat(), "to": next_day.isoformat()},
            ),
            200,
            "list plans",
        )
        assert [item["id"] for item in listed_plans["items"]] == [app_plan_id]
        patched_plan = assert_status(
            client.patch(
                f"/plans/{app_plan_id}",
                headers=headers,
                json={"status": "SKIPPED", "goal_value": 180},
            ),
            200,
            "patch plan",
        )
        assert patched_plan["status"] == "SKIPPED" and patched_plan["goal_value"] == 180

        app_request = _app_payload(f"E2E-APP-{uuid4()}", app_started_at, app_plan_id)
        app_run = assert_status(
            client.post("/runs", headers=headers, json=app_request), 201, "create APP run"
        )
        app_run_id = app_run["id"]
        linked_plan = assert_status(
            client.get(
                "/plans",
                headers=headers,
                params={"from": current_month.isoformat(), "to": current_month.isoformat()},
            ),
            200,
            "read linked plan",
        )["items"][0]
        assert linked_plan["status"] == "DONE" and linked_plan["run_id"] == app_run_id
        assert_status(client.post("/runs", headers=headers, json=app_request), 200, "repeat APP run")

        manual_plan = assert_status(
            client.post(
                "/plans",
                headers=headers,
                json={
                    "planned_date": next_day.isoformat(),
                    "goal_type": "DISTANCE",
                    "goal_value": 2100,
                    "memo": "E2E MANUAL 계획",
                },
            ),
            201,
            "create MANUAL plan",
        )
        manual_request = _manual_payload(
            f"E2E-MANUAL-{uuid4()}", manual_started_at, manual_plan["id"]
        )
        manual_run = assert_status(
            client.post("/runs", headers=headers, json=manual_request), 201, "create MANUAL run"
        )
        manual_run_id = manual_run["id"]

        first_page = assert_status(
            client.get("/runs", headers=headers, params={"limit": 1}), 200, "runs page 1"
        )
        second_page = assert_status(
            client.get(
                "/runs",
                headers=headers,
                params={"limit": 1, "cursor": first_page["next_cursor"]},
            ),
            200,
            "runs page 2",
        )
        assert first_page["next_cursor"] is not None
        assert first_page["items"][0]["id"] != second_page["items"][0]["id"]
        assert {first_page["items"][0]["id"], second_page["items"][0]["id"]} == {
            app_run_id,
            manual_run_id,
        }

        detail = assert_status(client.get(f"/runs/{app_run_id}", headers=headers), 200, "run detail")
        assert detail["samples"] == app_request["samples"]
        assert detail["events"] == app_request["events"]
        assert detail["report"] is None

        report = assert_status(
            client.post(f"/runs/{app_run_id}/report", headers=headers), 200, "fallback report"
        )
        assert report["is_fallback"] is True and report["model"] is None
        repeated_report = assert_status(
            client.post(f"/runs/{app_run_id}/report", headers=headers), 200, "repeat report"
        )
        fetched_report = assert_status(
            client.get(f"/runs/{app_run_id}/report", headers=headers), 200, "fetch report"
        )
        assert repeated_report == fetched_report == report

        other_token, _ = _auth(client, other_device_uuid)
        other_headers = _headers(other_token)
        for path in (
            f"/runs/{app_run_id}",
            f"/runs/{app_run_id}/report",
        ):
            _assert_error(client.get(path, headers=other_headers), 404, "NOT_FOUND", f"ownership {path}")
        _assert_error(
            client.patch(f"/plans/{app_plan_id}", headers=other_headers, json={"status": "DONE"}),
            404,
            "NOT_FOUND",
            "plan ownership patch",
        )

        calendar = assert_status(
            client.get(
                "/calendar",
                headers=headers,
                params={"year": current_month.year, "month": current_month.month},
            ),
            200,
            "calendar",
        )
        days = {item["date"]: item for item in calendar["days"]}
        assert days[current_month.isoformat()]["plan"]["status"] == "DONE"
        assert [run["source"] for run in days[current_month.isoformat()]["runs"]] == ["APP"]
        assert [run["source"] for run in days[next_day.isoformat()]["runs"]] == ["MANUAL"]

        stats = assert_status(client.get("/stats", headers=headers), 200, "stats")
        assert stats["total_run_days"] == 2
        assert stats["dalli_days"] == 1
        assert stats["recent_run"]["id"] == manual_run_id

        assert_status(client.delete(f"/runs/{app_run_id}", headers=headers), 204, "delete APP run")
        assert_status(
            client.delete(f"/plans/{manual_plan['id']}", headers=headers), 204, "delete MANUAL plan"
        )

    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            assert session.get(Run, UUID(app_run_id)) is None
            assert session.scalar(select(Report).where(Report.run_id == UUID(app_run_id))) is None
            stored_app_plan = session.get(Plan, UUID(app_plan_id))
            assert stored_app_plan is not None and stored_app_plan.status == "DONE" and stored_app_plan.run is None
            stored_manual = session.get(Run, UUID(manual_run_id))
            assert stored_manual is not None and stored_manual.plan_id is None
            assert session.get(Plan, UUID(manual_plan["id"])) is None
    finally:
        engine.dispose()


@pytest.mark.e2e
def test_http_auth_validation_conflict_not_found_and_fallback_failures() -> None:
    base_url, _ = e2e_environment()
    jwt_secret = os.getenv("DALLI_E2E_JWT_SECRET")
    if not jwt_secret:
        pytest.fail("set DALLI_E2E_JWT_SECRET for expired-token verification")
    today = datetime.now(KST).date()
    started_at = _local_noon(today)

    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        token, _ = _auth(client, f"E2E-FAIL-{uuid4()}")
        headers = _headers(token)
        user_id = assert_status(client.get("/users/me", headers=headers), 200, "failure user")["id"]

        _assert_error(client.get("/users/me"), 401, "UNAUTHORIZED", "missing auth")
        _assert_error(
            client.get("/users/me", headers=_headers("not-a-jwt")),
            401,
            "UNAUTHORIZED",
            "invalid JWT",
        )
        now = datetime.now(timezone.utc)
        expired = jwt.encode(
            {
                "sub": user_id,
                "iat": int((now - timedelta(days=31)).timestamp()),
                "exp": int((now - timedelta(seconds=1)).timestamp()),
            },
            jwt_secret,
            algorithm="HS256",
        )
        _assert_error(
            client.get("/users/me", headers=_headers(expired)),
            401,
            "UNAUTHORIZED",
            "expired JWT",
        )

        for response, step in (
            (client.get("/runs/not-a-uuid", headers=headers), "bad UUID"),
            (client.get("/calendar", headers=headers, params={"year": today.year, "month": 13}), "bad month"),
            (client.post("/plans", headers=headers, json={"planned_date": "bad", "goal_type": "TIME", "goal_value": 1}), "bad date"),
            (client.post("/plans", headers=headers, json={"planned_date": today.isoformat(), "goal_type": "OTHER", "goal_value": 1}), "bad enum"),
            (client.patch("/users/me", headers=headers, json={"unknown": 1}), "unknown field"),
        ):
            _assert_error(response, 422, "VALIDATION_ERROR", step)

        missing_id = uuid4()
        _assert_error(
            client.get(f"/runs/{missing_id}", headers=headers), 404, "NOT_FOUND", "missing run"
        )
        _assert_error(
            client.patch(f"/plans/{missing_id}", headers=headers, json={"status": "DONE"}),
            404,
            "NOT_FOUND",
            "missing plan",
        )
        _assert_error(
            client.get(f"/runs/{missing_id}/report", headers=headers),
            404,
            "NOT_FOUND",
            "missing report",
        )

        plan_payload = {
            "planned_date": today.isoformat(),
            "goal_type": "TIME",
            "goal_value": 600,
        }
        assert_status(client.post("/plans", headers=headers, json=plan_payload), 201, "first plan")
        _assert_error(
            client.post("/plans", headers=headers, json=plan_payload),
            409,
            "CONFLICT",
            "duplicate plan date",
        )

        forbidden_manual = _manual_payload(f"E2E-BAD-MANUAL-{uuid4()}", started_at)
        forbidden_manual["goal_type"] = "TIME"
        _assert_error(
            client.post("/runs", headers=headers, json=forbidden_manual),
            422,
            "VALIDATION_ERROR",
            "manual forbidden field",
        )
        missing_plan_request = _manual_payload(
            f"E2E-MISSING-PLAN-{uuid4()}", started_at, str(uuid4())
        )
        _assert_error(
            client.post("/runs", headers=headers, json=missing_plan_request),
            404,
            "NOT_FOUND",
            "missing plan link",
        )

        other_token, _ = _auth(client, f"E2E-FAIL-OTHER-{uuid4()}")
        other_headers = _headers(other_token)
        other_plan = assert_status(
            client.post(
                "/plans",
                headers=other_headers,
                json={
                    "planned_date": (today + timedelta(days=1)).isoformat(),
                    "goal_type": "TIME",
                    "goal_value": 600,
                },
            ),
            201,
            "other plan",
        )
        other_plan_request = _manual_payload(
            f"E2E-OTHER-PLAN-{uuid4()}", started_at, other_plan["id"]
        )
        _assert_error(
            client.post("/runs", headers=headers, json=other_plan_request),
            404,
            "NOT_FOUND",
            "other user plan link",
        )

        unanalyzable = _app_payload(f"E2E-UNANALYZABLE-{uuid4()}", started_at)
        unanalyzable.update(
            duration_sec=60,
            ended_at=_iso(started_at + timedelta(seconds=60)),
            goal_value=60,
            samples=[{"t": 0, "c": 157, "p": None, "d": None}],
            events=[
                {"t": 0, "type": "RUN_START", "payload": {"min": 153, "max": 161}},
                {"t": 60, "type": "RUN_END", "payload": {"completed": False}},
            ],
            completed=False,
        )
        stored = assert_status(
            client.post("/runs", headers=headers, json=unanalyzable), 201, "unanalyzable run"
        )
        assert stored["is_analyzable"] is False
        fallback = assert_status(
            client.post(f"/runs/{stored['id']}/report", headers=headers),
            200,
            "unanalyzable fallback",
        )
        assert fallback["is_fallback"] is True
        assert fallback["model"] is None
        assert fallback["limitation"]


@pytest.mark.e2e
def test_concurrent_http_run_idempotency_uses_postgres_unique_constraint() -> None:
    base_url, database_url = e2e_environment()
    started_at = _local_noon(datetime.now(KST).date())
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        token, _ = _auth(client, f"E2E-CONCURRENT-{uuid4()}")
        user_id = assert_status(
            client.get("/users/me", headers=_headers(token)), 200, "concurrency user"
        )["id"]
    client_run_id = f"E2E-CONCURRENT-RUN-{uuid4()}"
    payload = _manual_payload(client_run_id, started_at)
    barrier = Barrier(4)

    def create_run(_: int) -> tuple[int, str, str]:
        barrier.wait(timeout=5.0)
        with httpx.Client(base_url=base_url, timeout=10.0) as client:
            response = client.post("/runs", headers=_headers(token), json=payload)
        body = response.json()
        return response.status_code, body.get("id", ""), str(body)

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(create_run, range(4)))
    assert sorted(status for status, _, _ in results) == [200, 200, 200, 201], results
    assert len({run_id for _, run_id, _ in results}) == 1, results

    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            count = session.scalar(
                select(func.count()).select_from(Run).where(
                    Run.user_id == UUID(user_id), Run.client_run_id == client_run_id
                )
            )
    finally:
        engine.dispose()
    assert count == 1
