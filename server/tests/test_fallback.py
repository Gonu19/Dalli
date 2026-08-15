from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.models import Run
from app.services.fallback import build_fallback_report, fatigue_label
from app.services.metrics import compute_run_metrics
from app.services.run_quality import assess_run_quality


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


def app_run(**changes) -> Run:
    values = dict(
        source="APP",
        client_run_id="fallback-run",
        started_at=NOW,
        goal_type="TIME",
        goal_value=1200,
        condition=3,
        target_cadence_min=153,
        target_cadence_max=161,
        final_target_min=153,
        final_target_max=161,
        duration_sec=360,
        distance_m=1000,
        completed=True,
        rhythm_score=Decimal("1.000"),
        late_drop_rate=Decimal("0.000"),
        fatigue_index=Decimal("0.100"),
        intervention_count=0,
        downshift_count=0,
        samples=[{"t": t, "c": 157} for t in range(0, 360, 5)],
        events=[],
    )
    values.update(changes)
    return Run(**values)


def build(run: Run):
    quality = assess_run_quality(run)
    metrics = compute_run_metrics(run, quality)
    return build_fallback_report(run, quality, metrics)


@pytest.mark.parametrize(
    ("value", "label"),
    [
        (Decimal("0.349"), "여유로움"),
        (Decimal("0.350"), "보통"),
        (Decimal("0.599"), "보통"),
        (Decimal("0.600"), "부담됨"),
        (None, None),
    ],
)
def test_fatigue_label_exact_boundaries(value, label):
    assert fatigue_label(value) == label


def test_fallback_is_deterministic_pure_and_uses_only_supported_fields():
    run = app_run()
    original_samples = deepcopy(run.samples)
    original_events = deepcopy(run.events)

    first = build(run)
    second = build(run)

    assert first == second
    assert 1 <= len(first.evidence) <= 3
    assert first.hypothesis is None
    assert first.prescription is None
    assert first.recovery_note is None
    assert first.is_fallback is True
    assert first.model is None
    assert run.samples == original_samples
    assert run.events == original_events
    visible = " ".join((first.verdict, *first.evidence, first.next_goal_text))
    assert all(term not in visible for term in ("Rhythm Score", "Fatigue Index", "downshift", "쿨다운"))


@pytest.mark.parametrize(
    ("fatigue", "expected_phrase"),
    [
        (Decimal("0.349"), "여유"),
        (Decimal("0.350"), "무리 없이"),
        (Decimal("0.600"), "부담"),
    ],
)
def test_fallback_verdict_uses_fatigue_label_without_exposing_decimal(fatigue, expected_phrase):
    content = build(app_run(fatigue_index=fatigue))
    assert expected_phrase in content.verdict
    assert str(fatigue) not in content.verdict


def test_fallback_with_null_fatigue_does_not_guess_burden():
    content = build(app_run(late_drop_rate=None, fatigue_index=None))
    assert "안정 구간" in content.verdict
    assert "오늘의 부담" not in " ".join(content.evidence)


def test_fallback_with_rhythm_and_late_drop_but_null_fatigue_stays_conservative():
    content = build(
        app_run(
            rhythm_score=Decimal("0.700"),
            late_drop_rate=Decimal("0.100"),
            fatigue_index=None,
        )
    )
    visible = " ".join((content.verdict, *content.evidence))
    assert "안정 구간" in visible
    assert "오늘의 부담" not in visible
    assert "후반 리듬 하락" not in visible


def test_fallback_limitation_covers_gps_short_run_and_sensor_shortage():
    short = build(
        app_run(
            duration_sec=179,
            distance_m=None,
            rhythm_score=None,
            late_drop_rate=None,
            fatigue_index=None,
            samples=[{"t": 0, "c": 157}],
        )
    )
    insufficient = build(
        app_run(
            distance_m=None,
            rhythm_score=None,
            late_drop_rate=None,
            fatigue_index=None,
            samples=[{"t": 0, "c": 157}],
        )
    )
    under_six = build(
        app_run(
            duration_sec=180,
            late_drop_rate=None,
            fatigue_index=None,
            samples=[{"t": t, "c": 157} for t in range(0, 180, 5)],
        )
    )

    assert "3분 미만" in short.limitation
    assert "위치 정보" in short.limitation
    assert "측정 데이터가 부족" in insufficient.limitation
    assert "6분 미만" in under_six.limitation


def test_fallback_uses_final_target_and_only_upshifts_on_confirmed_rule():
    maintained = build(
        app_run(
            final_target_min=148,
            final_target_max=156,
            downshift_count=1,
            samples=[{"t": t, "c": 152} for t in range(0, 360, 5)],
        )
    )
    upshifted = build(app_run())
    incomplete = build(app_run(completed=False))

    assert (maintained.next_target_min, maintained.next_target_max) == (148, 156)
    assert (upshifted.next_target_min, upshifted.next_target_max) == (155, 163)
    assert (incomplete.next_target_min, incomplete.next_target_max) == (153, 161)


@pytest.mark.parametrize(("upper_seconds", "expected"), [(115, (153, 161)), (120, (155, 163))])
def test_fallback_upshift_uses_exact_sixty_percent_upper_range_boundary(
    upper_seconds,
    expected,
):
    run = app_run(
        duration_sec=200,
        goal_value=200,
        samples=[
            {"t": t, "c": 157 if t < upper_seconds else 153}
            for t in range(0, 200, 5)
        ],
    )
    content = build(run)
    assert (content.next_target_min, content.next_target_max) == expected


def test_fallback_distance_goal_keeps_distance_and_shows_target_center():
    content = build(app_run(goal_type="DISTANCE", goal_value=5000))
    assert content.next_goal_text == "다음 목표: 5km 완주, 리듬 159"


def test_fallback_rejects_corrupted_app_run_without_any_target_range():
    run = app_run(
        target_cadence_min=None,
        target_cadence_max=None,
        final_target_min=None,
        final_target_max=None,
    )
    with pytest.raises(ValueError, match="target range"):
        build(run)
