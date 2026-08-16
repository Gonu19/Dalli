"""Executable fixture-backed API for frontend development before real services exist.

Run from ``server`` with:
``python -m uvicorn app.mock_main:app --host 0.0.0.0 --port 8001``

This module never connects to PostgreSQL or OpenAI. It is replaced by ``app.main``
when the real backend becomes available.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.exceptions import register_exception_handlers
from app.services.plans import effective_plan_status


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "mock-data"
    / "api-fixtures.json"
)


def _load_fixtures() -> dict[str, Any]:
    with FIXTURE_PATH.open(encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def _body(fixtures: dict[str, Any], section: str, scenario: str) -> dict[str, Any]:
    return deepcopy(fixtures[section][scenario]["body"])


def create_mock_app() -> FastAPI:
    fixtures = _load_fixtures()
    application = FastAPI(
        title="Dalli Mock API",
        description="Fixture-backed API; no PostgreSQL or OpenAI connection",
        version="0.1.0-mock",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(application)

    profile = _body(fixtures, "users", "not_onboarded")
    runs_by_client_id: dict[str, dict[str, Any]] = {}
    reports_by_run_id: dict[str, dict[str, Any]] = {}

    def require_auth(authorization: str | None) -> None:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme != "Bearer" or not token.strip():
            error = _body(fixtures, "errors", "unauthorized")
            raise HTTPException(status_code=401, detail=error["detail"])

    @application.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/auth/device", tags=["auth"])
    def authenticate_device(payload: dict[str, Any]) -> dict[str, Any]:
        if not str(payload.get("device_uuid", "")).strip():
            error = _body(fixtures, "errors", "validation")
            raise HTTPException(status_code=422, detail=error["detail"])
        return _body(fixtures, "auth", "new_user")

    @application.get("/users/me", tags=["users"])
    def get_me(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        return deepcopy(profile)

    @application.patch("/users/me", tags=["users"])
    def patch_me(
        payload: dict[str, Any], authorization: str | None = Header(default=None)
    ) -> dict[str, Any]:
        require_auth(authorization)
        allowed = {
            "running_purpose",
            "experience_level",
            "max_continuous_min",
            "weekly_goal_count",
            "baseline_cadence",
            "height_cm",
            "weight_kg",
            "birth_year",
            "gender",
        }
        profile.update({key: value for key, value in payload.items() if key in allowed})
        required = {
            "running_purpose",
            "experience_level",
            "max_continuous_min",
            "weekly_goal_count",
            "baseline_cadence",
        }
        profile["onboarded"] = all(profile.get(key) is not None for key in required)
        return deepcopy(profile)

    @application.post("/runs", tags=["runs"])
    def create_run(
        payload: dict[str, Any],
        response: Response,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_auth(authorization)
        client_run_id = str(payload.get("client_run_id", "")).strip()
        if not client_run_id:
            error = _body(fixtures, "errors", "validation")
            raise HTTPException(status_code=422, detail=error["detail"])
        if client_run_id in runs_by_client_id:
            response.status_code = status.HTTP_200_OK
            return deepcopy(runs_by_client_id[client_run_id])

        scenario = "manual" if payload.get("source") == "MANUAL" else "created"
        result = _body(fixtures, "runs", scenario)
        result["client_run_id"] = client_run_id
        runs_by_client_id[client_run_id] = result
        response.status_code = status.HTTP_201_CREATED
        return deepcopy(result)

    @application.get("/runs", tags=["runs"])
    def list_runs(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        return _body(fixtures, "runs", "list")

    @application.get("/runs/{run_id}", tags=["runs"])
    def get_run(run_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        result = _body(fixtures, "runs", "detail")
        result["id"] = run_id
        return result

    @application.delete("/runs/{run_id}", status_code=204, tags=["runs"])
    def delete_run(run_id: str, authorization: str | None = Header(default=None)) -> Response:
        require_auth(authorization)
        return Response(status_code=204)

    @application.post("/runs/{run_id}/report", tags=["reports"])
    def create_report(
        run_id: str,
        response: Response,
        authorization: str | None = Header(default=None),
        x_mock_scenario: str = Header(default="normal"),
    ) -> dict[str, Any]:
        require_auth(authorization)
        if run_id in reports_by_run_id:
            response.status_code = status.HTTP_200_OK
            return deepcopy(reports_by_run_id[run_id])

        scenario = x_mock_scenario if x_mock_scenario in fixtures["reports"] else "normal"
        result = _body(fixtures, "reports", scenario)
        result["run_id"] = run_id
        reports_by_run_id[run_id] = result
        response.status_code = fixtures["reports"][scenario]["status"]
        return deepcopy(result)

    @application.get("/runs/{run_id}/report", tags=["reports"])
    def get_report(run_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        if run_id in reports_by_run_id:
            return deepcopy(reports_by_run_id[run_id])
        result = _body(fixtures, "reports", "normal")
        result["run_id"] = run_id
        return result

    @application.get("/plans", tags=["plans"])
    def list_plans(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        result = _body(fixtures, "plans", "list")
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()
        for plan in result["items"]:
            plan["status"] = effective_plan_status(
                stored_status=plan["status"],
                planned_date=date.fromisoformat(plan["planned_date"]),
                has_run=plan["run_id"] is not None,
                today=today,
            )
        return result

    @application.post("/plans", status_code=201, tags=["plans"])
    def create_plan(
        payload: dict[str, Any], authorization: str | None = Header(default=None)
    ) -> dict[str, Any]:
        require_auth(authorization)
        result = _body(fixtures, "plans", "created")
        result.update({key: value for key, value in payload.items() if key in result})
        return result

    @application.patch("/plans/{plan_id}", tags=["plans"])
    def patch_plan(
        plan_id: str,
        payload: dict[str, Any],
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_auth(authorization)
        result = _body(fixtures, "plans", "created")
        result["id"] = plan_id
        result.update({key: value for key, value in payload.items() if key in result})
        return result

    @application.delete("/plans/{plan_id}", status_code=204, tags=["plans"])
    def delete_plan(plan_id: str, authorization: str | None = Header(default=None)) -> Response:
        require_auth(authorization)
        return Response(status_code=204)

    @application.get("/calendar", tags=["calendar"])
    def get_calendar(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        result = _body(fixtures, "calendar", "month")
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()
        for day in result["days"]:
            plan = day.get("plan")
            if plan is None:
                continue
            plan["status"] = effective_plan_status(
                stored_status=plan["status"],
                planned_date=date.fromisoformat(day["date"]),
                has_run=bool(day["runs"]),
                today=today,
            )
        return result

    @application.get("/stats", tags=["stats"])
    def get_stats(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_auth(authorization)
        return _body(fixtures, "stats", "with_history")

    return application


app = create_mock_app()
