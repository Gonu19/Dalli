from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from math import isfinite
from statistics import median
from typing import Protocol

from app.services.run_quality import (
    PauseInterval,
    RunQualityAssessment,
    assess_run_quality,
)


SAMPLE_BUCKET_SEC = 5.0
WARMUP_SEC = 90.0
MIN_LATE_DROP_DURATION_SEC = 360.0
MIN_LATE_DROP_SAMPLES = 30
BASELINE_WINDOW_START_SEC = 90.0
BASELINE_WINDOW_END_SEC = 270.0
BASELINE_MIN_DURATION_SEC = 360.0
BASELINE_MIN_SAMPLES = 30
BASELINE_MIN_CADENCE = 50.0


class RunMetricsInput(Protocol):
    source: str
    duration_sec: object
    condition: object
    target_cadence_min: object
    target_cadence_max: object
    samples: object
    events: object


@dataclass(frozen=True)
class RunMetrics:
    rhythm_score: float | None
    in_range_sec: float | None
    late_drop_rate: float | None
    fatigue_index: float | None


@dataclass(frozen=True, order=True)
class MetricSample:
    t: float
    cadence: float


@dataclass(frozen=True, order=True)
class TargetAdjustment:
    t: float
    input_index: int
    target_min: float
    target_max: float


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    return number if isfinite(number) else None


def _duration(value: object) -> float:
    duration = _finite_number(value)
    return max(0.0, duration) if duration is not None else 0.0


def clamp01(value: object) -> float | None:
    number = _finite_number(value)
    if number is None:
        return None
    return max(0.0, min(1.0, number))


def _normalized_samples(samples: object, duration_sec: object) -> tuple[MetricSample, ...]:
    duration = _duration(duration_sec)
    if not isinstance(samples, list):
        return ()

    by_time: dict[float, float] = {}
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        sample_time = _finite_number(sample.get("t"))
        cadence = _finite_number(sample.get("c"))
        if sample_time is None or cadence is None or not 0 <= sample_time <= duration or cadence < 0:
            continue
        # A corrupted JSONB row may contain duplicates. Choosing the minimum
        # cadence makes the result deterministic regardless of input ordering.
        by_time[sample_time] = min(cadence, by_time.get(sample_time, cadence))
    return tuple(MetricSample(t, by_time[t]) for t in sorted(by_time))


def compute_measured_baseline(samples: object, duration_sec: object) -> int | None:
    """Return the first eligible run's measured baseline, or ``None``.

    The server mirrors ENGINE.md §2: use the 90–270 second window, discard
    stopping samples below 50 spm, require a six-minute run and 30 valid
    samples, then round the median to the integer cadence stored in users.
    """
    if _duration(duration_sec) < BASELINE_MIN_DURATION_SEC:
        return None

    valid = [
        sample.cadence
        for sample in _normalized_samples(samples, duration_sec)
        if BASELINE_WINDOW_START_SEC <= sample.t <= BASELINE_WINDOW_END_SEC
        and sample.cadence >= BASELINE_MIN_CADENCE
    ]
    if len(valid) < BASELINE_MIN_SAMPLES:
        return None

    value = median(valid)
    return None if value is None else int(value + 0.5)


def _target_adjustments(events: object, duration_sec: object) -> tuple[TargetAdjustment, ...]:
    duration = _duration(duration_sec)
    if not isinstance(events, list):
        return ()

    adjustments: list[TargetAdjustment] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict) or event.get("type") != "TARGET_ADJUSTED":
            continue
        event_time = _finite_number(event.get("t"))
        payload = event.get("payload")
        if event_time is None or not 0 <= event_time <= duration or not isinstance(payload, dict):
            continue
        target_min = _finite_number(payload.get("min"))
        target_max = _finite_number(payload.get("max"))
        if target_min is None or target_max is None or target_min > target_max:
            continue
        adjustments.append(TargetAdjustment(event_time, index, target_min, target_max))
    return tuple(sorted(adjustments))


def _inside_pause(t: float, pause_intervals: Sequence[PauseInterval]) -> bool:
    return any(interval.start <= t < interval.end for interval in pause_intervals)


def _target_at(
    t: float,
    initial_target: tuple[float, float],
    adjustments: Sequence[TargetAdjustment],
) -> tuple[float, float]:
    target = initial_target
    for adjustment in adjustments:
        if adjustment.t > t:
            break
        target = (adjustment.target_min, adjustment.target_max)
    return target


def _compute_target_range_sec(
    *,
    samples: object,
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval],
    initial_target: tuple[object, object],
    events: object,
    upper_half_only: bool,
) -> float | None:
    duration = _duration(duration_sec)
    target_min = _finite_number(initial_target[0])
    target_max = _finite_number(initial_target[1])
    if duration <= 0 or target_min is None or target_max is None or target_min > target_max:
        return None

    normalized = _normalized_samples(samples, duration)
    adjustments = _target_adjustments(events, duration)
    in_range_sec = 0.0
    for index, sample in enumerate(normalized):
        bucket_end = min(sample.t + SAMPLE_BUCKET_SEC, duration)
        if index + 1 < len(normalized):
            bucket_end = min(bucket_end, normalized[index + 1].t)
        if bucket_end <= sample.t:
            continue

        boundaries = {sample.t, bucket_end}
        boundaries.update(
            adjustment.t
            for adjustment in adjustments
            if sample.t < adjustment.t < bucket_end
        )
        for interval in pause_intervals:
            if sample.t < interval.start < bucket_end:
                boundaries.add(interval.start)
            if sample.t < interval.end < bucket_end:
                boundaries.add(interval.end)
        ordered = sorted(boundaries)
        for start, end in zip(ordered, ordered[1:]):
            if _inside_pause(start, pause_intervals):
                continue
            current_min, current_max = _target_at(start, (target_min, target_max), adjustments)
            if upper_half_only:
                current_min = (current_min + current_max) / 2.0
            if current_min <= sample.cadence <= current_max:
                in_range_sec += end - start
    return max(0.0, in_range_sec)


def compute_in_range_sec(
    *,
    samples: object,
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval],
    initial_target: tuple[object, object],
    events: object,
) -> float | None:
    return _compute_target_range_sec(
        samples=samples,
        duration_sec=duration_sec,
        pause_intervals=pause_intervals,
        initial_target=initial_target,
        events=events,
        upper_half_only=False,
    )


def compute_upper_range_sec(
    *,
    samples: object,
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval],
    initial_target: tuple[object, object],
    events: object,
) -> float | None:
    """Time held in the current target's center-to-upper-bound segment."""
    return _compute_target_range_sec(
        samples=samples,
        duration_sec=duration_sec,
        pause_intervals=pause_intervals,
        initial_target=initial_target,
        events=events,
        upper_half_only=True,
    )


def compute_rhythm_score(in_range_sec: object, active_duration_sec: object) -> float | None:
    in_range = _finite_number(in_range_sec)
    active_duration = _finite_number(active_duration_sec)
    if in_range is None or active_duration is None or active_duration <= 0:
        return None
    return clamp01(in_range / active_duration)


def compute_late_drop_rate(
    samples: object,
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval] = (),
) -> float | None:
    duration = _duration(duration_sec)
    if duration < MIN_LATE_DROP_DURATION_SEC:
        return None
    valid = [
        sample.cadence
        for sample in _normalized_samples(samples, duration)
        if sample.t >= WARMUP_SEC
        and sample.cadence >= 50
        and not _inside_pause(sample.t, pause_intervals)
    ]
    if len(valid) < MIN_LATE_DROP_SAMPLES:
        return None
    group_size = len(valid) // 3
    early = float(median(valid[:group_size]))
    late = float(median(valid[-group_size:]))
    if early <= 0:
        return None
    return clamp01(1.0 - late / early)


def compute_fatigue_index(
    rhythm_score: object,
    late_drop_rate: object,
    condition: object,
) -> float | None:
    rhythm = clamp01(rhythm_score)
    late_drop = clamp01(late_drop_rate)
    if rhythm is None or late_drop is None:
        return None
    condition_number = _finite_number(condition)
    if condition_number is None:
        condition_number = 3.0
    condition_term = clamp01((5.0 - condition_number) / 4.0)
    if condition_term is None:
        return None
    return clamp01((1.0 - rhythm) * 0.4 + late_drop * 0.4 + condition_term * 0.2)


def compute_run_metrics(
    run: RunMetricsInput,
    quality: RunQualityAssessment | None = None,
) -> RunMetrics:
    assessment = quality if quality is not None else assess_run_quality(run)
    if not assessment.is_analyzable:
        return RunMetrics(None, None, None, None)

    in_range = compute_in_range_sec(
        samples=run.samples,
        duration_sec=run.duration_sec,
        pause_intervals=assessment.pause_intervals,
        initial_target=(run.target_cadence_min, run.target_cadence_max),
        events=run.events,
    )
    rhythm = compute_rhythm_score(in_range, assessment.active_duration_sec)
    late_drop = compute_late_drop_rate(
        run.samples,
        run.duration_sec,
        assessment.pause_intervals,
    )
    fatigue = compute_fatigue_index(rhythm, late_drop, run.condition)
    return RunMetrics(rhythm, in_range, late_drop, fatigue)
