from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from math import floor, isfinite
from typing import Literal, Protocol


SAMPLE_INTERVAL_SEC = 5
MIN_ACTIVE_DURATION_SEC = 180
MIN_SENSOR_COVERAGE = 0.70
AnalysisLimitation = Literal[
    "MANUAL_RUN", "TOO_SHORT", "INSUFFICIENT_SENSOR_DATA"
]


class RunQualityInput(Protocol):
    source: str
    duration_sec: object
    samples: object
    events: object


@dataclass(frozen=True, order=True)
class PauseInterval:
    start: float
    end: float


@dataclass(frozen=True)
class RunQualityAssessment:
    is_analyzable: bool
    analysis_limitation: AnalysisLimitation | None
    active_duration_sec: float
    pause_duration_sec: float
    expected_sample_count: int
    valid_sample_count: int
    sensor_coverage: float
    pause_intervals: tuple[PauseInterval, ...]


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    return number if isfinite(number) else None


def _duration(value: object) -> float:
    duration = _finite_number(value)
    return max(0.0, duration) if duration is not None else 0.0


def compute_pause_intervals(
    events: object,
    duration_sec: object,
) -> tuple[PauseInterval, ...]:
    duration = _duration(duration_sec)
    if not isinstance(events, list):
        return ()

    valid_events: list[tuple[float, int, str]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        event_time = _finite_number(event.get("t"))
        if (
            not isinstance(event_type, str)
            or event_type not in {"PAUSE", "RESUME", "RUN_END"}
            or event_time is None
            or not 0 <= event_time <= duration
        ):
            continue
        valid_events.append((event_time, index, event_type))

    intervals: list[PauseInterval] = []
    pause_start: float | None = None
    session_end = duration
    for event_time, _, event_type in sorted(valid_events):
        if event_type == "RUN_END":
            session_end = event_time
            if pause_start is not None and pause_start < session_end:
                intervals.append(PauseInterval(pause_start, session_end))
            pause_start = None
            break
        if event_type == "PAUSE" and pause_start is None:
            pause_start = event_time
        elif event_type == "RESUME" and pause_start is not None:
            if pause_start < event_time:
                intervals.append(PauseInterval(pause_start, event_time))
            pause_start = None

    if pause_start is not None and pause_start < session_end:
        intervals.append(PauseInterval(pause_start, session_end))
    return tuple(intervals)


def compute_active_duration_sec(
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval],
) -> float:
    duration = _duration(duration_sec)
    bounded = sorted(
        (
            max(0.0, interval.start),
            min(duration, interval.end),
        )
        for interval in pause_intervals
        if interval.start < interval.end
    )
    merged: list[tuple[float, float]] = []
    for start, end in bounded:
        if start >= end:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    pause_duration = sum(end - start for start, end in merged)
    return min(duration, max(0.0, duration - pause_duration))


def expected_sample_count(active_duration_sec: object) -> int:
    active_duration = _duration(active_duration_sec)
    return max(1, floor(active_duration / SAMPLE_INTERVAL_SEC))


def _inside_pause(sample_time: float, intervals: Sequence[PauseInterval]) -> bool:
    return any(interval.start <= sample_time < interval.end for interval in intervals)


def count_valid_samples(
    samples: object,
    duration_sec: object,
    pause_intervals: Sequence[PauseInterval],
) -> int:
    duration = _duration(duration_sec)
    if not isinstance(samples, list):
        return 0

    valid_times: set[float] = set()
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        sample_time = _finite_number(sample.get("t"))
        cadence = _finite_number(sample.get("c"))
        if (
            sample_time is None
            or cadence is None
            or not 0 <= sample_time <= duration
            or cadence < 0
            or _inside_pause(sample_time, pause_intervals)
        ):
            continue
        valid_times.add(sample_time)
    return len(valid_times)


def compute_sensor_coverage(valid_sample_count: int, expected_count: int) -> float:
    if expected_count <= 0:
        return 0.0
    return min(1.0, max(0.0, valid_sample_count / expected_count))


def assess_run_quality(run: RunQualityInput) -> RunQualityAssessment:
    duration = _duration(run.duration_sec)
    if run.source == "MANUAL":
        return RunQualityAssessment(
            is_analyzable=False,
            analysis_limitation="MANUAL_RUN",
            active_duration_sec=duration,
            pause_duration_sec=0.0,
            expected_sample_count=expected_sample_count(duration),
            valid_sample_count=0,
            sensor_coverage=0.0,
            pause_intervals=(),
        )

    intervals = compute_pause_intervals(run.events, duration)
    active_duration = compute_active_duration_sec(duration, intervals)
    pause_duration = duration - active_duration
    expected_count = expected_sample_count(active_duration)
    valid_count = count_valid_samples(run.samples, duration, intervals)
    coverage = compute_sensor_coverage(valid_count, expected_count)

    limitation: AnalysisLimitation | None
    if active_duration < MIN_ACTIVE_DURATION_SEC:
        limitation = "TOO_SHORT"
    elif coverage < MIN_SENSOR_COVERAGE:
        limitation = "INSUFFICIENT_SENSOR_DATA"
    else:
        limitation = None
    return RunQualityAssessment(
        is_analyzable=limitation is None,
        analysis_limitation=limitation,
        active_duration_sec=active_duration,
        pause_duration_sec=pause_duration,
        expected_sample_count=expected_count,
        valid_sample_count=valid_count,
        sensor_coverage=coverage,
        pause_intervals=intervals,
    )


def is_analyzable(run: RunQualityInput) -> bool:
    return assess_run_quality(run).is_analyzable
