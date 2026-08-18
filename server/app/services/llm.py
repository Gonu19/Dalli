from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
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
from app.services.fallback import (
    FallbackReportContent,
    days_since_last_app_run,
    running_purpose,
)
from app.services.metrics import RunMetrics
from app.services.report_quality import (
    HardGateReason,
    LLMReportContent,
    evaluate_outgoing_payload,
    evaluate_report_output,
)
from app.services.run_quality import RunQualityAssessment
from app.services.plans import effective_plan_status
from app.services.stats import count_this_week_run_days, current_week_bounds


logger = logging.getLogger(__name__)


_days_since_last_app_run = days_since_last_app_run


class HardGateViolation(ValueError):
    def __init__(self, reasons: tuple[HardGateReason, ...]):
        super().__init__("LLM hard gate failed")
        self.reasons = reasons


def _safe_summary(
    run: Run,
    quality: RunQualityAssessment,
    metrics: RunMetrics,
    fallback: FallbackReportContent,
    *,
    now: datetime | None = None,
) -> dict[str, object]:
    user = getattr(run, "user", None)
    current = now or datetime.now(timezone.utc)
    week_start, week_end, today = current_week_bounds(current)
    user_runs = getattr(user, "runs", None) or []
    week_plans = [
        plan
        for plan in (getattr(user, "plans", None) or [])
        if week_start <= plan.planned_date < week_end
    ]
    return {
        "duration_sec": run.duration_sec,
        "distance_m": run.distance_m,
        "goal_type": run.goal_type,
        "goal_value": run.goal_value,
        "condition": run.condition,
        "completed": run.completed,
        "running_purpose": running_purpose(run),
        "weekly_goal_count": getattr(user, "weekly_goal_count", None),
        "this_week_run_count": count_this_week_run_days(user_runs, current),
        "days_since_last_run": days_since_last_app_run(run),
        "this_week_plan_done": sum(
            effective_plan_status(
                stored_status=plan.status,
                planned_date=plan.planned_date,
                has_run=plan.run is not None,
                today=today,
            )
            == "DONE"
            for plan in week_plans
        ),
        "this_week_plan_total": len(week_plans),
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
    failure_observer: Callable[[Exception], None] | None = None,
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
                "리듬 일관성을 강조하세요. this_week_run_count와 this_week_plan_done/total은 모든 목적의 판단 근거로 사용하되, "
                "evidence에 루틴 숫자를 넣는 것은 HABIT일 때만 허용하세요. 다른 목적에서는 recovery_note와 prescription의 근거로만 쓰세요. "
                "days_since_last_run이 null이면 간격을 언급하는 문장을 생략하세요. days_since_last_run이 1 이하이고 "
                "fatigue_index가 0.6 이상이면 recovery_note는 회복을 우선하는 방향으로 쓰고, 5일 이상처럼 간격이 충분하면 "
                "짧은 간격을 전제로 한 회복 문구를 쓰지 마세요. 체중, 칼로리, 감량 수치는 만들지 말고 더 빨리 또는 더 자주 달리라고 재촉하지 마세요. "
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
        if failure_observer is not None:
            try:
                failure_observer(exc)
            except Exception:
                # Evaluation diagnostics must never affect the report path.
                pass
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
