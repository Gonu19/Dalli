from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from types import SimpleNamespace
import time
from uuid import uuid4

import httpx2
from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    InternalServerError,
    RateLimitError,
)
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.models import Plan, Run, User
from app.services.fallback import build_fallback_report
from app.services.llm import (
    LLMReportContent,
    LLM_REPORT_INSTRUCTIONS_V3,
    _call_with_deadline,
    _days_since_last_app_run,
    _safe_summary,
    generate_llm_report,
)
from app.services.metrics import compute_run_metrics
from app.services.report_quality import HardGateReason, HardGateResult
from app.services.run_quality import assess_run_quality


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)
SECRET = "test-openai-key-sensitive-value"


def run() -> Run:
    owner = User(id=uuid4(), device_uuid="llm-test", created_at=NOW, updated_at=NOW)
    return Run(
        id=uuid4(),
        user_id=owner.id,
        client_run_id="llm-run",
        source="APP",
        started_at=NOW,
        goal_type="TIME",
        goal_value=600,
        condition=3,
        target_cadence_min=153,
        target_cadence_max=161,
        final_target_min=153,
        final_target_max=161,
        duration_sec=600,
        distance_m=2000,
        avg_cadence=157,
        avg_pace_sec_per_km=300,
        completed=True,
        rhythm_score=Decimal("1.000"),
        late_drop_rate=Decimal("0.000"),
        fatigue_index=Decimal("0.100"),
        intervention_count=0,
        downshift_count=0,
        samples=[{"t": t, "c": 157} for t in range(0, 600, 5)],
        events=[],
        created_at=NOW,
    )


def settings(*, enabled: bool = True, key: str = SECRET) -> Settings:
    return Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="test-only-jwt-secret-with-sufficient-length",
        openai_api_key=key,
        llm_enabled=enabled,
        openai_model="gpt-4o-mini",
        llm_timeout_sec=1,
    )


def valid_payload(next_min: int, next_max: int, limitation: str | None) -> dict:
    return {
        "verdict": "오늘은 안정적인 리듬을 이어간 러닝이에요.",
        "evidence": ["안정 구간 100%", "오늘의 부담: 여유로움"],
        "hypothesis": "일정한 리듬을 유지한 영향일 수 있어요.",
        "prescription": "다음 러닝도 시작부터 같은 리듬을 유지해 보세요.",
        "next_goal_text": "다음 목표: 10분 완주, 리듬 159",
        "next_target_min": next_min,
        "next_target_max": next_max,
        "recovery_note": "다음 러닝 전까지 편안하게 쉬어 주세요.",
        "limitation": limitation,
    }


def context():
    current_run = run()
    quality = assess_run_quality(current_run)
    metrics = compute_run_metrics(current_run, quality)
    fallback = build_fallback_report(current_run, quality, metrics)
    return current_run, quality, metrics, fallback


class FakeClient:
    def __init__(self, parsed=None, error: Exception | None = None):
        self.parsed = parsed
        self.error = error
        self.kwargs = None
        self.responses = self

    def parse(self, **kwargs):
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output_parsed=self.parsed)


def test_structured_llm_success_uses_safe_summary_and_no_retries() -> None:
    current_run, quality, metrics, fallback = context()
    fake = FakeClient(
        LLMReportContent.model_validate(
            valid_payload(fallback.next_target_min, fallback.next_target_max, fallback.limitation)
        )
    )
    factory_args = {}

    def factory(**kwargs):
        factory_args.update(kwargs)
        return fake

    content = generate_llm_report(
        current_run, quality, metrics, fallback, settings(), client_factory=factory
    )

    assert content is not None
    assert content.next_target_min == fallback.next_target_min
    assert factory_args == {"api_key": SECRET, "timeout": 1, "max_retries": 0}
    assert fake.kwargs["text_format"] is LLMReportContent
    assert fake.kwargs["max_output_tokens"] == 900
    assert fake.kwargs["store"] is False
    assert fake.kwargs["instructions"] == LLM_REPORT_INSTRUCTIONS_V3
    assert "문장은 모두 자연스러운 한국어" in LLM_REPORT_INSTRUCTIONS_V3
    assert "evidence는 핵심 관찰 수치 1~3개" in LLM_REPORT_INSTRUCTIONS_V3
    assert "prescription: 다음 러닝에서 할 행동 하나만" in LLM_REPORT_INSTRUCTIONS_V3
    assert "detail_time_blocks가 있으면 전체 시간을 3등분한 순서대로" in LLM_REPORT_INSTRUCTIONS_V3
    assert "detail_rapid_changes가 있으면 실제 변화의 개수만큼만 설명하세요" in LLM_REPORT_INSTRUCTIONS_V3
    assert "사용자 노출 텍스트 합계를 약 500자(450~550자)" in LLM_REPORT_INSTRUCTIONS_V3
    assert "선행 변화 → 뒤따른 지표 → 가능한 해석 → 다음 행동" in LLM_REPORT_INSTRUCTIONS_V3
    assert "인과관계를 확정하지 말고" in LLM_REPORT_INSTRUCTIONS_V3
    assert "next_target_min/max는 어떤 목적에서도 서버가 결정한 값을 그대로 유지" in LLM_REPORT_INSTRUCTIONS_V3
    assert "days_since_last_run이 null이면 HABIT 문구 어디에도 간격을 언급하지 마세요" in LLM_REPORT_INSTRUCTIONS_V3
    assert "체중·칼로리·감량 수치" in LLM_REPORT_INSTRUCTIONS_V3
    assert "required_limitation 값을 그대로 복사" in LLM_REPORT_INSTRUCTIONS_V3
    assert "samples" not in fake.kwargs["input"]
    assert "events" not in fake.kwargs["input"]
    assert SECRET not in fake.kwargs["input"]
    summary = json.loads(fake.kwargs["input"])
    assert summary["running_purpose"] == "COMPLETE"
    assert summary["weekly_goal_count"] is None
    assert summary["this_week_run_count"] == 0
    assert summary["days_since_last_run"] is None
    assert summary["this_week_plan_done"] == 0
    assert summary["this_week_plan_total"] == 0
    assert len(summary["detail_time_blocks"]) == 3
    assert summary["detail_time_blocks"][0]["median_cadence"] == 157
    assert summary["detail_rapid_changes"] == []
    assert summary["late_drop_analysis_status"] == "available"
    assert len(summary["segment_summary"]) == 3
    assert summary["segment_summary"][0]["median_cadence"] == 157
    assert summary["segment_summary"][2]["direction"] == "유지"


def test_safe_summary_exposes_only_derived_rapid_change_metadata() -> None:
    current_run, quality, metrics, fallback = context()
    current_run.events = [
        {"t": 300, "type": "TOO_FAST", "payload": {"cadence": 173, "secret": "drop"}},
        {"t": 400, "type": "TOO_SLOW", "payload": {"cadence": 140}},
        {"t": 500, "type": "TOO_FAST", "payload": {"cadence": 168}},
        {"t": 550, "type": "TOO_FAST", "payload": {"cadence": 175}},
    ]

    summary = _safe_summary(current_run, quality, metrics, fallback, now=NOW)

    assert len(summary["detail_rapid_changes"]) == 3
    assert summary["detail_rapid_changes"][0] == {
        "at_sec": 300,
        "direction": "상승",
        "before_cadence": 157,
        "after_cadence": 173,
    }
    assert "samples" not in summary
    assert "events" not in summary

    current_run.events = current_run.events[:2]
    summary_with_two_changes = _safe_summary(current_run, quality, metrics, fallback, now=NOW)
    assert len(summary_with_two_changes["detail_rapid_changes"]) == 2


def test_segment_summary_excludes_paused_samples_and_exposes_actual_deltas() -> None:
    current_run, quality, metrics, fallback = context()
    current_run.samples = [
        {"t": 0, "c": 150},
        {"t": 200, "c": 150},
        {"t": 205, "c": 190},
        {"t": 400, "c": 160},
    ]
    current_run.events = [
        {"t": 200, "type": "PAUSE"},
        {"t": 300, "type": "RESUME"},
    ]
    quality = assess_run_quality(current_run)
    summary = _safe_summary(current_run, quality, metrics, fallback, now=NOW)

    assert summary["segment_summary"] == [
        {
            "label": "초반",
            "start_sec": 0,
            "end_sec": 200,
            "sample_count": 1,
            "median_cadence": 150,
        },
        {
            "label": "중반",
            "start_sec": 200,
            "end_sec": 400,
            "sample_count": 0,
        },
        {
            "label": "후반",
            "start_sec": 400,
            "end_sec": 600,
            "sample_count": 1,
            "median_cadence": 160,
            "cadence_delta": 10,
            "direction": "상승",
        },
    ]


def test_safe_summary_uses_user_purpose_and_previous_app_run_only() -> None:
    owner = User(
        id=uuid4(),
        device_uuid="summary-user",
        running_purpose="HABIT",
        weekly_goal_count=4,
        created_at=NOW,
        updated_at=NOW,
    )
    current = run()
    current.user = owner
    previous_app = run()
    previous_app.started_at = NOW.replace(day=12)
    previous_app.user = owner
    manual = run()
    manual.started_at = NOW.replace(day=14)
    manual.source = "MANUAL"
    manual.user = owner
    owner.runs = [previous_app, manual, current]

    quality = assess_run_quality(current)
    metrics = compute_run_metrics(current, quality)
    fallback = build_fallback_report(current, quality, metrics)

    assert _days_since_last_app_run(current) == 3
    summary = _safe_summary(current, quality, metrics, fallback)
    assert summary["running_purpose"] == "HABIT"
    assert summary["weekly_goal_count"] == 4
    assert summary["days_since_last_run"] == 3


@pytest.mark.parametrize(
    "purpose",
    ("COMPLETE", "HABIT", "WEIGHT", "FITNESS", "PERFORMANCE"),
)
def test_safe_summary_includes_common_routine_fields_for_every_purpose(purpose) -> None:
    owner = User(
        id=uuid4(),
        device_uuid=f"summary-{purpose.lower()}",
        running_purpose=purpose,
        weekly_goal_count=3,
        created_at=NOW,
        updated_at=NOW,
    )
    current = run()
    current.user = owner
    owner.runs = [current]
    owner.plans = []

    quality = assess_run_quality(current)
    metrics = compute_run_metrics(current, quality)
    fallback = build_fallback_report(current, quality, metrics)
    summary = _safe_summary(current, quality, metrics, fallback, now=NOW)

    assert summary["running_purpose"] == purpose
    assert summary["weekly_goal_count"] == 3
    assert summary["this_week_run_count"] == 1
    assert summary["days_since_last_run"] is None
    assert summary["this_week_plan_done"] == 0
    assert summary["this_week_plan_total"] == 0


def test_safe_summary_reuses_kst_week_counts_for_runs_and_plans() -> None:
    reference = datetime(2026, 8, 18, 3, tzinfo=timezone.utc)
    owner = User(
        id=uuid4(),
        device_uuid="weekly-summary-user",
        weekly_goal_count=3,
        created_at=reference,
        updated_at=reference,
    )
    current = run()
    current.started_at = reference
    current.user = owner
    previous = run()
    previous.started_at = reference - timedelta(days=1)
    previous.user = owner
    owner.runs = [previous, current]
    done_plan = Plan(
        id=uuid4(),
        user_id=owner.id,
        planned_date=reference.date(),
        goal_type="TIME",
        goal_value=600,
        status="PLANNED",
        run=previous,
    )
    planned_plan = Plan(
        id=uuid4(),
        user_id=owner.id,
        planned_date=reference.date() + timedelta(days=1),
        goal_type="TIME",
        goal_value=600,
        status="PLANNED",
    )
    owner.plans = [done_plan, planned_plan]

    quality = assess_run_quality(current)
    metrics = compute_run_metrics(current, quality)
    fallback = build_fallback_report(current, quality, metrics)
    summary = _safe_summary(current, quality, metrics, fallback, now=reference)

    assert summary["this_week_run_count"] == 2
    assert summary["days_since_last_run"] == 1
    assert summary["this_week_plan_done"] == 1
    assert summary["this_week_plan_total"] == 2


def test_evaluation_observer_receives_only_in_memory_response_metadata() -> None:
    current_run, quality, metrics, fallback = context()
    fake = FakeClient(
        LLMReportContent.model_validate(
            valid_payload(fallback.next_target_min, fallback.next_target_max, fallback.limitation)
        )
    )
    observed = []
    content = generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(),
        client_factory=lambda **_: fake,
        response_observer=observed.append,
    )
    assert content is not None
    assert len(observed) == 1
    assert observed[0] is not None


@pytest.mark.parametrize(
    "parsed",
    [
        None,
        {"verdict": "누락된 응답"},
        {**valid_payload(155, 163, None), "unexpected": "field"},
        {**valid_payload(155, 163, None), "evidence": [123]},
        valid_payload(130, 140, None),
    ],
)
def test_empty_invalid_or_server_value_changing_output_falls_back(parsed) -> None:
    current_run, quality, metrics, fallback = context()
    fake = FakeClient(parsed)

    assert (
        generate_llm_report(
            current_run,
            quality,
            metrics,
            fallback,
            settings(),
            client_factory=lambda **_: fake,
        )
        is None
    )


def provider_errors() -> list[Exception]:
    request = httpx2.Request("POST", "https://api.openai.com/v1/responses")

    def response(status_code: int) -> httpx2.Response:
        return httpx2.Response(status_code, request=request)

    return [
        APITimeoutError(request),
        APIConnectionError(message="connection secret detail", request=request),
        AuthenticationError("auth secret detail", response=response(401), body=None),
        RateLimitError("rate secret detail", response=response(429), body=None),
        InternalServerError("provider secret detail", response=response(500), body=None),
        RuntimeError("unexpected sdk secret detail"),
    ]


@pytest.mark.parametrize("error", provider_errors())
def test_provider_failures_fall_back_without_secret_in_logs(error, caplog) -> None:
    current_run, quality, metrics, fallback = context()
    fake = FakeClient(error=error)

    assert (
        generate_llm_report(
            current_run,
            quality,
            metrics,
            fallback,
            settings(),
            client_factory=lambda **_: fake,
        )
        is None
    )
    assert SECRET not in caplog.text
    assert str(error) not in caplog.text
    diagnostic = json.loads(caplog.records[-1].message)
    assert diagnostic["event"] == "llm_report_fallback"
    assert diagnostic["run_id"] == str(current_run.id)
    assert diagnostic["stage"] in {"sdk_timeout", "provider", "deadline", "evaluator"}
    assert diagnostic["fallback"] is True
    assert diagnostic["model"] == "gpt-4o-mini"
    assert isinstance(diagnostic["elapsed_ms"], (int, float))
    assert "provider secret detail" not in json.dumps(diagnostic)


def test_disabled_or_missing_key_does_not_construct_client() -> None:
    current_run, quality, metrics, fallback = context()

    def forbidden(**_):
        raise AssertionError("external client must not be constructed")

    for current_settings in (settings(enabled=False), settings(key="")):
        assert (
            generate_llm_report(
                current_run,
                quality,
                metrics,
                fallback,
                current_settings,
                client_factory=forbidden,
            )
            is None
        )


def test_configuration_fallback_logs_formatter_safe_reason_and_stage(caplog) -> None:
    current_run, quality, metrics, fallback = context()
    caplog.set_level("INFO", logger="app.services.llm")

    generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(enabled=False),
    )
    disabled = json.loads(caplog.records[-1].message)
    assert disabled == {
        "elapsed_ms": disabled["elapsed_ms"],
        "event": "llm_report_fallback",
        "fallback": True,
        "model": "gpt-4o-mini",
        "reason_codes": ["disabled"],
        "run_id": str(current_run.id),
        "stage": "configuration",
    }

    caplog.clear()
    generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(key=""),
    )
    missing_key = json.loads(caplog.records[-1].message)
    assert missing_key["reason_codes"] == ["missing_api_key"]
    assert missing_key["stage"] == "configuration"
    assert SECRET not in caplog.text


def test_completed_false_analyzable_run_still_calls_provider() -> None:
    current_run, quality, metrics, fallback = context()
    current_run.completed = False
    fake = FakeClient(
        LLMReportContent.model_validate(
            valid_payload(fallback.next_target_min, fallback.next_target_max, fallback.limitation)
        )
    )

    content = generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(),
        client_factory=lambda **_: fake,
    )

    assert content is not None
    assert fake.kwargs is not None


def test_hard_gate_and_schema_failures_log_stable_stage_and_reasons(monkeypatch, caplog) -> None:
    current_run, quality, metrics, fallback = context()
    fake = FakeClient(valid_payload(fallback.next_target_min, fallback.next_target_max, fallback.limitation))
    caplog.set_level("INFO", logger="app.services.llm")

    monkeypatch.setattr(
        "app.services.llm.evaluate_report_output",
        lambda *_: HardGateResult(
            False,
            (HardGateReason.PROTECTED_VALUE_CHANGED, HardGateReason.NEXT_GOAL_CONTRADICTION),
        ),
    )
    assert (
        generate_llm_report(
            current_run,
            quality,
            metrics,
            fallback,
            settings(),
            client_factory=lambda **_: fake,
        )
        is None
    )
    hard_gate = json.loads(caplog.records[-1].message)
    assert hard_gate["stage"] == "output_hard_gate"
    assert hard_gate["reason_codes"] == [
        "PROTECTED_VALUE_CHANGED",
        "NEXT_GOAL_CONTRADICTION",
    ]

    monkeypatch.undo()
    caplog.clear()
    fake = FakeClient({"evidence": []})
    assert (
        generate_llm_report(
            current_run,
            quality,
            metrics,
            fallback,
            settings(),
            client_factory=lambda **_: fake,
        )
        is None
    )
    schema = json.loads(caplog.records[-1].message)
    assert schema["stage"] == "structured_schema"
    assert schema["reason_codes"] == ["EVIDENCE_COUNT_INVALID", "SCHEMA_INVALID"]


def test_deadline_returns_before_slow_provider_finishes() -> None:
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        _call_with_deadline(lambda: time.sleep(0.2), 0.02)
    assert time.monotonic() - started < 0.15


def test_schema_forbids_extra_fields_and_requires_nonempty_evidence() -> None:
    payload = valid_payload(153, 161, None)
    with pytest.raises(ValidationError):
        LLMReportContent.model_validate({**payload, "extra": True})
    with pytest.raises(ValidationError):
        LLMReportContent.model_validate({**payload, "evidence": []})
    schema = LLMReportContent.model_json_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "verdict",
        "evidence",
        "hypothesis",
        "prescription",
        "next_goal_text",
        "next_target_min",
        "next_target_max",
        "recovery_note",
        "limitation",
    }
