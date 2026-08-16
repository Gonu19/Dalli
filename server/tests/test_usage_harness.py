from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.usage_harness import (
    AttemptJsonlWriter,
    BudgetExceeded,
    GPT_4O_MINI_PRICING,
    build_attempt_record,
    build_preflight,
    calculate_cost,
    enforce_preflight,
    build_evaluation_summary,
    write_evaluation_summary,
    run_guarded_call,
    UsageRecord,
)


def response(*, status="completed", usage=None, model="gpt-4o-mini", response_id="resp_test", request_id=None):
    return SimpleNamespace(
        id=response_id,
        model=model,
        _request_id=request_id,
        status=status,
        usage=usage,
        incomplete_details=SimpleNamespace(reason="max_output_tokens") if status == "incomplete" else None,
    )


def usage(input_tokens=1000, cached_tokens=200, output_tokens=300, total_tokens=1300):
    return SimpleNamespace(
        input_tokens=input_tokens,
        input_tokens_details=SimpleNamespace(cached_tokens=cached_tokens),
        output_tokens=output_tokens,
        output_tokens_details=SimpleNamespace(reasoning_tokens=0),
        total_tokens=total_tokens,
    )


def times():
    return (
        datetime(2026, 8, 16, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 8, 16, 0, 0, 1, 250000, tzinfo=timezone.utc),
    )


def report():
    return {
        "verdict": "오늘의 리듬을 확인했어요.",
        "evidence": [{"label": "평균 리듬", "value": "170 spm"}],
        "hypothesis": "후반에 부담이 커졌을 수 있어요.",
        "prescription": "다음에는 초반 10분을 편하게 시작해요.",
        "next_goal_text": "나의 기준 리듬을 지켜요.",
        "next_target_min": 168,
        "next_target_max": 172,
        "recovery_note": "가볍게 회복해요.",
        "limitation": "센서 자료가 제한적일 수 있어요.",
        "unexpected_prompt": "must not be persisted",
    }


def test_usage_normalizes_current_responses_fields_and_calculates_decimal_cost():
    normalized = UsageRecord.from_response(response(usage=usage()))
    assert normalized.usage_status == "available"
    assert normalized.cached_input_tokens == 200
    cost = calculate_cost(normalized, GPT_4O_MINI_PRICING)
    assert cost.total_cost == Decimal("0.000315")
    assert cost.uncached_input_cost == Decimal("0.000120")


@pytest.mark.parametrize(
    "raw, status, diagnostic",
    [
        (None, "missing", "usage_missing"),
        (SimpleNamespace(input_tokens=100, output_tokens=20, total_tokens=999), "invalid", "total_tokens_mismatch"),
        (usage(total_tokens=999), "invalid", "total_tokens_mismatch"),
        (usage(cached_tokens=1200), "invalid", "cached_tokens_exceed_input_tokens"),
    ],
)
def test_usage_missing_partial_and_mismatch_are_explicit(raw, status, diagnostic):
    normalized = UsageRecord.from_response(response(usage=raw))
    assert normalized.usage_status == status
    if diagnostic:
        assert diagnostic in normalized.diagnostics


def test_attempt_record_preserves_status_id_truncation_and_only_nine_report_fields():
    started, ended = times()
    record = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="stable_finish",
        attempt_index=1,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(usage=usage()),
        report=report(),
        hard_gate_passed=True,
        pricing=GPT_4O_MINI_PRICING,
    )
    data = record.to_dict()
    assert data["attempt_status"] == "completed"
    assert data["response_id"] == "resp_test"
    assert data["request_id"] is None
    assert data["input_usd_per_million"] == "0.15"
    assert data["attempt_cost"] == "0.000315"
    assert data["cumulative_confirmed_cost"] == "0.000315"
    assert data["cumulative_upper_bound"] == "0.000315"
    assert data["elapsed_ms"] == 1250
    assert set(data["structured_report"]) == {
        "verdict", "evidence", "hypothesis", "prescription", "next_goal_text",
        "next_target_min", "next_target_max", "recovery_note", "limitation",
    }
    assert "unexpected_prompt" not in data["structured_report"]

    incomplete = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="truncated",
        attempt_index=2,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(status="incomplete", usage=usage()),
        pricing=GPT_4O_MINI_PRICING,
    )
    assert incomplete.truncation is True
    assert incomplete.truncation_status == "known"
    assert incomplete.attempt_status == "incomplete"


@pytest.mark.parametrize(
    "exc, expected",
    [
        (TimeoutError(), "timeout"),
        (ValueError("bad json"), "provider_error"),
        (type("ValidationError", (Exception,), {})(), "schema_failed"),
        (type("HardGateViolation", (Exception,), {})(), "validator_failed"),
    ],
)
def test_failure_records_never_require_a_response(exc, expected):
    started, ended = times()
    record = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="failure",
        attempt_index=1,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        exception=exc,
        fallback_used=True,
        pricing=GPT_4O_MINI_PRICING,
    )
    assert record.attempt_status == expected
    assert record.fallback_used is True
    assert record.cost.cost_status == "unknown"


def test_preflight_blocks_without_approval_and_enforces_max_attempts_and_cost_cap():
    preflight = build_preflight(
        requested_model="gpt-4o-mini",
        scenario_ids=["a", "b", "c", "d", "e", "f"],
        repeat_count=1,
        max_attempts=12,
        estimated_max_input_tokens=3000,
        estimated_max_output_tokens=600,
        cost_cap=Decimal("0.01"),
        pricing=GPT_4O_MINI_PRICING,
    )
    assert preflight.attempt_count == 6
    assert preflight.estimated_max_cost == Decimal("0.00486")
    assert preflight.approved is False
    assert "live_execution_not_approved" in preflight.block_reasons
    with pytest.raises(BudgetExceeded):
        enforce_preflight(preflight)
    calls = []
    with pytest.raises(BudgetExceeded):
        run_guarded_call(preflight, lambda: calls.append("network"))
    assert calls == []

    approved = build_preflight(
        requested_model="gpt-4o-mini",
        scenario_ids=["a"] * 13,
        repeat_count=1,
        max_attempts=12,
        estimated_max_input_tokens=1,
        estimated_max_output_tokens=1,
        cost_cap=Decimal("1"),
        pricing=GPT_4O_MINI_PRICING,
        live_execution_allowed=True,
    )
    assert "max_attempts_exceeded" in approved.block_reasons


def test_unknown_pricing_is_blocked_and_artifact_writer_excludes_prompt(tmp_path):
    preflight = build_preflight(
        requested_model="future-model",
        scenario_ids=["a"],
        repeat_count=1,
        max_attempts=12,
        estimated_max_input_tokens=1,
        estimated_max_output_tokens=1,
        cost_cap=Decimal("1"),
        pricing=None,
        live_execution_allowed=True,
    )
    assert preflight.approved is False
    assert "pricing_unknown" in preflight.block_reasons
    started, ended = times()
    record = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="a",
        attempt_index=1,
        requested_model="future-model",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(usage=usage()),
        report=report(),
        hard_gate_passed=True,
        pricing=None,
    )
    path = tmp_path / "artifacts" / "attempts.jsonl"
    AttemptJsonlWriter(path).append(record)
    text = path.read_text(encoding="utf-8")
    assert "must not be persisted" not in text
    assert "samples" not in text
    assert "events" not in text


def test_response_model_mismatch_does_not_use_requested_model_price_and_missing_usage_keeps_reserve():
    started, ended = times()
    mismatch = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="model-mismatch",
        attempt_index=1,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(usage=usage(), model="gpt-4o"),
        pricing=GPT_4O_MINI_PRICING,
    )
    assert mismatch.actual_model == "gpt-4o"
    assert mismatch.cost.cost_status == "unknown"
    assert mismatch.cost.reason == "actual_model_pricing_unknown"
    assert mismatch.pricing_id is None

    missing = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="missing-usage",
        attempt_index=2,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(usage=None, request_id="req_safe"),
        pricing=GPT_4O_MINI_PRICING,
        reserved_max_cost=Decimal("0.001"),
        prior_confirmed_cost=Decimal("0.000315"),
        prior_upper_bound=Decimal("0.000315"),
    )
    assert missing.request_id == "req_safe"
    assert missing.cost.total_cost is None
    assert missing.cumulative_confirmed_cost == "0.000315"
    assert missing.cumulative_upper_bound == "0.001315"

    model_missing = build_attempt_record(
        evaluation_run_id="eval-fixed",
        scenario_id="model-missing",
        attempt_index=3,
        requested_model="gpt-4o-mini",
        prompt_version="prompt-v1",
        started_at=started,
        ended_at=ended,
        response=response(usage=usage(), model=None),
        pricing=GPT_4O_MINI_PRICING,
    )
    assert model_missing.actual_model is None
    assert model_missing.cost.reason == "actual_model_missing"


def test_run_summary_separates_aggregate_cost_and_unknown_attempts(tmp_path):
    preflight = build_preflight(
        requested_model="gpt-4o-mini",
        scenario_ids=["a", "b"],
        repeat_count=1,
        max_attempts=12,
        estimated_max_input_tokens=1000,
        estimated_max_output_tokens=300,
        cost_cap=Decimal("1"),
        pricing=GPT_4O_MINI_PRICING,
        live_execution_allowed=False,
    )
    started, ended = times()
    records = [
        build_attempt_record(
            evaluation_run_id=preflight.evaluation_run_id,
            scenario_id="a",
            attempt_index=1,
            requested_model="gpt-4o-mini",
            prompt_version="v1",
            started_at=started,
            ended_at=ended,
            response=response(usage=usage()),
            pricing=GPT_4O_MINI_PRICING,
        ),
        build_attempt_record(
            evaluation_run_id=preflight.evaluation_run_id,
            scenario_id="b",
            attempt_index=1,
            requested_model="gpt-4o-mini",
            prompt_version="v1",
            started_at=started,
            ended_at=ended,
            response=response(usage=None),
            pricing=GPT_4O_MINI_PRICING,
            reserved_max_cost=Decimal("0.001"),
            prior_confirmed_cost=Decimal("0.000315"),
            prior_upper_bound=Decimal("0.000315"),
        ),
    ]
    summary = build_evaluation_summary(preflight, records)
    assert summary["confirmed_cost"] == "0.000315"
    assert summary["usage_unknown_attempt_count"] == 1
    assert summary["cumulative_upper_bound"] == "0.001315"
    path = tmp_path / "summary.json"
    write_evaluation_summary(path, preflight, records)
    assert "structured_report" not in path.read_text(encoding="utf-8")
