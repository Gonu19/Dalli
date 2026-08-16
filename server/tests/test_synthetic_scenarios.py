from copy import deepcopy
from dataclasses import asdict
from math import floor

import httpx
import pytest
from pydantic import TypeAdapter

from app.schemas.runs import AppRunCreate, ManualRunCreate, RunCreate
from app.services.metrics import compute_late_drop_rate
from app.services.run_quality import assess_run_quality
from tests.synthetic_scenarios import (
    SYNTHETIC_NOTICE,
    SYNTHETIC_SCENARIO_KEYS,
    SYNTHETIC_SCENARIOS,
    evaluate_synthetic_scenario,
    get_synthetic_scenario,
    parse_synthetic_run,
)


EXPECTED_KEYS = {
    "stable_completion",
    "early_overspeed",
    "late_cadence_decline",
    "deviation_then_recovery",
    "target_downshift",
    "incomplete_run",
    "tired_condition",
    "first_run_baseline_candidate",
    "too_short",
    "insufficient_sensor_coverage",
    "missing_gps_and_pace",
    "manual_run",
}


def _quality_input(duration: int, samples: list[dict], events=None):
    return type(
        "QualityInput",
        (),
        {"source": "APP", "duration_sec": duration, "samples": samples, "events": events or []},
    )()


def _samples(duration: int, cadence: int = 157) -> list[dict[str, int]]:
    return [{"t": second, "c": cadence} for second in range(0, duration, 5)]


def test_inventory_has_exactly_twelve_unique_stable_keys() -> None:
    assert len(SYNTHETIC_SCENARIOS) == 12
    assert len(SYNTHETIC_SCENARIO_KEYS) == len(set(SYNTHETIC_SCENARIO_KEYS))
    assert set(SYNTHETIC_SCENARIO_KEYS) == EXPECTED_KEYS


@pytest.mark.parametrize("key", SYNTHETIC_SCENARIO_KEYS)
def test_scenario_ids_timestamps_payloads_and_results_are_repeatable(key: str) -> None:
    first = get_synthetic_scenario(key)
    second = get_synthetic_scenario(key)
    first_evaluation = evaluate_synthetic_scenario(key)
    second_evaluation = evaluate_synthetic_scenario(key)

    assert first == second
    assert asdict(first_evaluation.quality) == asdict(second_evaluation.quality)
    assert asdict(first_evaluation.metrics) == asdict(second_evaluation.metrics)
    assert first.run_id == second.run_id
    assert first.client_run_id == second.client_run_id
    assert parse_synthetic_run(first).started_at.tzinfo is not None
    first.payload["memo"] = "mutated"
    assert get_synthetic_scenario(key).payload["memo"] == SYNTHETIC_NOTICE


@pytest.mark.parametrize("key", SYNTHETIC_SCENARIO_KEYS)
def test_payload_schema_classification_metrics_and_event_intent(key: str) -> None:
    evaluated = evaluate_synthetic_scenario(key)
    scenario = evaluated.scenario
    parsed = TypeAdapter(RunCreate).validate_python(deepcopy(scenario.payload))

    assert evaluated.quality.is_analyzable is scenario.expected_is_analyzable
    assert evaluated.quality.analysis_limitation == scenario.expected_analysis_limitation
    if scenario.expected_is_analyzable:
        assert evaluated.metrics.rhythm_score is not None
        assert evaluated.metrics.in_range_sec is not None
    else:
        assert evaluated.metrics.rhythm_score is None
        assert evaluated.metrics.in_range_sec is None
        assert evaluated.metrics.late_drop_rate is None
        assert evaluated.metrics.fatigue_index is None

    if isinstance(parsed, AppRunCreate):
        assert tuple(event.type for event in parsed.events) == scenario.expected_event_types
        assert all(sample.t % 5 == 0 for sample in parsed.samples)
    else:
        assert isinstance(parsed, ManualRunCreate)
        assert scenario.ai_call_allowed is False


def test_manual_fixture_omits_every_app_only_and_server_owned_field() -> None:
    payload = get_synthetic_scenario("manual_run").payload
    forbidden = {
        "goal_type", "goal_value", "target_cadence_min", "target_cadence_max",
        "final_target_min", "final_target_max", "avg_cadence",
        "avg_pace_sec_per_km", "intervention_count", "downshift_count",
        "samples", "events", "rhythm_score", "late_drop_rate", "fatigue_index",
    }
    assert forbidden.isdisjoint(payload)


def test_scenario_specific_production_outcomes() -> None:
    stable = evaluate_synthetic_scenario("stable_completion")
    early_fast = evaluate_synthetic_scenario("early_overspeed")
    late_drop = evaluate_synthetic_scenario("late_cadence_decline")
    recovered = evaluate_synthetic_scenario("deviation_then_recovery")
    downshift = evaluate_synthetic_scenario("target_downshift")
    tired = evaluate_synthetic_scenario("tired_condition")
    rested = evaluate_synthetic_scenario("stable_completion")

    assert stable.metrics.rhythm_score == 1.0
    assert early_fast.metrics.rhythm_score < stable.metrics.rhythm_score
    assert late_drop.metrics.late_drop_rate is not None and late_drop.metrics.late_drop_rate > 0
    assert recovered.metrics.rhythm_score is not None and 0 < recovered.metrics.rhythm_score < 1
    assert downshift.metrics.rhythm_score == 1.0
    assert tired.metrics.fatigue_index is not None
    assert rested.metrics.fatigue_index is not None
    assert tired.metrics.fatigue_index > rested.metrics.fatigue_index


@pytest.mark.parametrize(
    ("duration", "is_analyzable", "limitation"),
    [(179, False, "TOO_SHORT"), (180, True, None), (181, True, None)],
)
def test_active_duration_179_180_181_boundary(duration, is_analyzable, limitation) -> None:
    result = assess_run_quality(_quality_input(duration, _samples(duration)))
    assert result.active_duration_sec == duration
    assert result.is_analyzable is is_analyzable
    assert result.analysis_limitation == limitation


@pytest.mark.parametrize(
    ("valid_count", "expected_coverage", "is_analyzable"),
    [(27, 0.675, False), (28, 0.70, True), (29, 0.725, True)],
)
def test_sensor_coverage_nearest_representable_values_around_seventy_percent(
    valid_count, expected_coverage, is_analyzable
) -> None:
    duration = 200
    samples = _samples(duration)[:valid_count]
    result = assess_run_quality(_quality_input(duration, samples))
    assert floor(duration / 5) == 40
    assert result.valid_sample_count == valid_count
    assert result.sensor_coverage == pytest.approx(expected_coverage)
    assert result.is_analyzable is is_analyzable
    assert result.analysis_limitation == (None if is_analyzable else "INSUFFICIENT_SENSOR_DATA")


@pytest.mark.parametrize(
    ("duration", "is_computed"),
    [(359, False), (360, True), (361, True)],
)
def test_late_drop_duration_just_below_at_and_above_six_minutes(duration, is_computed) -> None:
    # Identical samples isolate duration; all 72 timestamps are valid for every duration.
    samples = [{"t": second, "c": 160 if second < 240 else 140} for second in range(0, 360, 5)]
    value = compute_late_drop_rate(samples, duration)
    assert (value is not None) is is_computed


@pytest.mark.parametrize(
    ("ldr_sample_count", "is_computed"),
    [(29, False), (30, True), (31, True)],
)
def test_late_drop_valid_sample_29_30_31_boundary(ldr_sample_count, is_computed) -> None:
    # Run-quality coverage stays 100%; only cadence>=50 samples after warmup vary.
    samples = _samples(360, cadence=0)
    eligible_indexes = [index for index, sample in enumerate(samples) if sample["t"] >= 90]
    for order, index in enumerate(eligible_indexes[:ldr_sample_count]):
        samples[index]["c"] = 160 if order < ldr_sample_count // 2 else 140
    quality = assess_run_quality(_quality_input(360, samples))
    value = compute_late_drop_rate(samples, 360)
    assert quality.is_analyzable is True
    assert (value is not None) is is_computed


def test_missing_gps_and_pace_remain_schema_valid_without_blocking_cadence_metrics() -> None:
    scenario = get_synthetic_scenario("missing_gps_and_pace")
    parsed = parse_synthetic_run(scenario)
    evaluated = evaluate_synthetic_scenario(scenario.key)
    assert isinstance(parsed, AppRunCreate)
    assert parsed.distance_m is None and parsed.avg_pace_sec_per_km is None
    assert all(sample.p is None and sample.d is None for sample in parsed.samples)
    assert evaluated.quality.is_analyzable is True
    assert evaluated.metrics.rhythm_score is not None


def test_first_run_baseline_candidate_does_not_invent_unimplemented_server_value() -> None:
    scenario = get_synthetic_scenario("first_run_baseline_candidate")
    assert scenario.confirmation_needed is not None
    assert "baseline_cadence" not in scenario.payload


def test_factory_and_evaluation_make_no_external_http_calls(monkeypatch) -> None:
    def forbidden(*_args, **_kwargs):
        raise AssertionError("synthetic evaluation must not call external HTTP")

    monkeypatch.setattr(httpx.Client, "request", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "request", forbidden)
    for key in SYNTHETIC_SCENARIO_KEYS:
        evaluate_synthetic_scenario(key)
