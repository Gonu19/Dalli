from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from math import isfinite
from typing import Final

from app.models import Run
from app.services.metrics import (
    MIN_LATE_DROP_DURATION_SEC,
    RunMetrics,
    compute_upper_range_sec,
)
from app.services.run_quality import RunQualityAssessment
from app.services.stats import count_this_week_run_days


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


def days_since_last_app_run(run: Run) -> int | None:
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


def _ended_in_recovery(run: Run) -> bool:
    return any(
        isinstance(event, dict) and event.get("type") == "RECOVERY_MODE_ON"
        for event in (run.events or [])
    )


def _recovery_priority(run: Run) -> bool:
    if _ended_in_recovery(run):
        return True
    days = days_since_last_app_run(run)
    return days is not None and days <= 1 and fatigue_label(run.fatigue_index) == "부담됨"


def _prescription(run: Run) -> str:
    if _recovery_priority(run):
        return "지금은 회복을 우선하고, 편하게 이어가 보세요."

    return {
        "COMPLETE": "다음 러닝은 초반에 조금 천천히 시작해 끝까지 끊지 않고 완주해 보세요.",
        "HABIT": "다음 러닝 시점을 미리 정해, 무리하지 않는 리듬으로 다시 이어가 보세요.",
        "WEIGHT": "다음 러닝은 강도를 높이기보다 편안한 지속 시간을 조금씩 늘려 보세요.",
        "FITNESS": "다음 러닝은 후반까지 유지할 수 있는 리듬으로 안정 구간을 이어가 보세요.",
        "PERFORMANCE": "다음 러닝은 평균 페이스를 높이기보다 안정 구간의 비율을 유지하는 데 집중해 보세요.",
    }[running_purpose(run)]


def _weekly_run_count(run: Run) -> int:
    user = getattr(run, "user", None)
    return count_this_week_run_days(
        getattr(user, "runs", None) or [],
        datetime.now(timezone.utc),
    )


def _format_duration(value: int | None) -> str | None:
    if value is None or value < 0:
        return None
    if value % 60 == 0:
        return f"{value // 60}분"
    return f"{value}초"


def _purpose_verdict(run: Run) -> str:
    if _recovery_priority(run):
        return "오늘은 회복을 우선하며 러닝을 이어갔어요."

    return {
        "COMPLETE": (
            "안정적인 리듬으로 목표를 끊지 않고 완주한 러닝이에요."
            if run.completed
            else "안정 구간을 확인하며 오늘의 러닝을 이어가 보았어요."
        ),
        "HABIT": "이번 러닝으로 달리기 루틴을 이어갔어요.",
        "WEIGHT": "오늘은 편안한 활동 시간을 쌓은 러닝이에요.",
        "FITNESS": "후반 리듬 변화를 확인한 러닝이에요.",
        "PERFORMANCE": "안정 구간과 평균 페이스를 확인한 러닝이에요.",
    }[running_purpose(run)]


def _purpose_evidence(
    run: Run,
    quality: RunQualityAssessment,
    metrics: RunMetrics,
    fatigue: str | None,
) -> list[str]:
    purpose = running_purpose(run)
    if purpose == "HABIT":
        evidence = [f"이번 주 {_weekly_run_count(run)}회 러닝"]
        days = days_since_last_app_run(run)
        if days is not None:
            evidence.append(f"직전 러닝과 {days}일 간격")
        return evidence

    if purpose == "WEIGHT":
        duration = _format_duration(quality.active_duration_sec)
        return [f"활동 시간 {duration}"] if duration is not None else ["활동 시간을 기록했어요."]

    if purpose == "FITNESS":
        evidence: list[str] = []
        if run.late_drop_rate is not None:
            evidence.append(f"후반 리듬 하락 {round(float(run.late_drop_rate) * 100)}%")
        if run.rhythm_score is not None:
            evidence.append(f"안정 구간 {round(float(run.rhythm_score) * 100)}%")
        return evidence or ["후반 리듬 변화를 계산하지 않았어요."]

    if purpose == "PERFORMANCE":
        evidence = []
        if run.rhythm_score is not None:
            evidence.append(f"안정 구간 {round(float(run.rhythm_score) * 100)}%")
        if run.avg_pace_sec_per_km is not None:
            evidence.append(f"평균 페이스 {run.avg_pace_sec_per_km}초/km")
        if run.intervention_count is not None:
            evidence.append(f"개입 {run.intervention_count}회")
        return evidence or ["리듬과 페이스를 확인했어요."]

    evidence = [
        "완주했어요" if run.completed else "러닝을 기록했어요.",
    ]
    if run.rhythm_score is not None and metrics.in_range_sec is not None:
        evidence.append(
            f"안정 구간 {round(float(run.rhythm_score) * 100)}% "
            f"({round(metrics.in_range_sec)}초)"
        )
    if fatigue is not None:
        evidence.append(f"오늘의 부담: {fatigue}")
    return evidence


def _limitations(run: Run, quality: RunQualityAssessment) -> list[str]:
    limitations: list[str] = []
    if quality.analysis_limitation == "TOO_SHORT":
        limitations.append("활동 시간이 3분 미만이라 리듬 지표를 계산하지 않았어요.")
    elif quality.analysis_limitation == "INSUFFICIENT_SENSOR_DATA":
        limitations.append("리듬 측정 데이터가 부족해 일부 지표를 계산하지 않았어요.")
    if run.distance_m is None or run.avg_pace_sec_per_km is None:
        limitations.append("위치 정보가 없어 거리와 페이스는 분석하지 않았어요.")
    if quality.is_analyzable and run.late_drop_rate is None:
        if quality.active_duration_sec < MIN_LATE_DROP_DURATION_SEC:
            limitations.append("러닝 시간이 6분 미만이라 후반 리듬 변화는 계산하지 않았어요.")
        else:
            limitations.append("후반 리듬 변화에 필요한 측정 데이터가 부족했어요.")
    return limitations


def _goal_text(run: Run, center: int) -> str:
    purpose = running_purpose(run)
    if purpose == "HABIT":
        days = days_since_last_app_run(run)
        timing = (
            "다음 러닝은 이틀 안에 한 번 더 나가 보세요."
            if days is not None and days <= 2
            else "다음 러닝 시점을 정해 다시 이어가 보세요."
        )
        return f"{timing} 목표 리듬 {center}"
    if purpose == "WEIGHT":
        return f"다음 목표: 활동 시간을 조금 더 늘리고, 리듬 {center}를 편하게 이어가 보세요."
    if purpose == "FITNESS":
        return f"다음 목표: 후반까지 안정 구간을 이어가 보세요. 리듬 {center}"
    if purpose == "PERFORMANCE":
        return f"다음 목표: 안정 구간과 평균 페이스를 유지해 보세요. 리듬 {center}"
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


def compute_next_target(
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
    next_min, next_max = compute_next_target(run, quality)
    fatigue = fatigue_label(run.fatigue_index)
    verdict = _purpose_verdict(run)
    evidence = _purpose_evidence(run, quality, metrics, fatigue)
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
