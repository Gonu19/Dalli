from decimal import Decimal
import json
from pathlib import Path

from app.config import Settings
from app.services.llm import LLMReportContent
from app.services.usage_harness import AttemptStatus
from tests.aiq06_runner import (
    _safe_failure_diagnostics,
    build_aiq06_preflight,
    run_aiq06_evaluation,
)
from tests.test_llm import SECRET, valid_payload
from tests.synthetic_scenarios import evaluate_synthetic_scenario


def settings(*, model: str = "gpt-4o-mini") -> Settings:
    return Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key=SECRET,
        llm_enabled=True,
        openai_model=model,
        llm_timeout_sec=8,
    )


class FakeResponse:
    id = "resp_aiq06_fake"
    model = "gpt-4o-mini"
    _request_id = None
    status = "completed"

    class Usage:
        input_tokens = 1000
        output_tokens = 300
        total_tokens = 1300

        class Details:
            cached_tokens = 0

        input_tokens_details = Details()

    usage = Usage()


class FakeClient:
    def __init__(self, **_kwargs):
        self.responses = self

    def parse(self, **kwargs):
        summary = json.loads(kwargs["input"])
        next_min = summary["next_target_min"]
        next_max = summary["next_target_max"]
        next_center = round((next_min + next_max) / 2)
        payload = valid_payload(
            next_min,
            next_max,
            summary["required_limitation"],
        )
        payload["evidence"] = [
            f"안정 구간 {round(summary['rhythm_score'] * 100)}%",
            "오늘의 부담: 여유로움",
        ]
        payload["next_goal_text"] = f"다음 목표: 10분 완주, 리듬 {next_center}"
        self.kwargs = kwargs
        self.response = FakeResponse()
        self.response.output_parsed = LLMReportContent.model_validate(payload)
        return self.response


def test_preflight_is_dry_run_by_default_and_fixed_to_six_calls() -> None:
    preflight = build_aiq06_preflight(settings=settings())

    assert preflight.approved is False
    assert preflight.attempt_count == 6
    assert preflight.max_attempts == 12
    assert preflight.estimated_max_cost == Decimal("0.00486")
    assert "live_execution_not_approved" in preflight.block_reasons


def test_runner_fake_writes_safe_attempts_and_blind_artifacts(tmp_path: Path) -> None:
    preflight = build_aiq06_preflight(settings=settings(), live_execution_allowed=True)
    records = run_aiq06_evaluation(
        settings=settings(),
        preflight=preflight,
        output_dir=tmp_path / "evaluation",
        client_factory=FakeClient,
    )

    assert len(records) == 6
    assert all(record.hard_gate_passed for record in records)
    assert all(not record.fallback_used for record in records)
    assert all(record.human_evaluation_target for record in records)
    attempts = (tmp_path / "evaluation" / "attempts.jsonl").read_text(encoding="utf-8")
    assert SECRET not in attempts
    assert "samples" not in attempts
    assert "events" not in attempts
    assert '"input":' not in attempts
    assert '"instructions":' not in attempts

    blind = json.loads(
        (tmp_path / "evaluation" / "blind_materials.json").read_text(encoding="utf-8")
    )
    assert len(blind) == 6
    assert all("scenario_key" not in item for item in blind)
    assert all("model" not in item for item in blind)


def test_runner_never_calls_generator_when_preflight_is_blocked(tmp_path: Path) -> None:
    preflight = build_aiq06_preflight(settings=settings())
    calls = []

    def forbidden(*_args, **_kwargs):
        calls.append("called")
        raise AssertionError("blocked preflight must not call the generator")

    try:
        run_aiq06_evaluation(
            settings=settings(),
            preflight=preflight,
            output_dir=tmp_path,
            report_generator=forbidden,
        )
    except ValueError as exc:
        assert "live_execution_not_approved" in str(exc)
    else:
        raise AssertionError("blocked preflight unexpectedly passed")
    assert calls == []


def test_unknown_model_is_blocked_before_any_call() -> None:
    preflight = build_aiq06_preflight(
        settings=settings(model="unknown-model"),
        live_execution_allowed=True,
    )
    assert preflight.approved is False
    assert "pricing_unknown" in preflight.block_reasons


def test_cost_cap_is_blocked_before_any_call() -> None:
    preflight = build_aiq06_preflight(
        settings=settings(),
        live_execution_allowed=True,
        cost_cap=Decimal("0.001"),
    )
    assert preflight.approved is False
    assert "cost_cap_exceeded" in preflight.block_reasons


def test_runner_records_provider_timeout_as_timeout_not_validator_failure(tmp_path: Path) -> None:
    preflight = build_aiq06_preflight(settings=settings(), live_execution_allowed=True)

    def timeout(*_args, **_kwargs):
        raise TimeoutError("test timeout")

    records = run_aiq06_evaluation(
        settings=settings(),
        preflight=preflight,
        output_dir=tmp_path / "timeout-evaluation",
        report_generator=timeout,
    )

    assert all(record.attempt_status == AttemptStatus.TIMEOUT for record in records)
    assert all(record.hard_gate_passed is None for record in records)
    assert all(not record.human_evaluation_target for record in records)


def test_rate_limit_diagnostics_keep_only_safe_headers_and_code() -> None:
    class RateLimitError(Exception):
        code = "rate_limit_exceeded"
        status_code = 429
        response = type(
            "Response",
            (),
            {
                "headers": {
                    "x-ratelimit-remaining-requests": "0",
                    "x-ratelimit-reset-requests": "1s",
                    "authorization": "must-not-be-recorded",
                }
            },
        )()

    diagnostics = _safe_failure_diagnostics(RateLimitError())

    assert diagnostics["exception_type"] == "RateLimitError"
    assert diagnostics["code"] == "rate_limit_exceeded"
    assert diagnostics["status_code"] == 429
    assert diagnostics["rate_limit_headers"] == {
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "1s",
    }
    assert "authorization" not in json.dumps(diagnostics)
