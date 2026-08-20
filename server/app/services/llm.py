from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
import json
import logging
from statistics import median
import time
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
from app.services.metrics import MIN_LATE_DROP_DURATION_SEC, RunMetrics
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


def _reason_value(reason: object) -> str:
    return str(getattr(reason, "value", reason))


def log_llm_event(
    level: int,
    event: str,
    run: Run,
    *,
    stage: str,
    reason_codes: tuple[object, ...] | list[object] = (),
    fallback: bool,
    model: str | None,
    started_at: float,
    provider_status_code: int | None = None,
) -> None:
    """Emit only the allowlisted LLM diagnostics as a formatter-safe JSON line."""
    codes = [_reason_value(reason) for reason in reason_codes]
    fields = {
        "event": event,
        "run_id": str(run.id),
        "stage": stage,
        "reason_codes": codes,
        "fallback": fallback,
        "model": model,
        "elapsed_ms": round(max(0.0, time.monotonic() - started_at) * 1000, 1),
    }
    if provider_status_code is not None:
        fields["provider_status_code"] = provider_status_code

    # Keep the same safe fields in ``extra`` for collectors that support them,
    # while putting the canonical representation in the message because the
    # default Uvicorn formatter drops arbitrary ``extra`` fields.
    logger.log(
        level,
        json.dumps(fields, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        extra={
            "llm_event": event,
            "llm_run_id": str(run.id),
            "llm_stage": stage,
            "llm_reason_codes": codes,
            "llm_fallback": fallback,
            "llm_model": model,
            "llm_elapsed_ms": fields["elapsed_ms"],
            **(
                {"llm_provider_status_code": provider_status_code}
                if provider_status_code is not None
                else {}
            ),
        },
    )


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


def _segment_summary(
    run: Run,
    quality: RunQualityAssessment,
) -> list[dict[str, int | str]]:
    """Expose only deterministic, user-relevant cadence changes to the LLM."""
    if not isinstance(run.duration_sec, int) or run.duration_sec <= 0:
        return []

    samples = [
        (second, cadence)
        for second, cadence in _sample_pairs(run)
        if not any(interval.start <= second < interval.end for interval in quality.pause_intervals)
    ]
    summaries: list[dict[str, int | str]] = []
    previous_median: int | None = None
    labels = ("초반", "중반", "후반")
    for index, label in enumerate(labels):
        start_sec = (run.duration_sec * index) // 3
        end_sec = (run.duration_sec * (index + 1)) // 3
        values = [
            cadence
            for second, cadence in samples
            if start_sec <= second < end_sec
        ]
        item: dict[str, int | str] = {
            "label": label,
            "start_sec": start_sec,
            "end_sec": end_sec,
            "sample_count": len(values),
        }
        if values:
            current_median = round(median(values))
            item["median_cadence"] = current_median
            if previous_median is not None:
                delta = current_median - previous_median
                item["cadence_delta"] = delta
                item["direction"] = "상승" if delta > 0 else "하락" if delta < 0 else "유지"
            previous_median = current_median
        summaries.append(item)
    return summaries


LLM_REPORT_INSTRUCTIONS_V3 = """당신은 초보 러너를 돕는 달리(Dalli)의 차분하고 정확한 러닝메이트입니다.

입력 JSON은 서버가 계산한 사실입니다. 원본 samples/events는 제공되지 않습니다. 입력에 없는 수치·구간·원인·감정을 만들지 말고, null·빈 배열·없는 구간은 언급하지 마세요.

작성 순서:
1. verdict: 화면에 표시되는 AI 한줄평입니다. 정확히 한 문장으로 작성하세요. running_purpose, completed, segment_summary와 핵심 지표를 종합해 목적과 이번 러닝의 전체 결과를 해석하세요. `completed`라는 필드명이나 COMPLETE 같은 내부 enum을 그대로 출력하지 마세요. COMPLETE는 완주를 목표로 한 러닝으로 해석하되, 실제 완주 여부는 completed 값으로 따로 판단하세요. 근거 없는 칭찬이나 실패 판정은 하지 마세요.
2. evidence: 입력값과 직접 대응하는 관찰 근거 2~3개를 쓰세요. 각 항목은 관찰 수치·시간 또는 구간·변화나 의미를 포함하는 자연스러운 문장으로 작성하세요. 안정 구간·평균 리듬·후반 변화·개입·활동 시간 중 실제로 의미 있는 값만 고르세요. 가능하면 먼저 나타난 변화와 뒤따른 지표를 한 쌍으로 묶으세요.
3. hypothesis: detail_rapid_changes 또는 segment_summary에서 시간 순서가 보이고 다른 지표가 함께 변할 때만 가능한 원인을 1~2문장으로 씁니다. 관찰된 선행 변화와 뒤따른 지표를 연결해 각 원인을 '~일 수 있어요'로 끝내고, 근거가 부족하면 null입니다.
4. prescription: 다음 러닝에서 할 행동 하나만 제안하세요. verdict/evidence에서 연결한 흐름 중 사용자가 조절할 수 있는 첫 지점과 직접 연결하고, 그 행동이 필요한 이유를 함께 설명하세요. 여러 행동을 나열하지 마세요.
5. next_goal_text: 서버가 준 next_target_min/max를 절대 바꾸지 말고 중심 리듬 하나와 그 리듬을 유지하는 방법으로 자연스럽게 설명하세요. 목표 범위 두 숫자를 사용자 문장에 표시하지 마세요.
6. recovery_note: 입력 JSON에 회복 필요를 직접 나타내는 값이나 문구가 있을 때만 비의료성 회복 안내 한 가지를 쓰고, 아니면 null입니다. 입력에 없는 recovery_mode를 추정하지 마세요.

세부 규칙:
- LLMReportContent의 필드만 JSON으로 반환하세요. 문장은 모두 자연스러운 한국어로 작성하세요.
- 정보가 충분하면 verdict/evidence/hypothesis/prescription/next_goal_text/recovery_note/limitation의 사용자 노출 텍스트 합계를 약 500자(450~550자)로 작성하세요. 데이터가 부족하거나 해당 필드가 null이면 반복·추측으로 분량을 채우지 말고 가능한 범위에서 구체적으로 작성하세요.
- 입력 JSON에 관찰 근거가 2개 이상 있으면 위 분량을 지키고, verdict는 한 문장으로 전체 결과를 요약하세요. evidence는 2~3개를 유지하고, hypothesis·prescription·next_goal_text는 각각 근거와 의미가 드러나는 2문장 이내로 작성하세요.
- detail_time_blocks가 있으면 전체 시간을 3등분한 순서대로 참고하세요. segment_summary의 값이 없으면 그 구간을 추정하지 마세요.
- detail_rapid_changes가 있으면 실제 변화의 개수만큼만 설명하세요. 변화가 1개 또는 2개라면 그 개수만 작성하세요.
- 숫자 사용 규칙: 입력 JSON에 실제로 존재하는 숫자만 사용하세요. 입력에 없는 시각·리듬·퍼센트·횟수·거리·시간을 절대 만들지 마세요. 입력값을 다른 숫자로 바꾸지 마세요. 단위 변환과 자연스러운 반올림만 허용합니다.
- start_sec/end_sec는 입력값을 기준으로 한 시간 표현에만 사용하세요. cadence와 median_cadence는 입력값 그대로 사용하세요. rhythm_score와 late_drop_rate는 입력값을 퍼센트로 변환할 수 있지만, 임의의 퍼센트를 만들지 마세요.
- 숫자 근거가 없으면 숫자를 쓰지 말고 자연어로 설명하세요. 숫자 근거가 없는 문장은 삭제하거나 숫자 없는 문장으로 다시 작성하세요. next_target_min/max는 입력값을 한 자리도 바꾸지 마세요.
- evidence는 핵심 관찰 수치 1~3개만 넣으세요. rhythm_score/late_drop_rate는 안정 구간/후반 하락 퍼센트로, cadence/median_cadence/cadence_delta는 리듬 spm으로, duration_sec/active_duration_sec/in_range_sec는 60초 이상을 원시 초 단위로 쓰지 말고 정확한 분·초로 표현하세요. 예를 들어 548초는 '9분 8초'로 표현하세요. fatigue_index는 숫자 대신 여유로움·보통·부담됨으로 표현하세요.
- 라벨과 단위를 정확히 맞추세요. '안정 구간'은 퍼센트, '리듬'·'평균 리듬'은 spm, '활동 시간'·'러닝 시간'은 분·초로만 표현하세요. '안정 구간 133spm'처럼 서로 다른 지표와 단위를 결합하지 마세요.
- segment_summary의 start_sec/end_sec는 구간 시간으로만 표현하고, 60초 이상이면 분·초로 바꾸세요. median_cadence/cadence_delta는 리듬으로만 표현하세요. sample_count는 사용자 문구에 쓰지 마세요.
- next_goal_text에는 목표 범위 패턴(예: '136~144', '136에서 144 사이')을 절대 쓰지 말고 중심 리듬 하나만 표현하세요. next_target_min/max 필드 값 자체는 서버가 준 값을 그대로 반환하세요.
- 이전 러닝 비교용 값이 입력 JSON에 있을 때만 직전 러닝과 비교하세요. 입력에 없는 이전 값이나 변화량을 만들지 마세요.
- late_drop_analysis_status는 서버가 판정한 후반 변화 분석 상태입니다. `available`일 때만 후반 하락 수치를 해석하고, `too_short`일 때만 6분 미만 안내를 사용하세요. `insufficient_data`라면 러닝 시간이 짧다고 말하지 말고 측정 데이터 부족으로만 설명하세요.
- 데이터 관계는 '선행 변화 → 뒤따른 지표 → 가능한 해석 → 다음 행동' 순서로 설명하세요. 같은 방향으로 움직였다는 사실만으로 인과관계를 확정하지 말고, '때문에' 대신 '~와 함께 ~가 나타나 ~일 수 있어요'처럼 가능성으로 표현하세요. 시간 순서나 두 번째 지표가 없으면 원인 설명을 만들지 마세요.
- HABIT이 아니면 주간 횟수·계획 횟수·러닝 간격을 evidence에 쓰지 마세요. days_since_last_run이 null이면 HABIT 문구 어디에도 간격을 언급하지 마세요.
- COMPLETE는 완주 목적을 의미할 뿐 실제 완주 여부가 아닙니다. completed와 안정 구간을 함께 보고, 중도 종료라면 부족함을 비난하지 말고 끊긴 흐름과 다음 행동을 설명하세요. HABIT은 다음 러닝 시점, WEIGHT는 편안한 활동 시간, FITNESS는 후반 유지력, PERFORMANCE는 안정 구간·페이스·개입을 우선하세요.
- next_target_min/max는 어떤 목적에서도 서버가 결정한 값을 그대로 유지하세요. 목표를 낮춘 러닝이나 회복 모드 종료를 실패로 표현하지 마세요.
- limitation은 required_limitation 값을 그대로 복사하세요. 값이 null이면 null이며 GPS·센서·시간 제한을 새로 만들거나 지우지 마세요.
- 체중·칼로리·감량 수치, 의료 진단·통증 원인 단정·치료·약물 조언, 사용자 비난, 경쟁·압박 표현, 영어 내부 용어를 쓰지 마세요."""

# Keep the old import name for evaluation helpers while all production calls use V3.
LLM_REPORT_INSTRUCTIONS_V2 = LLM_REPORT_INSTRUCTIONS_V3


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
        "late_drop_analysis_status": (
            "available"
            if run.late_drop_rate is not None
            else "too_short"
            if quality.active_duration_sec < MIN_LATE_DROP_DURATION_SEC
            else "insufficient_data"
        ),
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
        "segment_summary": _segment_summary(run, quality),
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


def _failure_stage(exc: Exception) -> str:
    if isinstance(exc, HardGateViolation):
        if HardGateReason.SCHEMA_INVALID in exc.reasons:
            return "structured_schema"
        return "output_hard_gate"
    if isinstance(exc, (ValidationError, ValueError)):
        return "structured_schema"
    if isinstance(exc, APITimeoutError):
        return "sdk_timeout"
    if isinstance(exc, TimeoutError):
        return "deadline"
    if isinstance(exc, (AuthenticationError, RateLimitError, APIConnectionError, APIStatusError)):
        return "provider"
    return "evaluator"


def _provider_status_code(exc: Exception) -> int | None:
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and 100 <= status_code <= 599:
        return status_code
    return None


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
    started_at = time.monotonic()
    api_key = settings.openai_api_key.get_secret_value()
    if not settings.llm_enabled:
        log_llm_event(
            logging.INFO,
            "llm_report_fallback",
            run,
            stage="configuration",
            reason_codes=("disabled",),
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
        )
        return None
    if not api_key:
        log_llm_event(
            logging.WARNING,
            "llm_report_fallback",
            run,
            stage="configuration",
            reason_codes=("missing_api_key",),
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
        )
        return None

    if run.source == "MANUAL":
        log_llm_event(
            logging.WARNING,
            "llm_report_fallback",
            run,
            stage="precondition",
            reason_codes=(HardGateReason.MANUAL_RUN_LLM_BLOCKED,),
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
        )
        return None
    if not quality.is_analyzable:
        log_llm_event(
            logging.WARNING,
            "llm_report_fallback",
            run,
            stage="precondition",
            reason_codes=(HardGateReason.UNANALYZABLE_RUN_LLM_BLOCKED,),
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
        )
        return None

    summary = _safe_summary(run, quality, metrics, fallback)
    payload_gate = evaluate_outgoing_payload(summary, run.samples, run.events)
    if not payload_gate.passed:
        log_llm_event(
            logging.WARNING,
            "llm_report_fallback",
            run,
            stage="outgoing_payload_hard_gate",
            reason_codes=list(payload_gate.reasons),
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
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
            instructions=LLM_REPORT_INSTRUCTIONS_V3,
            input=json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            text_format=LLMReportContent,
            max_output_tokens=900,
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
        if gate.warnings:
            log_llm_event(
                logging.WARNING,
                "llm_report_quality_warning",
                run,
                stage="output_numeric_soft_gate",
                reason_codes=gate.warnings,
                fallback=False,
                model=settings.openai_model,
                started_at=started_at,
            )
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
        log_llm_event(
            logging.WARNING,
            "llm_report_fallback",
            run,
            stage=_failure_stage(exc),
            reason_codes=reasons,
            fallback=True,
            model=settings.openai_model,
            started_at=started_at,
            provider_status_code=_provider_status_code(exc),
        )
        return None

    log_llm_event(
        logging.INFO,
        "llm_report_success",
        run,
        stage="llm_result",
        fallback=False,
        model=settings.openai_model,
        started_at=started_at,
    )
    return content


def llm_values(content: LLMReportContent, model: str) -> dict[str, object]:
    return {**content.model_dump(), "is_fallback": False, "model": model}
