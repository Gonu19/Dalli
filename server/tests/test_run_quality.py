from copy import deepcopy
from math import inf, nan
from types import SimpleNamespace

import pytest

from app.services.run_quality import (
    PauseInterval,
    assess_run_quality,
    compute_active_duration_sec,
    compute_pause_intervals,
    compute_sensor_coverage,
    count_valid_samples,
    expected_sample_count,
    is_analyzable,
)


def run(**changes):
    values = {
        "source": "APP",
        "duration_sec": 180,
        "samples": [{"t": t, "c": 157} for t in range(0, 180, 5)],
        "events": [],
    }
    values.update(changes)
    return SimpleNamespace(**values)


@pytest.mark.parametrize(
    ("active_duration", "expected"),
    [(0, 1), (4, 1), (5, 1), (9, 1), (10, 2), (179, 35), (180, 36), (181, 36)],
)
def test_expected_sample_count_uses_five_second_floor(active_duration, expected):
    assert expected_sample_count(active_duration) == expected


def test_pause_intervals_use_half_open_boundaries_and_multiple_periods():
    events = [
        {"t": 60, "type": "PAUSE"},
        {"t": 90, "type": "RESUME"},
        {"t": 120, "type": "PAUSE"},
        {"t": 150, "type": "RESUME"},
    ]
    intervals = compute_pause_intervals(events, 240)

    assert intervals == (PauseInterval(60, 90), PauseInterval(120, 150))
    assert compute_active_duration_sec(240, intervals) == 180
    samples = [{"t": t, "c": 157} for t in (59, 60, 89, 90, 119, 120, 149, 150)]
    assert count_valid_samples(samples, 240, intervals) == 4


def test_open_pause_uses_run_end_then_duration_fallback():
    with_end = compute_pause_intervals(
        [{"t": 60, "type": "PAUSE"}, {"t": 180, "type": "RUN_END"}],
        240,
    )
    without_end = compute_pause_intervals([{"t": 60, "type": "PAUSE"}], 180)

    assert with_end == (PauseInterval(60, 180),)
    assert compute_active_duration_sec(240, with_end) == 120
    assert without_end == (PauseInterval(60, 180),)
    assert compute_active_duration_sec(180, without_end) == 60


def test_active_duration_unions_overlapping_and_bounds_intervals():
    intervals = (
        PauseInterval(-10, 30),
        PauseInterval(20, 50),
        PauseInterval(150, 250),
    )
    assert compute_active_duration_sec(180, intervals) == 100


@pytest.mark.parametrize(
    ("events", "expected"),
    [
        (None, ()),
        ({"t": 1, "type": "PAUSE"}, ()),
        ([{"t": 30, "type": "RESUME"}], ()),
        (
            [
                {"t": 10, "type": "PAUSE"},
                {"t": 20, "type": "PAUSE"},
                {"t": 30, "type": "RESUME"},
                {"t": 40, "type": "RESUME"},
            ],
            (PauseInterval(10, 30),),
        ),
        (
            [{"t": 90, "type": "RESUME"}, {"t": 60, "type": "PAUSE"}],
            (PauseInterval(60, 90),),
        ),
        (
            [
                None,
                "bad",
                {},
                {"t": 1, "type": ["PAUSE"]},
                {"t": -1, "type": "PAUSE"},
                {"t": 181, "type": "PAUSE"},
                {"t": nan, "type": "PAUSE"},
                {"t": inf, "type": "RESUME"},
                {"t": True, "type": "PAUSE"},
            ],
            (),
        ),
        (
            [
                {"t": 60, "type": "PAUSE"},
                {"t": 100, "type": "RUN_END"},
                {"t": 120, "type": "RUN_END"},
                {"t": 130, "type": "RESUME"},
            ],
            (PauseInterval(60, 100),),
        ),
    ],
)
def test_malformed_events_are_handled_deterministically(events, expected):
    assert compute_pause_intervals(events, 180) == expected


def test_valid_samples_ignore_gps_and_reject_invalid_sensor_values():
    intervals = (PauseInterval(60, 90),)
    samples = [
        {"t": 0, "c": 0, "p": None, "d": "irrelevant"},
        {"t": 60, "c": 157},
        {"t": 90, "c": 157},
        {"t": -1, "c": 157},
        {"t": 181, "c": 157},
        {"t": 10, "c": -1},
        {"t": nan, "c": 157},
        {"t": inf, "c": 157},
        {"t": 15, "c": nan},
        {"t": 20, "c": inf},
        {"t": None, "c": 157},
        {"t": 25, "c": None},
        {"t": True, "c": 157},
        {"t": 30, "c": False},
        {"t": "35", "c": 157},
        {"t": 40, "c": "157"},
        None,
        "bad",
    ]

    assert count_valid_samples(samples, 180, intervals) == 2
    assert count_valid_samples(None, 180, intervals) == 0
    assert count_valid_samples({"t": 0, "c": 1}, 180, intervals) == 0


@pytest.mark.parametrize(
    ("samples", "expected"),
    [
        ([{"t": 10, "c": 150}, {"t": 10, "c": 160}], 1),
        ([{"t": 10, "c": -1}, {"t": 10, "c": 160}], 1),
        ([{"t": 10, "c": -1}, {"t": 10, "c": nan}], 0),
        ([{"t": 0, "c": 150}, {"t": 0.0, "c": 160}], 1),
    ],
)
def test_duplicate_sample_times_are_counted_once(samples, expected):
    assert count_valid_samples(samples, 180, ()) == expected


@pytest.mark.parametrize(
    ("valid_count", "expected_count", "coverage"),
    [(6, 10, 0.6), (7, 10, 0.7), (8, 10, 0.8), (2, 1, 1.0), (-1, 10, 0.0)],
)
def test_sensor_coverage_uses_exact_ratio_and_clamps(valid_count, expected_count, coverage):
    assert compute_sensor_coverage(valid_count, expected_count) == coverage


def test_limitation_priority_and_coverage_boundaries():
    manual = assess_run_quality(
        run(source="MANUAL", duration_sec=900, samples="bad", events="bad")
    )
    short = assess_run_quality(run(duration_sec=179, samples=[]))
    insufficient = assess_run_quality(
        run(samples=[{"t": t, "c": 157} for t in range(25)])
    )
    sufficient = assess_run_quality(
        run(samples=[{"t": t, "c": 157} for t in range(26)])
    )

    assert (manual.is_analyzable, manual.analysis_limitation) == (False, "MANUAL_RUN")
    assert manual.valid_sample_count == 0 and manual.pause_intervals == ()
    assert (short.is_analyzable, short.analysis_limitation) == (False, "TOO_SHORT")
    assert insufficient.expected_sample_count == 36
    assert insufficient.valid_sample_count == 25
    assert insufficient.analysis_limitation == "INSUFFICIENT_SENSOR_DATA"
    assert sufficient.sensor_coverage == pytest.approx(26 / 36)
    assert sufficient.is_analyzable is True
    assert sufficient.analysis_limitation is None
    assert is_analyzable(run(samples=[{"t": t, "c": 157} for t in range(26)]))


@pytest.mark.parametrize(
    ("duration", "events", "active", "limitation"),
    [
        (179, [], 179, "TOO_SHORT"),
        (180, [], 180, None),
        (181, [], 181, None),
        (240, [{"t": 60, "type": "PAUSE"}, {"t": 120, "type": "RESUME"}], 180, None),
        (240, [{"t": 60, "type": "PAUSE"}, {"t": 121, "type": "RESUME"}], 179, "TOO_SHORT"),
        (180, [{"t": 60, "type": "PAUSE"}, {"t": 61, "type": "RESUME"}], 179, "TOO_SHORT"),
    ],
)
def test_active_duration_boundary(duration, events, active, limitation):
    samples = [{"t": t, "c": 157} for t in range(duration + 1)]
    result = assess_run_quality(run(duration_sec=duration, events=events, samples=samples))
    assert result.active_duration_sec == active
    assert result.pause_duration_sec == duration - active
    assert result.analysis_limitation == limitation


def test_quality_assessment_is_pure_and_repeatable():
    target = run(
        events=[{"t": 60, "type": "PAUSE"}, {"t": 90, "type": "RESUME"}],
        samples=[{"t": 0, "c": 157, "p": None, "d": None}],
    )
    original_samples = deepcopy(target.samples)
    original_events = deepcopy(target.events)

    first = assess_run_quality(target)
    second = assess_run_quality(target)

    assert first == second
    assert target.samples == original_samples
    assert target.events == original_events
