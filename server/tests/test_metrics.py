from copy import deepcopy
from math import inf, nan
from types import SimpleNamespace

import pytest

from app.services.metrics import (
    clamp01,
    compute_fatigue_index,
    compute_in_range_sec,
    compute_late_drop_rate,
    compute_measured_baseline,
    compute_rhythm_score,
    compute_run_metrics,
)
from app.services.run_quality import PauseInterval, assess_run_quality


def samples(duration: int, cadence: float = 157, start: int = 0) -> list[dict]:
    return [{"t": t, "c": cadence} for t in range(start, duration, 5)]


def run(**changes):
    value = SimpleNamespace(
        source="APP",
        duration_sec=180,
        condition=3,
        target_cadence_min=153,
        target_cadence_max=161,
        samples=samples(180),
        events=[],
    )
    for key, item in changes.items():
        setattr(value, key, item)
    return value


def in_range(
    sample_values,
    duration,
    *,
    target=(153, 161),
    events=None,
    pauses=(),
):
    return compute_in_range_sec(
        samples=sample_values,
        duration_sec=duration,
        pause_intervals=pauses,
        initial_target=target,
        events=events or [],
    )


@pytest.mark.parametrize(("cadence", "expected"), [(157, 1.0), (140, 0.0)])
def test_rhythm_score_all_in_or_out_of_range(cadence, expected):
    seconds = in_range(samples(180, cadence), 180)
    assert compute_rhythm_score(seconds, 180) == expected


def test_rhythm_score_half_in_range_and_missing_time_stays_in_denominator():
    half = samples(90, 157) + [{"t": t, "c": 140} for t in range(90, 180, 5)]
    assert compute_rhythm_score(in_range(half, 180), 180) == 0.5
    assert compute_rhythm_score(in_range(samples(90), 180), 180) == 0.5


@pytest.mark.parametrize(
    ("cadence", "expected"),
    [(153, 5.0), (161, 5.0), (152.999, 0.0), (161.001, 0.0), (0, 0.0)],
)
def test_rhythm_target_boundaries_and_stopping(cadence, expected):
    assert in_range([{"t": 0, "c": cadence}], 5) == expected


def test_rhythm_includes_warmup_and_excludes_pause_from_numerator():
    assert in_range(samples(90), 180) == 90
    pauses = (PauseInterval(5, 15),)
    assert in_range(samples(20), 20, pauses=pauses) == 10
    assert compute_rhythm_score(10, 10) == 1


def test_rhythm_warmup_in_range_changes_score_because_warmup_is_included():
    after_warmup = [{"t": t, "c": 157} for t in range(90, 180, 5)]
    warmup_in = [{"t": t, "c": 157} for t in range(0, 90, 5)]
    warmup_out = [{"t": t, "c": 0} for t in range(0, 90, 5)]
    assert compute_rhythm_score(in_range(warmup_in + after_warmup, 180), 180) == 1
    assert compute_rhythm_score(in_range(warmup_out + after_warmup, 180), 180) == 0.5


def test_pause_boundaries_are_half_open():
    pauses = (PauseInterval(5, 10),)
    assert in_range([{"t": 0, "c": 157}, {"t": 5, "c": 157}, {"t": 10, "c": 157}], 15, pauses=pauses) == 10


def test_target_adjustment_applies_from_event_time_and_splits_bucket():
    events = [{"t": 2, "type": "TARGET_ADJUSTED", "payload": {"min": 148, "max": 156}}]
    assert in_range([{"t": 0, "c": 150}], 5, events=events) == 3
    assert in_range([{"t": 0, "c": 157}], 5, events=events) == 2


def test_downshift_exact_300_boundary_uses_old_range_before_and_new_range_at_event():
    event = [{"t": 300, "type": "TARGET_ADJUSTED", "payload": {"min": 148, "max": 156}}]
    assert in_range([{"t": 295, "c": 150}, {"t": 300, "c": 150}, {"t": 305, "c": 150}], 310, events=event) == 10
    assert in_range([{"t": 295, "c": 158}, {"t": 300, "c": 158}], 305, events=event) == 5


@pytest.mark.parametrize(
    ("cadence", "expected"),
    [(147, 0), (148, 5), (156, 5), (157, 0)],
)
def test_downshift_target_boundaries_are_inclusive(cadence, expected):
    event = [{"t": 0, "type": "TARGET_ADJUSTED", "payload": {"min": 148, "max": 156}}]
    assert in_range([{"t": 0, "c": cadence}], 5, events=event) == expected


def test_downshift_is_sorted_sequential_and_persists_across_pause():
    events = [
        {"t": 400, "type": "TARGET_ADJUSTED", "payload": {"min": 140, "max": 148}},
        {"t": 300, "type": "TARGET_ADJUSTED", "payload": {"min": 148, "max": 156}},
    ]
    values = [{"t": 295, "c": 150}, {"t": 300, "c": 150}, {"t": 405, "c": 144}]
    assert in_range(values, 600, events=events, pauses=(PauseInterval(300, 400),)) == 5


def test_same_time_last_valid_target_adjustment_wins():
    events = [
        {"t": 0, "type": "TARGET_ADJUSTED", "payload": {"min": 140, "max": 145}},
        {"t": 0, "type": "TARGET_ADJUSTED", "payload": {"min": 150, "max": 155}},
    ]
    assert in_range([{"t": 0, "c": 152}], 5, events=events) == 5


@pytest.mark.parametrize(
    "event",
    [
        {"t": 0, "type": "TOO_SLOW", "payload": {"min": 1, "max": 2}},
        {"t": -1, "type": "TARGET_ADJUSTED", "payload": {"min": 1, "max": 2}},
        {"t": 0, "type": "TARGET_ADJUSTED", "payload": []},
        {"t": 0, "type": "TARGET_ADJUSTED", "payload": {"min": "1", "max": 2}},
        {"t": 0, "type": "TARGET_ADJUSTED", "payload": {"min": 3, "max": 2}},
    ],
)
def test_malformed_target_adjustments_are_ignored(event):
    assert in_range([{"t": 0, "c": 157}], 5, events=[event]) == 5


@pytest.mark.parametrize("target", [(None, 161), (153, None), (162, 161)])
def test_invalid_initial_target_returns_null(target):
    assert in_range(samples(5), 5, target=target) is None


def test_sample_buckets_do_not_overlap_or_exceed_duration_and_input_is_unchanged():
    original = [{"t": 0, "c": 157}, {"t": 2, "c": 157}, {"t": 9, "c": 157}]
    before = deepcopy(original)
    assert in_range(original, 10) == 8
    assert original == before


def ldr_values(count=30, early=160, late=144):
    values = []
    for index in range(count):
        cadence = early if index < count // 3 else late if index >= count - count // 3 else 150
        values.append({"t": 90 + index * 5, "c": cadence})
    return values


def test_late_drop_duration_and_sample_count_boundaries():
    assert compute_late_drop_rate(ldr_values(), 359) is None
    assert compute_late_drop_rate(ldr_values(29), 360) is None
    assert compute_late_drop_rate(ldr_values(30), 360) == pytest.approx(0.1)


def baseline_values(count=30, cadence=157):
    return [{"t": 90 + index * 5, "c": cadence} for index in range(count)]


@pytest.mark.parametrize(
    ("duration", "values", "expected"),
    [
        (359, baseline_values(), None),
        (360, baseline_values(29), None),
        (360, baseline_values(), 157),
    ],
)
def test_measured_baseline_requires_six_minutes_and_thirty_valid_samples(
    duration, values, expected
):
    assert compute_measured_baseline(values, duration) == expected


def test_measured_baseline_uses_window_boundaries_stopping_filter_and_js_rounding():
    values = [
        {"t": 89, "c": 999},
        {"t": 90, "c": 50},
        {"t": 270, "c": 157},
        {"t": 275, "c": 999},
        {"t": 95, "c": 49},
    ] + [
        {"t": 100 + index * 5, "c": 156 if index < 14 else 157}
        for index in range(29)
    ]

    assert compute_measured_baseline(values, 360) == 157


@pytest.mark.parametrize(
    ("duration", "expected"),
    [(359, None), (359.999, None), (360, 0.1), (361, 0.1)],
)
def test_late_drop_exact_six_minute_boundary_uses_total_duration(duration, expected):
    result = compute_late_drop_rate(ldr_values(30), duration)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


@pytest.mark.parametrize(("count", "expected"), [(29, None), (30, 0.1), (31, 0.1)])
def test_late_drop_exact_valid_sample_count_boundary(count, expected):
    result = compute_late_drop_rate(ldr_values(count), 500)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


def test_late_drop_filters_warmup_stopping_and_pause_but_includes_boundaries_and_walking():
    values = ldr_values(32)
    values += [{"t": 89, "c": 1}, {"t": 90, "c": 49}]
    values[0] = {"t": 90, "c": 50}
    result = compute_late_drop_rate(values, 360, (PauseInterval(95, 100),))
    assert result is not None


def test_late_drop_excludes_t_below_90_and_includes_90_and_91():
    baseline = ldr_values(30)
    expected = compute_late_drop_rate(baseline, 500)
    with_extreme_warmup = baseline + [
        {"t": 89, "c": 9999},
        {"t": 89.999, "c": 1},
    ]
    assert compute_late_drop_rate(with_extreme_warmup, 500) == expected
    shifted = [{"t": 91 + index * 5, "c": item["c"]} for index, item in enumerate(baseline)]
    shifted.insert(0, {"t": 90, "c": 160})
    assert compute_late_drop_rate(shifted, 500) is not None


@pytest.mark.parametrize(("cadence", "included"), [(0, False), (49, False), (49.999, False), (50, True), (100, True), (120, True), (121, True)])
def test_late_drop_stopping_and_walking_cadence_boundary(cadence, included):
    values = ldr_values(29)
    values.append({"t": 499, "c": cadence})
    result = compute_late_drop_rate(values, 500)
    assert (result is not None) is included


@pytest.mark.parametrize("count", [31, 32, 33])
def test_late_drop_uses_first_and_last_thirds(count):
    assert compute_late_drop_rate(ldr_values(count), 500) == pytest.approx(0.1)


def test_late_drop_uses_median_and_clamps_rising_cadence():
    values = ldr_values(30, early=160, late=176)
    values[0]["c"] = 9999
    assert compute_late_drop_rate(values, 500) == 0


def test_late_drop_normalizes_malformed_unsorted_and_duplicate_samples_deterministically():
    values = list(reversed(ldr_values())) + [None, {"t": "90", "c": 160}, {"t": 90, "c": 999}]
    first = compute_late_drop_rate(values, 500)
    second = compute_late_drop_rate(list(reversed(values)), 500)
    assert first == second == pytest.approx(0.1)
    assert compute_late_drop_rate(None, 500) is None


@pytest.mark.parametrize(
    ("condition", "expected"),
    [(None, 0.1), (1, 0.2), (2, 0.15), (3, 0.1), (4, 0.05), (5, 0.0)],
)
def test_fatigue_condition_contribution(condition, expected):
    assert compute_fatigue_index(1, 0, condition) == pytest.approx(expected)


def test_fatigue_null_and_clamp_defenses():
    assert compute_fatigue_index(None, 0, 3) is None
    assert compute_fatigue_index(1, None, 3) is None
    assert compute_fatigue_index(-1, 2, -100) == 1
    assert compute_fatigue_index(2, -1, 100) == 0
    for value in (nan, inf, True, "0.5"):
        assert compute_fatigue_index(value, 0, 3) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [(-1, 0), (-0.1, 0), (0, 0), (0.5, 0.5), (1, 1), (1.1, 1), (2, 1)],
)
def test_clamp01_boundaries(value, expected):
    assert clamp01(value) == expected


def test_rhythm_score_clamps_defensive_inputs_and_zero_duration_is_null():
    assert compute_rhythm_score(-1, 10) == 0
    assert compute_rhythm_score(11, 10) == 1
    assert compute_rhythm_score(0, 0) is None


@pytest.mark.parametrize(
    ("rhythm", "late_drop", "condition", "expected"),
    [(1, 0, 5, 0), (1, 0, 3, 0.1), (1, 0, 1, 0.2), (0, 1, 1, 1), (0.5, 0.25, 3, 0.4)],
)
def test_fatigue_exact_formula_values(rhythm, late_drop, condition, expected):
    assert compute_fatigue_index(rhythm, late_drop, condition) == pytest.approx(expected)


def test_metrics_quality_gate_and_three_to_six_minute_behavior():
    analyzable = run()
    metrics = compute_run_metrics(analyzable)
    assert metrics.rhythm_score == 1
    assert metrics.in_range_sec == 180
    assert metrics.late_drop_rate is None
    assert metrics.fatigue_index is None

    for limited in (
        run(source="MANUAL", samples=None, events=None),
        run(duration_sec=179, samples=samples(179)),
        run(samples=[{"t": 0, "c": 157}]),
    ):
        assert compute_run_metrics(limited).rhythm_score is None


def test_metrics_reuses_supplied_quality_and_is_repeatable():
    value = run(duration_sec=360, samples=samples(360))
    quality = assess_run_quality(value)
    assert compute_run_metrics(value, quality) == compute_run_metrics(value, quality)


def test_complex_600_second_run_matches_manual_quality_and_metrics_expectations():
    sample_values = []
    for t in range(0, 600, 5):
        cadence = 157 if t < 300 else 150
        if t == 100:
            cadence = 0
        elif t == 550:
            cadence = 100
        sample_values.append({"t": t, "c": cadence})
    sample_values.append({"t": 300, "c": 155})
    events = [
        {"t": 200, "type": "PAUSE"},
        {"t": 230, "type": "RESUME"},
        {"t": 300, "type": "TARGET_ADJUSTED", "payload": {"min": 148, "max": 156}},
    ]
    value = run(duration_sec=600, samples=sample_values, events=events)
    original_samples = deepcopy(sample_values)
    original_events = deepcopy(events)

    quality = assess_run_quality(value)
    metrics = compute_run_metrics(value, quality)

    assert quality.pause_duration_sec == 30
    assert quality.active_duration_sec == 570
    assert quality.expected_sample_count == 114
    assert quality.valid_sample_count == 114
    assert quality.sensor_coverage == 1
    assert metrics.in_range_sec == 560
    assert metrics.rhythm_score == pytest.approx(560 / 570)
    assert metrics.late_drop_rate == pytest.approx(1 - 150 / 157)
    assert metrics.fatigue_index == pytest.approx(
        (1 - 560 / 570) * 0.4 + (1 - 150 / 157) * 0.4 + 0.1
    )
    assert all(0 <= metric <= 1 for metric in (metrics.rhythm_score, metrics.late_drop_rate, metrics.fatigue_index))
    assert value.samples == original_samples
    assert value.events == original_events
