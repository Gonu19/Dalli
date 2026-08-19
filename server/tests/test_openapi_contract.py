from __future__ import annotations

from pathlib import Path
import re
from typing import Any

from fastapi.testclient import TestClient

from app.main import create_app


EXPECTED_OPERATIONS = {
    "/health": {"get": {"200"}},
    "/auth/device": {"post": {"200", "422"}},
    "/users/me": {"get": {"200", "401"}, "patch": {"200", "401", "422"}},
    "/runs": {
        "get": {"200", "401", "422"},
        "post": {"200", "201", "401", "404", "409", "422"},
    },
    "/runs/{run_id}": {
        "get": {"200", "401", "404", "422"},
        "delete": {"204", "401", "404", "422"},
    },
    "/runs/{run_id}/report": {
        "get": {"200", "401", "404", "422"},
        "post": {"200", "401", "404", "422"},
    },
    "/plans": {
        "get": {"200", "401", "422"},
        "post": {"201", "401", "409", "422"},
    },
    "/plans/{plan_id}": {
        "patch": {"200", "401", "404", "422"},
        "delete": {"204", "401", "404", "422"},
    },
    "/calendar": {"get": {"200", "401", "422"}},
    "/stats": {"get": {"200", "401"}},
}


def _schema() -> dict[str, Any]:
    return create_app().openapi()


def _resolve_ref(schema: dict[str, Any], reference: str) -> Any:
    assert reference.startswith("#/")
    value: Any = schema
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def _walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _response_schema(operation: dict[str, Any], status_code: str) -> dict[str, Any]:
    return operation["responses"][status_code]["content"]["application/json"]["schema"]


def _is_nullable(schema: dict[str, Any]) -> bool:
    return any(option.get("type") == "null" for option in schema.get("anyOf", []))


def test_openapi_endpoint_is_valid_3_x_and_all_refs_resolve() -> None:
    response = TestClient(create_app()).get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert re.fullmatch(r"3\.\d+\.\d+", schema["openapi"])
    assert schema["info"]["title"] == "Dalli API"
    for node in _walk(schema):
        if "$ref" in node:
            assert _resolve_ref(schema, node["$ref"]) is not None


def test_contract_endpoint_table_matches_openapi_without_extra_methods() -> None:
    contract = (Path(__file__).resolve().parents[2] / "docs" / "CONTRACT.md").read_text(
        encoding="utf-8"
    )
    documented = {
        (method.lower(), path)
        for method, path in re.findall(r"\| (GET|POST|PATCH|DELETE) \| `([^`]+)` \|", contract)
    }
    expected = {
        (method, path)
        for path, operations in EXPECTED_OPERATIONS.items()
        for method in operations
    }
    actual = {
        (method, path)
        for path, item in _schema()["paths"].items()
        for method in item
        if method in {"get", "post", "patch", "delete"}
    }
    assert documented == expected == actual


def test_success_and_documented_error_statuses_are_exact() -> None:
    paths = _schema()["paths"]
    for path, operations in EXPECTED_OPERATIONS.items():
        for method, statuses in operations.items():
            assert set(paths[path][method]["responses"]) == statuses


def test_bearer_scheme_and_endpoint_security_are_exact() -> None:
    schema = _schema()
    assert schema["components"]["securitySchemes"] == {
        "HTTPBearer": {"type": "http", "scheme": "bearer"}
    }
    assert "security" not in schema["paths"]["/health"]["get"]
    assert "security" not in schema["paths"]["/auth/device"]["post"]
    for path, operations in EXPECTED_OPERATIONS.items():
        if path in {"/health", "/auth/device"}:
            continue
        for method in operations:
            assert schema["paths"][path][method]["security"] == [{"HTTPBearer": []}]


def test_all_declared_errors_use_the_runtime_error_schema() -> None:
    schema = _schema()
    error_ref = {"$ref": "#/components/schemas/ErrorResponse"}
    for path, operations in EXPECTED_OPERATIONS.items():
        for method, statuses in operations.items():
            operation = schema["paths"][path][method]
            for status_code in statuses & {"401", "404", "409", "422"}:
                assert _response_schema(operation, status_code) == error_ref
    error = schema["components"]["schemas"]["ErrorResponse"]
    detail = schema["components"]["schemas"]["ErrorDetail"]
    assert error["required"] == ["detail"]
    assert set(detail["required"]) == {"code", "message"}


def test_parameters_use_contract_names_required_flags_and_formats() -> None:
    paths = _schema()["paths"]
    run_id = paths["/runs/{run_id}"]["get"]["parameters"][0]
    plan_id = paths["/plans/{plan_id}"]["patch"]["parameters"][0]
    assert (run_id["name"], run_id["in"], run_id["required"], run_id["schema"]["format"]) == (
        "run_id", "path", True, "uuid"
    )
    assert (plan_id["name"], plan_id["in"], plan_id["required"], plan_id["schema"]["format"]) == (
        "plan_id", "path", True, "uuid"
    )
    plan_query = {item["name"]: item for item in paths["/plans"]["get"]["parameters"]}
    assert set(plan_query) == {"from", "to"}
    assert all(item["required"] and item["schema"]["format"] == "date" for item in plan_query.values())
    run_query = {item["name"]: item for item in paths["/runs"]["get"]["parameters"]}
    assert run_query["limit"]["required"] is False
    assert run_query["limit"]["schema"]["default"] == 20
    assert _is_nullable(run_query["cursor"]["schema"])


def test_request_schema_required_optional_nullable_enum_and_jsonb_shapes() -> None:
    components = _schema()["components"]["schemas"]
    auth = components["DeviceAuthRequest"]
    assert auth["required"] == ["device_uuid"]

    app_run = components["AppRunCreate"]
    assert {
        "client_run_id", "source", "started_at", "duration_sec", "goal_type",
        "goal_value", "condition", "target_cadence_min", "target_cadence_max",
        "final_target_min", "final_target_max", "avg_cadence", "completed",
        "intervention_count", "downshift_count", "samples", "events",
    } <= set(app_run["required"])
    assert app_run["properties"]["source"]["const"] == "APP"
    assert app_run["properties"]["goal_type"]["enum"] == ["TIME", "DISTANCE"]
    assert app_run["properties"]["condition"]["enum"] == [1, 3, 5]
    assert app_run["properties"]["started_at"]["format"] == "date-time"
    assert app_run["properties"]["plan_id"]["anyOf"][0]["format"] == "uuid"
    assert app_run["properties"]["samples"]["type"] == "array"
    assert app_run["properties"]["events"]["type"] == "array"

    sample = components["RunSample"]
    event = components["RunEvent"]
    assert set(sample["required"]) == {"t", "c"}
    assert sample["properties"]["t"]["type"] == "integer"
    assert sample["properties"]["c"]["type"] == "integer"
    assert sample["properties"]["p"]["anyOf"][0]["type"] == "integer"
    assert sample["properties"]["d"]["anyOf"][0]["type"] == "number"
    assert _is_nullable(sample["properties"]["p"])
    assert event["properties"]["type"]["enum"] == [
        "RUN_START", "TOO_FAST", "TOO_SLOW", "TARGET_ADJUSTED",
        "RECOVERY_MODE_ON", "PAUSE", "RESUME", "RUN_END",
    ]
    assert event["properties"]["payload"]["additionalProperties"] is True

    plan_create = components["PlanCreate"]
    assert set(plan_create["required"]) == {"planned_date", "goal_type", "goal_value"}
    assert plan_create["properties"]["planned_date"]["format"] == "date"
    assert _is_nullable(plan_create["properties"]["memo"])
    assert _is_nullable(plan_create["properties"]["target_cadence"])
    assert plan_create["properties"]["target_cadence"]["anyOf"][0]["minimum"] == 130
    assert plan_create["properties"]["target_cadence"]["anyOf"][0]["maximum"] == 185
    assert _is_nullable(plan_create["properties"]["title"])
    plan_update = components["PlanUpdate"]
    assert "required" not in plan_update
    assert plan_update["properties"]["status"]["enum"] == ["PLANNED", "DONE", "SKIPPED"]
    assert not _is_nullable(plan_update["properties"]["status"])
    assert _is_nullable(plan_update["properties"]["target_cadence"])
    assert _is_nullable(plan_update["properties"]["title"])

    manual_run = components["ManualRunCreate"]
    condition_options = manual_run["properties"]["condition"]["anyOf"]
    assert next(option for option in condition_options if "enum" in option)["enum"] == [1, 3, 5]


def test_response_schema_formats_nullable_and_report_shapes() -> None:
    components = _schema()["components"]["schemas"]
    health = components["HealthResponse"]
    assert health["required"] == ["status"]
    assert health["properties"]["status"]["const"] == "ok"

    user = components["UserMeResponse"]
    assert user["properties"]["id"]["format"] == "uuid"
    assert _is_nullable(user["properties"]["running_purpose"])
    assert user["properties"]["experience_level"]["anyOf"][0]["enum"] == [0, 1, 2]
    assert user["properties"]["weight_kg"]["anyOf"][0]["type"] == "number"
    assert all(option.get("type") != "string" for option in user["properties"]["weight_kg"]["anyOf"])
    user_update = components["UserMeUpdate"]
    assert user_update["properties"]["experience_level"]["anyOf"][0]["enum"] == [0, 1, 2]
    assert user_update["properties"]["weight_kg"]["anyOf"][0]["type"] == "number"
    assert all(option.get("type") != "string" for option in user_update["properties"]["weight_kg"]["anyOf"])

    detail = components["RunDetailResponse"]
    assert detail["properties"]["started_at"]["format"] == "date-time"
    assert detail["properties"]["active_duration_sec"]["type"] == "integer"
    assert "active_duration_sec" in detail["required"]
    for schema_name in ("RunCreateResponse", "RunListItem"):
        schema = components[schema_name]
        assert schema["properties"]["active_duration_sec"]["type"] == "integer"
        assert "active_duration_sec" in schema["required"]
    assert _is_nullable(detail["properties"]["samples"])
    assert _is_nullable(detail["properties"]["events"])
    assert _is_nullable(detail["properties"]["report"])
    sample_array = next(
        option for option in detail["properties"]["samples"]["anyOf"] if option.get("type") == "array"
    )
    event_array = next(
        option for option in detail["properties"]["events"]["anyOf"] if option.get("type") == "array"
    )
    assert sample_array["items"] == {"$ref": "#/components/schemas/RunSample"}
    assert event_array["items"] == {"$ref": "#/components/schemas/RunEvent"}

    report = components["ReportResponse"]
    assert report["properties"]["id"]["format"] == "uuid"
    assert report["properties"]["created_at"]["format"] == "date-time"
    assert report["properties"]["evidence"]["type"] == "array"
    assert _is_nullable(report["properties"]["limitation"])

    calendar_day = components["CalendarDayResponse"]
    recent = components["RecentRunResponse"]
    assert calendar_day["properties"]["date"]["format"] == "date"
    assert _is_nullable(calendar_day["properties"]["plan"])
    calendar_plan = components["CalendarPlanResponse"]
    assert _is_nullable(calendar_plan["properties"]["target_cadence"])
    assert _is_nullable(calendar_plan["properties"]["title"])
    assert recent["properties"]["date"]["format"] == "date"
    assert recent["properties"]["active_duration_sec"]["type"] == "integer"
