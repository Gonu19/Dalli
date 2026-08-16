from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import json
import logging
from typing import Callable

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)
from pydantic import ValidationError

from app.config import Settings
from app.models import Run
from app.services.fallback import FallbackReportContent, running_purpose
from app.services.metrics import RunMetrics
from app.services.report_quality import (
    HardGateReason,
    LLMReportContent,
    evaluate_outgoing_payload,
    evaluate_report_output,
)
from app.services.run_quality import RunQualityAssessment


logger = logging.getLogger(__name__)


class HardGateViolation(ValueError):
    def __init__(self, reasons: tuple[HardGateReason, ...]):
        super().__init__("LLM hard gate failed")
        self.reasons = reasons


def _days_since_last_app_run(run: Run) -> int | None:
    user = getattr(run, "user", None)
    if user is None or run.started_at is None:
        return None

    previous_runs = (
        candidate
        for candidate in (getattr(user, "runs", None) or [])
        if candidate is not run
        and candidate.id != run.id
        and candidate.source == "APP"
        and candidate.started_at is not None
        and candidate.started_at < run.started_at
    )
    previous = max(previous_runs, key=lambda candidate: candidate.started_at, default=None)
    if previous is None:
        return None
    return (run.started_at.date() - previous.started_at.date()).days


def _safe_summary(
    run: Run,
    quality: RunQualityAssessment,
    metrics: RunMetrics,
    fallback: FallbackReportContent,
) -> dict[str, object]:
    user = getattr(run, "user", None)
    return {
        "duration_sec": run.duration_sec,
        "distance_m": run.distance_m,
        "goal_type": run.goal_type,
        "goal_value": run.goal_value,
        "condition": run.condition,
        "completed": run.completed,
        "running_purpose": running_purpose(run),
        "weekly_goal_count": getattr(user, "weekly_goal_count", None),
        "days_since_last_run": _days_since_last_app_run(run),
        "avg_cadence": run.avg_cadence,
        "avg_pace_sec_per_km": run.avg_pace_sec_per_km,
        "intervention_count": run.intervention_count,
        "downshift_count": run.downshift_count,
        "rhythm_score": float(run.rhythm_score) if run.rhythm_score is not None else None,
        "late_drop_rate": float(run.late_drop_rate) if run.late_drop_rate is not None else None,
        "fatigue_index": float(run.fatigue_index) if run.fatigue_index is not None else None,
        "in_range_sec": metrics.in_range_sec,
        "active_duration_sec": quality.active_duration_sec,
        "next_target_min": fallback.next_target_min,
        "next_target_max": fallback.next_target_max,
        "required_limitation": fallback.limitation,
        "current_target_min": run.final_target_min,
        "current_target_max": run.final_target_max,
    }


def _call_with_deadline(call: Callable[[], object], timeout_sec: float) -> object:
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dalli-llm")
    future = executor.submit(call)
    try:
        return future.result(timeout=timeout_sec)
    except FutureTimeoutError:
        future.cancel()
        raise TimeoutError("LLM deadline exceeded") from None
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _failure_reason(exc: Exception) -> str:
    if isinstance(exc, (TimeoutError, APITimeoutError)):
        return HardGateReason.LLM_DEADLINE_EXCEEDED
    if isinstance(exc, AuthenticationError):
        return "authentication"
    if isinstance(exc, RateLimitError):
        return "rate_limit"
    if isinstance(exc, APIConnectionError):
        return "connection"
    if isinstance(exc, APIStatusError):
        return "provider_status"
    if isinstance(exc, (ValidationError, ValueError)):
        return HardGateReason.SCHEMA_INVALID
    return HardGateReason.EVALUATOR_ERROR


def generate_llm_report(
    run: Run,
    quality: RunQualityAssessment,
    metrics: RunMetrics,
    fallback: FallbackReportContent,
    settings: Settings,
    *,
    client_factory: Callable[..., object] = OpenAI,
    response_observer: Callable[[object], None] | None = None,
) -> LLMReportContent | None:
    api_key = settings.openai_api_key.get_secret_value()
    if not settings.llm_enabled:
        logger.info("llm_report_fallback", extra={"llm_reason": "disabled"})
        return None
    if not api_key:
        logger.warning("llm_report_fallback", extra={"llm_reason": "missing_api_key"})
        return None

    if run.source == "MANUAL":
        logger.warning(
            "llm_report_fallback",
            extra={
                "run_id": str(run.id),
                "llm_reason_codes": [HardGateReason.MANUAL_RUN_LLM_BLOCKED],
            },
        )
        return None
    if not quality.is_analyzable:
        logger.warning(
            "llm_report_fallback",
            extra={
                "run_id": str(run.id),
                "llm_reason_codes": [HardGateReason.UNANALYZABLE_RUN_LLM_BLOCKED],
            },
        )
        return None

    summary = _safe_summary(run, quality, metrics, fallback)
    payload_gate = evaluate_outgoing_payload(summary, run.samples, run.events)
    if not payload_gate.passed:
        logger.warning(
            "llm_report_fallback",
            extra={
                "run_id": str(run.id),
                "llm_reason_codes": list(payload_gate.reasons),
            },
        )
        return None

    def request() -> object:
        client = client_factory(
            api_key=api_key,
            timeout=settings.llm_timeout_sec,
            max_retries=0,
        )
        response = client.responses.parse(
            model=settings.openai_model,
            instructions=(
                "당신은 초보 러너의 차분한 러닝메이트입니다. 관찰과 가설을 구분하고, "
                "의료 진단이나 과장 없이 다음 행동 한 가지를 제안하세요. cadence, baseline, "
                "Fatigue Index 같은 내부 용어 대신 리듬, 나의 기준 리듬, 오늘의 부담을 사용하세요. "
                "제공된 수치와 next_target, required_limitation을 바꾸거나 새 수치를 만들지 마세요. "
                "running_purpose가 없으면 COMPLETE로 보고, 목적은 문구의 우선순위와 처방 축에만 반영하세요. "
                "COMPLETE는 completed와 안정 구간을 먼저 보고 초반 과속을 억제하며 끊지 않고 완주를 강조하세요. "
                "HABIT는 days_since_last_run과 weekly_goal_count를 바탕으로 다음 러닝 시점을 제안하고, "
                "이번 주 루틴을 이어가는 점을 강조하세요. WEIGHT는 active_duration_sec을 먼저 보고 "
                "강도가 아니라 편안한 지속 시간에 집중하세요. FITNESS는 late_drop_rate를 먼저 보고 "
                "후반 유지력과 안정 구간을 강조하세요. PERFORMANCE는 안정 구간과 평균 페이스를 보고 "
                "리듬 일관성을 강조하세요. 체중, 칼로리, 감량 수치는 만들지 말고 더 빨리 또는 더 자주 달리라고 재촉하지 마세요. "
                "RECOVERY_MODE_ON으로 끝난 러닝은 목적과 무관하게 회복을 우선하며 실패로 표현하지 마세요."
            ),
            input=json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            text_format=LLMReportContent,
            max_output_tokens=600,
            store=False,
        )
        # Evaluation-only callers may collect SDK usage/id metadata.  The
        # observer receives the response object in memory and is never called
        # by normal API requests; it must decide what safe fields to retain.
        if response_observer is not None:
            response_observer(response)
        return response.output_parsed

    try:
        parsed = _call_with_deadline(request, settings.llm_timeout_sec)
        gate = evaluate_report_output(parsed, fallback, summary)
        if not gate.passed or gate.content is None:
            raise HardGateViolation(gate.reasons)
        content = gate.content
    except Exception as exc:
        reasons = (
            list(exc.reasons)
            if isinstance(exc, HardGateViolation)
            else [_failure_reason(exc)]
        )
        logger.warning(
            "llm_report_fallback",
            extra={
                "run_id": str(run.id),
                "llm_reason_codes": reasons,
                "llm_fallback": True,
            },
        )
        return None

    logger.info(
        "llm_report_success",
        extra={"llm_model": settings.openai_model, "llm_fallback": False},
    )
    return content


def llm_values(content: LLMReportContent, model: str) -> dict[str, object]:
    return {**content.model_dump(), "is_fallback": False, "model": model}
