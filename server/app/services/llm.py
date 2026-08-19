from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
import json
import logging
from statistics import median
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


def _sample_pairs(run: Run) -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for sample in run.samples or []:
        if not isinstance(sample, dict):
            continue
        second = sample.get("t")
        cadence = sample.get("c")
        if (
            isinstance(second, (int, float))
            and not isinstance(second, bool)
            and isinstance(cadence, (int, float))
            and not isinstance(cadence, bool)
        ):
            pairs.append((float(second), float(cadence)))
    return sorted(pairs)


def _detail_time_blocks(run: Run) -> list[dict[str, int]]:
    if not isinstance(run.duration_sec, int) or run.duration_sec <= 0:
        return []
    samples = _sample_pairs(run)
    blocks: list[dict[str, int]] = []
    for index in range(3):
        start_sec = (run.duration_sec * index) // 3
        end_sec = (run.duration_sec * (index + 1)) // 3
        cadences = [
            cadence
            for second, cadence in samples
            if start_sec <= second < end_sec
        ]
        block = {
            "block_index": index + 1,
            "start_sec": start_sec,
            "end_sec": end_sec,
        }
        if cadences:
            block["median_cadence"] = round(median(cadences))
        blocks.append(block)
    return blocks


def _detail_rapid_changes(run: Run) -> list[dict[str, int | str]]:
    samples = _sample_pairs(run)
    changes: list[dict[str, int | str]] = []
    for event in run.events or []:
        if not isinstance(event, dict) or event.get("type") not in {"TOO_FAST", "TOO_SLOW"}:
            continue
        event_time = event.get("t")
        if not isinstance(event_time, (int, float)) or isinstance(event_time, bool):
            continue
        payload = event.get("payload")
        after = payload.get("cadence") if isinstance(payload, dict) else None
        if not isinstance(after, (int, float)) or isinstance(after, bool):
            after_values = [cadence for second, cadence in samples if second >= float(event_time)]
            after = after_values[0] if after_values else None
        before_values = [cadence for second, cadence in samples if second < float(event_time)]
        before = before_values[-1] if before_values else None
        if before is None or after is None:
            continue
        changes.append(
            {
                "at_sec": round(float(event_time)),
                "direction": "상승" if event.get("type") == "TOO_FAST" else "하락",
                "before_cadence": round(float(before)),
                "after_cadence": round(float(after)),
            }
        )
        if len(changes) == 3:
            break
    return changes


LLM_REPORT_INSTRUCTIONS_V2 = """당신은 초보 러너를 돕는 달리(Dalli)의 차분한 러닝메이트입니다.
입력 JSON은 서버가 계산한 요약값입니다. 원본 samples/events는 제공되지 않으며, 서버가 계산한 detail_time_blocks와 detail_rapid_changes가 있을 때만 그 aggregate를 사용하세요. 입력에 없는 사실·수치·원인을 만들지 마세요.

출력 규칙:
- LLMReportContent의 필드만 JSON으로 반환하세요. 필드명과 next_target_min/max는 변경하지 마세요.
- verdict, evidence, hypothesis, prescription, next_goal_text, recovery_note, limitation의 문장은 모두 자연스러운 한국어로 작성하세요. 내부 용어인 cadence, baseline, Fatigue Index, Rhythm Score, cooldown, enum, 필드명은 사용자 문구에 쓰지 마세요.
- 상세 리포트는 사용자에게 보이는 텍스트 합계가 최소 300자 이상이 되도록 작성하세요. 길이보다 관찰 해석이 우선이며, 같은 문장이나 수치를 반복해 분량을 채우지 마세요. detail_time_blocks와 detail_rapid_changes가 있으면 해당 항목의 개수만큼만 설명하세요. 변화 구간이 3개보다 적으면 없는 변화를 만들지 마세요.
- verdict는 전체 흐름을 1~2문장으로 설명하고 원인이나 사용자의 태도를 단정하지 마세요.
- detail_time_blocks가 있으면 전체 시간을 3등분한 순서대로 각 구간을 설명하세요. detail_rapid_changes가 있으면 각 급격한 변화의 전후 리듬과 방향을 설명하고, 각 변화마다 가능한 원인을 hypothesis에 한 문장씩 작성하세요. 변화가 1개 또는 2개라면 그 개수만큼만 작성하세요.
- evidence는 핵심 관찰 수치 1~3개만 넣으세요. 입력 JSON의 null이 아닌 값만 사용하고, 없는 수치를 추정하거나 새로 계산하지 마세요. 가능한 표현은 다음처럼 입력 필드와 직접 대응해야 합니다: rhythm_score는 안정 구간 퍼센트, avg_cadence/current_target/next_target은 리듬과 spm, avg_pace_sec_per_km는 초/km, distance_m는 m 또는 입력이 정확히 1000m 단위일 때 km, duration_sec/active_duration_sec/in_range_sec는 초 또는 정확히 분으로, intervention_count/downshift_count는 회로 표시하세요. fatigue_index는 숫자 대신 여유로움·보통·부담됨 중 입력에 맞는 라벨을 사용하세요. detail_time_blocks/detail_rapid_changes의 start_sec/end_sec/at_sec는 초 또는 정확히 분으로, *_cadence는 리듬과 spm으로만 표시하세요. 해당 값이 없으면 그 항목을 쓰지 마세요.
- HABIT이 아니면 evidence에 이번 주 횟수, 계획 횟수, 러닝 간격 같은 루틴 수치를 넣지 마세요. HABIT일 때만 입력에 있는 루틴 수치를 사용할 수 있습니다.
- 목적은 verdict·evidence·prescription·next_goal_text·recovery_note의 강조점에만 반영하세요. next_target_min/max는 어떤 목적에서도 서버가 결정한 값을 그대로 유지하세요. COMPLETE는 completed와 안정 구간을 먼저 보고 초반 과속 억제와 끊지 않는 완주를 강조하세요. HABIT은 days_since_last_run과 weekly_goal_count를 바탕으로 다음 러닝 시점을 제안하고, evidence에 주간 횟수와 직전 러닝 간격을 HABIT일 때만 넣으세요. days_since_last_run이 null이면 HABIT 문구 어디에도 러닝 간격을 언급하지 마세요. WEIGHT는 active_duration_sec을 먼저 보고 강도가 아니라 편안한 활동 시간 연장에 집중하고, 시간 제안은 next_goal_text 문구일 뿐 next_target 수치를 바꾸는 근거로 사용하지 마세요. 체중·칼로리·감량 수치는 만들지 마세요. FITNESS는 late_drop_rate와 후반 유지력, PERFORMANCE는 안정 구간·평균 페이스·개입 횟수와 리듬 일관성을 먼저 보세요.
- hypothesis는 관찰과 분리된 가능한 원인입니다. detail_rapid_changes가 있으면 변화마다 한 문장씩 작성하고, 반드시 '~일 수 있어요'처럼 가능성으로 표현하세요. 근거가 부족하면 null로 두며, 의료 진단, 통증 원인 단정, 치료·약물 조언은 금지합니다.
- prescription은 다음 러닝에서 할 행동 한 가지만 구체적으로 제안하세요. 여러 행동을 나열하지 말고, 목적별로 COMPLETE는 초반 과속 억제와 끊지 않는 완주, HABIT은 다음 러닝 시점, WEIGHT는 강도가 아닌 편안한 지속 시간, FITNESS는 후반 유지력, PERFORMANCE는 리듬 일관성에 초점을 두세요. 더 빨리 또는 더 자주 달리라고 재촉하지 마세요.
- next_goal_text는 다음 목표 한 문장입니다. 서버가 준 next_target_min/max를 절대 바꾸지 말고, 두 값의 중심 리듬만 사용자 문구에 표시하세요. 목표를 낮춘 러닝이나 RECOVERY_MODE_ON으로 끝난 러닝을 실패·부족함으로 표현하지 마세요.
- recovery_note는 일반적인 비의료성 회복 안내 한 가지입니다. 직전 러닝과의 간격·부담 정보가 입력에 있을 때만 구체화하고, 입력이 부족하면 null로 두세요. 최근 간격이 짧고 부담됨이면 회복 우선, 충분히 쉬었으면 짧은 간격을 전제로 한 문구를 쓰지 마세요.
- days_since_last_run이 1 이하이고 fatigue_index가 0.6 이상이거나 RECOVERY_MODE_ON으로 끝난 러닝이면 recovery_note와 prescription 모두 회복 우선으로 작성하고, 목적별 처방보다 회복 안내를 먼저 두세요. days_since_last_run이 null이면 간격을 전제로 한 회복 문구를 쓰지 마세요.
- limitation은 required_limitation 값을 그대로 복사하세요. 값이 null이면 null을 반환하고, GPS·센서·시간 제한을 새로 만들거나 지우지 마세요.
- 모든 텍스트는 차분하고 구체적인 자연스러운 한국어로 작성하세요. 내부 용어인 cadence, baseline, spm, Fatigue Index, Rhythm Score, cooldown, enum, 필드명은 사용자 문구에 쓰지 마세요. 과장, 비난, 경쟁·감량·칼로리 수치, 의료 표현, 생리 수치 추정, 영어 문장을 넣지 마세요."""


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
        "detail_time_blocks": _detail_time_blocks(run),
        "detail_rapid_changes": _detail_rapid_changes(run),
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
            instructions=LLM_REPORT_INSTRUCTIONS_V2,
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
