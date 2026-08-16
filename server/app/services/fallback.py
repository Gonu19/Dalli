from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from math import isfinite
from typing import Final

from app.models import Run
from app.services.metrics import RunMetrics, compute_upper_range_sec
from app.services.run_quality import RunQualityAssessment


RUNNING_PURPOSES: Final = frozenset(
    {"COMPLETE", "HABIT", "WEIGHT", "FITNESS", "PERFORMANCE"}
)


@dataclass(frozen=True)
class FallbackReportContent:
    verdict: str
    evidence: tuple[str, ...]
    hypothesis: None
    prescription: str
    next_goal_text: str
    next_target_min: int
    next_target_max: int
    recovery_note: None
    limitation: str | None
    is_fallback: bool
    model: None


def fatigue_label(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    if not isfinite(number):
        return None
    if number < 0.35:
        return "여유로움"
    if number < 0.6:
        return "보통"
    return "부담됨"


def running_purpose(run: Run) -> str:
    user = getattr(run, "user", None)
    purpose = getattr(user, "running_purpose", None) or "COMPLETE"
    return purpose if purpose in RUNNING_PURPOSES else "COMPLETE"


def _ended_in_recovery(run: Run) -> bool:
    return any(
        isinstance(event, dict) and event.get("type") == "RECOVERY_MODE_ON"
        for event in (run.events or [])
    )


def _prescription(run: Run) -> str:
    if _ended_in_recovery(run):
        return "지금은 회복을 우선하고, 편하게 이어가 보세요."

    return {
        "COMPLETE": "다음 러닝은 초반에 조금 천천히 시작해 끝까지 끊지 않고 완주해 보세요.",
        "HABIT": "다음 러닝 시점을 미리 정해, 무리하지 않는 리듬으로 다시 이어가 보세요.",
        "WEIGHT": "다음 러닝은 강도를 높이기보다 편안한 지속 시간을 조금씩 늘려 보세요.",
        "FITNESS": "다음 러닝은 후반까지 유지할 수 있는 리듬으로 안정 구간을 이어가 보세요.",
        "PERFORMANCE": "다음 러닝은 평균 페이스를 높이기보다 안정 구간의 비율을 유지하는 데 집중해 보세요.",
    }[running_purpose(run)]


def _limitations(run: Run, quality: RunQualityAssessment) -> list[str]:
    limitations: list[str] = []
    if quality.analysis_limitation == "TOO_SHORT":
        limitations.append("활동 시간이 3분 미만이라 리듬 지표를 계산하지 않았어요.")
    elif quality.analysis_limitation == "INSUFFICIENT_SENSOR_DATA":
        limitations.append("리듬 측정 데이터가 부족해 일부 지표를 계산하지 않았어요.")
    if run.distance_m is None or run.avg_pace_sec_per_km is None:
        limitations.append("위치 정보가 없어 거리와 페이스는 분석하지 않았어요.")
    if quality.is_analyzable and run.late_drop_rate is None:
        if run.duration_sec < 360:
            limitations.append("러닝 시간이 6분 미만이라 후반 리듬 변화는 계산하지 않았어요.")
        else:
            limitations.append("후반 리듬 변화에 필요한 측정 데이터가 부족했어요.")
    return limitations


def _goal_text(run: Run, center: int) -> str:
    if run.goal_type == "TIME" and run.goal_value is not None:
        amount = (
            f"{run.goal_value // 60}분"
            if run.goal_value % 60 == 0
            else f"{run.goal_value}초"
        )
        return f"다음 목표: {amount} 완주, 리듬 {center}"
    if run.goal_type == "DISTANCE" and run.goal_value is not None:
        amount = (
            f"{run.goal_value / 1000:g}km"
            if run.goal_value % 1000 == 0
            else f"{run.goal_value}m"
        )
        return f"다음 목표: {amount} 완주, 리듬 {center}"
    return f"다음 목표: 현재 목표 유지, 리듬 {center}"


def _next_target(
    run: Run,
    quality: RunQualityAssessment,
) -> tuple[int, int]:
    target_min = run.final_target_min
    target_max = run.final_target_max
    if target_min is None or target_max is None:
        target_min = run.target_cadence_min
        target_max = run.target_cadence_max
    if target_min is None or target_max is None or target_min > target_max:
        raise ValueError("APP run has no valid target range")

    upper_sec = compute_upper_range_sec(
        samples=run.samples,
        duration_sec=run.duration_sec,
        pause_intervals=quality.pause_intervals,
        initial_target=(run.target_cadence_min, run.target_cadence_max),
        events=run.events,
    )
    upper_ratio = (
        upper_sec / quality.active_duration_sec
        if upper_sec is not None and quality.active_duration_sec > 0
        else 0.0
    )
    if upper_ratio >= 0.6 and run.downshift_count == 0 and run.completed:
        return target_min + 2, target_max + 2
    return target_min, target_max


def build_fallback_report(
    run: Run,
    quality: RunQualityAssessment,
    metrics: RunMetrics,
) -> FallbackReportContent:
    next_min, next_max = _next_target(run, quality)
    fatigue = fatigue_label(run.fatigue_index)
    if fatigue == "여유로움":
        verdict = "오늘은 리듬에 여유가 있었어요."
    elif fatigue == "보통":
        verdict = "오늘의 리듬을 무리 없이 이어간 러닝이에요."
    elif fatigue == "부담됨":
        verdict = "오늘은 부담이 있었지만 러닝을 차분히 기록했어요."
    elif run.rhythm_score is not None:
        verdict = "오늘의 안정 구간을 확인했어요."
    else:
        verdict = "오늘도 한 번의 러닝을 기록했어요."

    evidence: list[str] = []
    if run.rhythm_score is not None and metrics.in_range_sec is not None:
        evidence.append(
            f"안정 구간 {round(float(run.rhythm_score) * 100)}% "
            f"({round(metrics.in_range_sec)}초)"
        )
    if fatigue is not None:
        evidence.append(f"오늘의 부담: {fatigue}")
    if run.downshift_count:
        evidence.append(f"목표를 {run.downshift_count}회 낮췄어요")

    limitations = _limitations(run, quality)
    if not evidence:
        evidence.append(limitations[0] if limitations else "저장된 러닝 시간을 확인했어요.")
    center = round((next_min + next_max) / 2)
    return FallbackReportContent(
        verdict=verdict,
        evidence=tuple(evidence[:3]),
        hypothesis=None,
        prescription=_prescription(run),
        next_goal_text=_goal_text(run, center),
        next_target_min=next_min,
        next_target_max=next_max,
        recovery_note=None,
        limitation=" ".join(limitations) or None,
        is_fallback=True,
        model=None,
    )
