from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import Run, User
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
    assert first.prescription
    assert first.recovery_note is None
    assert first.is_fallback is True
    assert first.model is None
    assert run.samples == original_samples
    assert run.events == original_events
    visible = " ".join((first.verdict, *first.evidence, first.next_goal_text))
    assert all(term not in visible for term in ("Rhythm Score", "Fatigue Index", "downshift", "쿨다운"))


@pytest.mark.parametrize(
    ("purpose", "expected"),
    [
        ("COMPLETE", "끊지 않고 완주"),
        ("HABIT", "다음 러닝 시점"),
        ("WEIGHT", "지속 시간"),
        ("FITNESS", "후반까지 유지"),
        ("PERFORMANCE", "안정 구간의 비율"),
    ],
)
def test_fallback_prescription_follows_running_purpose(purpose, expected):
    run = app_run()
    run.user = User(running_purpose=purpose)

    content = build(run)

    assert expected in content.prescription
    assert content.prescription.endswith(".")
    assert "체중" not in content.prescription
    assert "칼로리" not in content.prescription
    assert "감량" not in content.prescription


def test_same_run_data_keeps_next_target_but_branches_all_purpose_output():
    contents = []
    for purpose in ("COMPLETE", "HABIT", "WEIGHT", "FITNESS", "PERFORMANCE"):
        run = app_run()
        run.user = User(running_purpose=purpose)
        contents.append(build(run))

    assert {(content.next_target_min, content.next_target_max) for content in contents} == {
        (155, 163)
    }
    assert len({content.verdict for content in contents}) == 5
    assert len({content.evidence for content in contents}) == 5
    assert len({content.next_goal_text for content in contents}) == 5
    assert len({content.prescription for content in contents}) == 5


def test_habit_evidence_uses_previous_app_interval_and_omits_it_when_unavailable():
    owner = User(running_purpose="HABIT")
    current = app_run()
    current.id = uuid4()
    current.user = owner
    previous_app = app_run()
    previous_app.id = uuid4()
    previous_app.started_at = NOW.replace(day=12)
    previous_app.user = owner
    owner.runs = [previous_app, current]

    with_previous = build(current)
    visible = " ".join((with_previous.verdict, *with_previous.evidence, with_previous.next_goal_text))
    assert "이번 주" in visible
    assert "3일 간격" in visible

    owner.runs = [current]
    without_previous = build(current)
    visible = " ".join(
        (
            without_previous.verdict,
            *without_previous.evidence,
            without_previous.prescription,
            without_previous.next_goal_text,
        )
    )
    assert "이번 주" in visible
    assert "간격" not in visible
    assert "이틀" not in visible


def test_non_habit_evidence_does_not_use_previous_app_interval():
    owner = User(running_purpose="PERFORMANCE")
    current = app_run()
    current.user = owner
    previous_app = app_run()
    previous_app.started_at = NOW.replace(day=12)
    previous_app.user = owner
    owner.runs = [previous_app, current]

    content = build(current)

    assert all("일 간격" not in evidence for evidence in content.evidence)


def test_weight_output_keeps_target_numeric_and_avoids_weight_metrics():
    run = app_run()
    run.user = User(running_purpose="WEIGHT")

    content = build(run)
    visible = " ".join((content.verdict, *content.evidence, content.prescription, content.next_goal_text))

    assert (content.next_target_min, content.next_target_max) == (155, 163)
    assert all(term not in visible for term in ("체중", "칼로리", "감량"))


def test_fallback_recovery_prescription_overrides_running_purpose():
    run = app_run(
        events=[{"t": 300, "type": "RECOVERY_MODE_ON", "reason": "downshift_exhausted"}],
    )
    run.user = User(running_purpose="PERFORMANCE")

    content = build(run)

    assert content.prescription == "지금은 회복을 우선하고, 편하게 이어가 보세요."


def test_fallback_prioritizes_recovery_after_short_gap_and_high_fatigue():
    owner = User(running_purpose="PERFORMANCE")
    current = app_run(fatigue_index=Decimal("0.600"))
    current.id = uuid4()
    current.started_at = NOW
    current.user = owner
    previous = app_run()
    previous.id = uuid4()
    previous.started_at = NOW.replace(day=14)
    previous.user = owner
    owner.runs = [previous, current]

    close_gap = build(current)

    previous.started_at = NOW.replace(day=10)
    wide_gap = build(current)

    assert "회복" in close_gap.prescription
    assert "회복" not in wide_gap.prescription


def test_fallback_verdict_keeps_complete_and_stable_focus_without_raw_fields():
    content = build(app_run(fatigue_index=Decimal("0.600")))
    assert "안정적인 리듬" in content.verdict
    assert "완주" in content.verdict
    assert "0.600" not in content.verdict


def test_fallback_formats_long_durations_for_people():
    content = build(
        app_run(
            duration_sec=548,
            samples=[{"t": t, "c": 157} for t in range(0, 548, 5)],
        )
    )
    visible = " ".join((content.verdict, *content.evidence, content.limitation or ""))

    assert "548초" not in visible
    assert "9분 8초" in visible


def test_fallback_formats_long_pace_without_raw_seconds():
    run = app_run(avg_pace_sec_per_km=328)
    run.user = User(running_purpose="PERFORMANCE")
    content = build(run)

    assert any("5분 28초/km" in evidence for evidence in content.evidence)
    assert "328초/km" not in content.evidence


def test_fallback_with_null_fatigue_does_not_guess_burden():
    content = build(app_run(late_drop_rate=None, fatigue_index=None))
    assert "안정적인 리듬" in content.verdict
    assert "안정 구간" in " ".join(content.evidence)
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


def test_fallback_uses_active_duration_for_late_drop_limitation():
    long_run_with_sparse_late_data = build(
        app_run(
            duration_sec=900,
            late_drop_rate=None,
            samples=[{"t": t, "c": 157} for t in range(0, 900, 5)],
        )
    )
    assert "6분 미만" not in long_run_with_sparse_late_data.limitation
    assert "측정 데이터가 부족" in long_run_with_sparse_late_data.limitation

    paused_run = app_run(
        duration_sec=900,
        late_drop_rate=None,
        samples=[{"t": t, "c": 157} for t in range(700, 900, 5)],
        events=[
            {"t": 0, "type": "PAUSE"},
            {"t": 700, "type": "RESUME"},
        ],
    )
    paused_content = build(paused_run)
    assert "6분 미만" in paused_content.limitation


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
