from dataclasses import replace

import pytest

from app.services.llm import _safe_summary, generate_llm_report
from app.services.fallback import build_fallback_report
from app.services.report_quality import (
    HardGateReason,
    evaluate_outgoing_payload,
    evaluate_report_output,
    validate_fallback_content,
)
from tests.report_evaluation import (
    AUTOMATIC_GATE_CODES,
    BLIND_REVIEW_KEYS,
    HUMAN_RUBRIC,
    build_blind_review_materials,
    empty_scenario_evaluation_table,
)
from tests.test_llm import FakeClient, context, settings, valid_payload
from tests.test_reports import FakeSession, app_run, client_for, user
from tests.synthetic_scenarios import SYNTHETIC_SCENARIO_KEYS, evaluate_synthetic_scenario


def gate_context():
    current_run, quality, metrics, fallback = context()
    summary = _safe_summary(current_run, quality, metrics, fallback)
    payload = valid_payload(
        fallback.next_target_min,
        fallback.next_target_max,
        fallback.limitation,
    )
    return current_run, quality, metrics, fallback, summary, payload


def test_valid_report_passes_every_automatic_hard_gate() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output(payload, fallback, summary)
    assert result.passed is True
    assert result.reasons == ()
    assert result.content is not None


@pytest.mark.parametrize("evidence", [[], ["a", "b", "c", "d"]])
def test_invalid_evidence_count_reports_stable_reason_and_schema_failure(evidence) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output({**payload, "evidence": evidence}, fallback, summary)
    assert result.passed is False
    assert result.reasons == (
        HardGateReason.EVIDENCE_COUNT_INVALID,
        HardGateReason.SCHEMA_INVALID,
    )


def test_schema_protected_value_and_limitation_failures_are_distinct() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    missing = evaluate_report_output(
        {key: value for key, value in payload.items() if key != "next_target_min"},
        fallback,
        summary,
    )
    changed = evaluate_report_output(
        {
            **payload,
            "next_target_min": fallback.next_target_min - 1,
            "limitation": "임의 제한",
        },
        fallback,
        summary,
    )
    assert missing.reasons == (HardGateReason.SCHEMA_INVALID,)
    assert HardGateReason.PROTECTED_VALUE_CHANGED in changed.reasons
    assert HardGateReason.LIMITATION_CHANGED in changed.reasons


def test_unsupported_numeric_claim_is_a_warning_but_report_still_passes() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    allowed = evaluate_report_output(
        {
            **payload,
            "evidence": ["안정 구간 100% (600초)", "오늘의 부담 10%"],
            "prescription": "다음 러닝도 시작 5분 동안 같은 리듬을 유지해 보세요.",
        },
        fallback,
        summary,
    )
    unsupported = evaluate_report_output(
        {**payload, "evidence": ["후반 리듬이 87% 좋아졌어요."]},
        fallback,
        summary,
    )
    assert allowed.passed is True
    assert unsupported.passed is True
    assert unsupported.reasons == ()
    assert unsupported.warnings == (HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,)


def test_non_minute_duration_allows_exact_components_and_grounded_approximation() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    non_minute_summary = {
        **summary,
        "duration_sec": 223,
        "active_duration_sec": 223,
        "in_range_sec": 180,
    }

    exact = evaluate_report_output(
        {**payload, "evidence": ["러닝 시간은 3분 43초였어요."]},
        fallback,
        non_minute_summary,
    )
    approximate = evaluate_report_output(
        {**payload, "evidence": ["러닝 시간은 약 4분이었어요."]},
        fallback,
        non_minute_summary,
    )
    unmarked_approximation = evaluate_report_output(
        {**payload, "evidence": ["러닝 시간은 4분이었어요."]},
        fallback,
        non_minute_summary,
    )
    invented = evaluate_report_output(
        {**payload, "evidence": ["러닝 시간은 9분이었어요."]},
        fallback,
        non_minute_summary,
    )

    assert exact.passed is True
    assert approximate.passed is True
    assert unmarked_approximation.passed is True
    assert unmarked_approximation.reasons == ()
    assert unmarked_approximation.warnings == (HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,)
    assert invented.passed is True
    assert invented.reasons == ()
    assert invented.warnings == (HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,)


def test_routine_numbers_are_allowed_in_habit_evidence_only() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    routine_summary = {
        **summary,
        "this_week_plan_done": 1,
        "this_week_plan_total": 2,
    }
    non_habit = evaluate_report_output(
        {**payload, "evidence": ["이번 주 2회 중 1회 계획을 완료했어요."]},
        fallback,
        routine_summary,
    )
    habit = evaluate_report_output(
        {**payload, "evidence": ["이번 주 2회 중 1회 계획을 완료했어요."]},
        fallback,
        {**routine_summary, "running_purpose": "HABIT"},
    )

    assert non_habit.reasons == (HardGateReason.ROUTINE_EVIDENCE_NOT_ALLOWED,)
    assert habit.passed is True


def test_habit_previous_app_interval_is_allowed_only_when_available() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    habit_summary = {
        **summary,
        "running_purpose": "HABIT",
        "days_since_last_run": 3,
        "this_week_run_count": 2,
    }
    habit = evaluate_report_output(
        {
            **payload,
            "evidence": ["직전 러닝과 3일 간격", "이번 주 2회 러닝"],
            "next_goal_text": "다음 러닝은 이틀 안에 한 번 더 나가 보세요. 리듬 159",
        },
        fallback,
        habit_summary,
    )

    assert habit.passed is True


def test_habit_interval_is_rejected_when_previous_app_run_is_missing() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    habit_summary = {
        **summary,
        "running_purpose": "HABIT",
        "days_since_last_run": None,
        "this_week_run_count": 2,
    }
    result = evaluate_report_output(
        {
            **payload,
            "evidence": ["이번 주 2회 러닝"],
            "next_goal_text": "다음 러닝은 이틀 안에 한 번 더 나가 보세요. 리듬 159",
        },
        fallback,
        habit_summary,
    )

    assert result.reasons == (HardGateReason.ROUTINE_INTERVAL_UNAVAILABLE,)


def test_detail_segment_numbers_are_allowed_when_server_provides_aggregate_metadata() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    detail_summary = {
        **summary,
        "detail_time_blocks": [
            {"block_index": 1, "start_sec": 0, "end_sec": 600, "median_cadence": 157},
            {"block_index": 2, "start_sec": 600, "end_sec": 1200, "median_cadence": 154},
            {"block_index": 3, "start_sec": 1200, "end_sec": 1800, "median_cadence": 150},
        ],
        "detail_rapid_changes": [
            {"at_sec": 300, "direction": "상승", "before_cadence": 157, "after_cadence": 173},
        ],
        "segment_summary": [
            {
                "label": "초반",
                "start_sec": 0,
                "end_sec": 600,
                "sample_count": 120,
                "median_cadence": 157,
            },
            {
                "label": "중반",
                "start_sec": 600,
                "end_sec": 1200,
                "sample_count": 120,
                "median_cadence": 154,
                "cadence_delta": -3,
                "direction": "하락",
            },
        ],
    }
    result = evaluate_report_output(
        {
            **payload,
            "evidence": [
                "첫 구간 0~10분은 리듬 157 spm이었어요.",
                "5분 무렵 157에서 173 spm으로 급상승했어요.",
                "중반은 리듬 154 spm으로 초반보다 3 spm 낮았고, 마지막 구간은 150 spm이었어요.",
            ],
            "next_goal_text": "다음 목표는 리듬 159를 유지해 보세요.",
        },
        fallback,
        detail_summary,
    )

    assert result.passed is True


@pytest.mark.parametrize(
    ("field", "text", "reason"),
    [
        ("hypothesis", "무릎 부상입니다.", HardGateReason.MEDICAL_CLAIM_DETECTED),
        ("prescription", "치료가 필요하니 병원에 가세요.", HardGateReason.MEDICAL_CLAIM_DETECTED),
        ("verdict", "의지가 부족해서 완주하지 못했어요.", HardGateReason.BLAMING_LANGUAGE_DETECTED),
        ("hypothesis", "당신 잘못이에요.", HardGateReason.BLAMING_LANGUAGE_DETECTED),
    ],
)
def test_medical_and_blaming_language_are_rejected(field, text, reason) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output({**payload, field: text}, fallback, summary)
    assert reason in result.reasons


@pytest.mark.parametrize(
    "next_goal_text",
    [
        "다음 목표: 10분 완주, 리듬 150",
        "다음 목표에서는 리듬을 낮추고 159로 맞춰 보세요",
    ],
)
def test_next_goal_numeric_and_direction_contradictions_are_rejected(next_goal_text) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output(
        {**payload, "next_goal_text": next_goal_text},
        fallback,
        summary,
    )
    assert HardGateReason.NEXT_GOAL_CONTRADICTION in result.reasons


def test_multiple_semantic_failures_are_collected_without_response_text_in_reasons() -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output(
        {
            **payload,
            "verdict": "의지가 부족하고 부상입니다. 안정 구간 87%예요.",
            "next_goal_text": "다음 목표: 리듬 150",
        },
        fallback,
        summary,
    )
    assert set(result.reasons) >= {
        HardGateReason.MEDICAL_CLAIM_DETECTED,
        HardGateReason.BLAMING_LANGUAGE_DETECTED,
        HardGateReason.NEXT_GOAL_CONTRADICTION,
    }
    assert result.warnings == (HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,)
    assert all("부상" not in reason for reason in result.reasons)


def test_outgoing_payload_rejects_keys_and_nested_raw_sensor_records() -> None:
    current_run, _, _, _, summary, _ = gate_context()
    assert evaluate_outgoing_payload(summary, current_run.samples, current_run.events).passed
    direct = evaluate_outgoing_payload(
        {**summary, "samples": current_run.samples},
        current_run.samples,
        current_run.events,
    )
    nested = evaluate_outgoing_payload(
        {"aggregate": summary, "nested": current_run.samples},
        current_run.samples,
        current_run.events,
    )
    assert direct.reasons == nested.reasons == (
        HardGateReason.RAW_SENSOR_PAYLOAD_DETECTED,
    )


def test_manual_and_unanalyzable_runs_do_not_construct_openai_client() -> None:
    current_run, quality, metrics, fallback, _, _ = gate_context()

    def forbidden(**_kwargs):
        raise AssertionError("OpenAI client must not be constructed")

    current_run.source = "MANUAL"
    assert generate_llm_report(
        current_run, quality, metrics, fallback, settings(), client_factory=forbidden
    ) is None
    current_run.source = "APP"
    insufficient = replace(
        quality,
        is_analyzable=False,
        analysis_limitation="INSUFFICIENT_SENSOR_DATA",
    )
    assert generate_llm_report(
        current_run,
        insufficient,
        metrics,
        fallback,
        settings(),
        client_factory=forbidden,
    ) is None


def test_evaluator_error_fails_closed_before_llm_content_is_returned(monkeypatch) -> None:
    current_run, quality, metrics, fallback, _, payload = gate_context()

    def broken(*_args, **_kwargs):
        raise RuntimeError("private evaluator detail")

    monkeypatch.setattr("app.services.llm.evaluate_report_output", broken)
    result = generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(),
        client_factory=lambda **_kwargs: FakeClient(payload),
    )
    assert result is None


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"hypothesis": "무릎 부상입니다."}, HardGateReason.MEDICAL_CLAIM_DETECTED),
        ({"verdict": "의지가 부족한 러닝이에요."}, HardGateReason.BLAMING_LANGUAGE_DETECTED),
        ({"next_goal_text": "다음 목표: 리듬 150"}, HardGateReason.NEXT_GOAL_CONTRADICTION),
    ],
)
def test_semantic_hard_gate_failures_are_connected_to_fallback_path(
    changes,
    reason,
    caplog,
) -> None:
    current_run, quality, metrics, fallback, _, payload = gate_context()
    result = generate_llm_report(
        current_run,
        quality,
        metrics,
        fallback,
        settings(),
        client_factory=lambda **_kwargs: FakeClient({**payload, **changes}),
    )
    assert result is None
    records = [record for record in caplog.records if hasattr(record, "llm_reason_codes")]
    assert any(reason in record.llm_reason_codes for record in records)
    assert all("부상" not in record.getMessage() for record in records)


def test_deterministic_fallback_satisfies_final_report_content_schema() -> None:
    _, _, _, fallback, _, _ = gate_context()
    validate_fallback_content(fallback)


def test_aiq02_scenario_table_has_twelve_rows_and_pre_call_success_conditions() -> None:
    rows = empty_scenario_evaluation_table()
    assert len(rows) == 12
    assert {row.scenario_key for row in rows} == {
        "stable_completion", "early_overspeed", "late_cadence_decline",
        "deviation_then_recovery", "target_downshift", "incomplete_run",
        "tired_condition", "first_run_baseline_candidate", "too_short",
        "insufficient_sensor_coverage", "missing_gps_and_pace", "manual_run",
    }
    assert all(set(row.automatic_gates) == set(AUTOMATIC_GATE_CODES) for row in rows)
    manual = next(row for row in rows if row.scenario_key == "manual_run")
    insufficient = next(
        row for row in rows if row.scenario_key == "insufficient_sensor_coverage"
    )
    assert manual.automatic_gates["MANUAL_RUN_LLM_BLOCKED"] == "pass"
    assert insufficient.automatic_gates["UNANALYZABLE_RUN_LLM_BLOCKED"] == "pass"


def test_six_report_blind_materials_are_deterministic_and_hide_model_metadata() -> None:
    report = gate_context()[-1]
    reports = {key: report for key in BLIND_REVIEW_KEYS}
    first, first_mapping = build_blind_review_materials(reports)
    second, second_mapping = build_blind_review_materials(reports)
    assert first == second
    assert first_mapping == second_mapping
    assert len(first) == len(BLIND_REVIEW_KEYS) == 6
    assert len(HUMAN_RUBRIC) == 7
    assert all(not hasattr(item, "model") and not hasattr(item, "prompt") for item in first)
    assert all(not hasattr(item, "scenario_key") for item in first)


@pytest.mark.parametrize(
    ("field", "text", "reason"),
    [
        ("evidence", ["다음 리듬은 159km가 적절해요."], HardGateReason.UNSUPPORTED_NUMERIC_CLAIM),
        ("hypothesis", "족저근막염으로 진단됩니다.", HardGateReason.MEDICAL_CLAIM_DETECTED),
        ("verdict", "고작 이것밖에 못 달린 러닝이에요.", HardGateReason.BLAMING_LANGUAGE_DETECTED),
        (
            "next_goal_text",
            "다음 목표에서는 리듬을 더 느리게 맞춰 보세요.",
            HardGateReason.NEXT_GOAL_CONTRADICTION,
        ),
    ],
)
def test_aiq04_reproduced_validator_gaps_are_blocked(field, text, reason) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output({**payload, field: text}, fallback, summary)
    if reason == HardGateReason.UNSUPPORTED_NUMERIC_CLAIM:
        assert reason in result.warnings
    else:
        assert reason in result.reasons


@pytest.mark.parametrize(
    ("field", "text"),
    [
        ("evidence", ["안정 구간 100% (600초)", "다음 목표 리듬은 159spm이에요."]),
        ("recovery_note", "무리하지 말고 편안하게 회복해 주세요."),
        ("recovery_note", "불편함이 지속되면 전문가와 상담하세요."),
        ("verdict", "목표 범위를 벗어난 구간이 있었지만 러닝을 기록했어요."),
        ("prescription", "다음 러닝은 시작 5분 동안 같은 리듬을 유지해 보세요."),
        ("next_goal_text", "다음 목표: 10분 완주, 리듬 159"),
        ("next_goal_text", "다음 목표: 10분 완주, 리듬 155~163"),
    ],
)
def test_aiq04_normal_korean_contrast_reports_are_not_overblocked(field, text) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output({**payload, field: text}, fallback, summary)
    assert result.passed is True


@pytest.mark.parametrize(
    ("field", "claim"),
    [
        ("verdict", "오늘의 안정 구간은 87%예요."),
        ("evidence", ["목표보다 87spm 높았어요."]),
        ("hypothesis", "처음 87분의 영향일 수 있어요."),
        ("prescription", "다음에는 87km를 달려보세요."),
        ("next_goal_text", "다음 목표: 87분 완주, 리듬 159"),
        ("recovery_note", "87일 동안 쉬어 주세요."),
        ("limitation", "87개 샘플이 누락됐어요."),
    ],
)
def test_invented_numeric_claim_is_checked_in_every_free_text_field(field, claim) -> None:
    _, _, _, fallback, summary, payload = gate_context()
    result = evaluate_report_output({**payload, field: claim}, fallback, summary)
    assert HardGateReason.UNSUPPORTED_NUMERIC_CLAIM in result.warnings


@pytest.mark.parametrize(
    "scenario_key",
    [
        key
        for key in SYNTHETIC_SCENARIO_KEYS
        if evaluate_synthetic_scenario(key).scenario.ai_call_allowed
    ],
)
def test_aiq02_analyzable_scenarios_accept_neutral_contract_valid_reports(
    scenario_key,
) -> None:
    evaluated = evaluate_synthetic_scenario(scenario_key)
    fallback = build_fallback_report(
        evaluated.run,
        evaluated.quality,
        evaluated.metrics,
    )
    summary = _safe_summary(
        evaluated.run,
        evaluated.quality,
        evaluated.metrics,
        fallback,
    )
    payload = {
        "verdict": fallback.verdict,
        "evidence": list(fallback.evidence),
        "hypothesis": None,
        "prescription": None,
        "next_goal_text": fallback.next_goal_text,
        "next_target_min": fallback.next_target_min,
        "next_target_max": fallback.next_target_max,
        "recovery_note": None,
        "limitation": fallback.limitation,
    }
    result = evaluate_report_output(payload, fallback, summary)
    assert result.passed is True, (scenario_key, result.reasons)


@pytest.mark.parametrize(
    "violation",
    [
        {"hypothesis": "족저근막염으로 진단됩니다."},
        {"verdict": "고작 이것밖에 못 달린 러닝이에요."},
        {"next_goal_text": "다음 목표에서는 리듬을 더 느리게 맞춰 보세요."},
    ],
)
def test_validator_violation_persists_only_fallback_and_repeat_does_not_call_llm(
    violation,
    monkeypatch,
) -> None:
    owner = user()
    run = app_run(owner)
    db = FakeSession([run, None])
    calls = 0

    def evaluated_llm(current_run, quality, metrics, fallback, current_settings):
        nonlocal calls
        calls += 1
        payload = valid_payload(
            fallback.next_target_min,
            fallback.next_target_max,
            fallback.limitation,
        )
        return generate_llm_report(
            current_run,
            quality,
            metrics,
            fallback,
            current_settings,
            client_factory=lambda **_kwargs: FakeClient({**payload, **violation}),
        )

    monkeypatch.setattr("app.services.reports.generate_llm_report", evaluated_llm)
    report_settings = settings()
    created = client_for(owner, db, report_settings).post(f"/runs/{run.id}/report")
    stored = db.added[0]
    repeated_db = FakeSession([run, stored])
    repeated = client_for(owner, repeated_db, report_settings).post(
        f"/runs/{run.id}/report"
    )

    assert created.status_code == repeated.status_code == 200
    assert created.json()["is_fallback"] is True
    assert created.json()["model"] is None
    assert stored.is_fallback is True and stored.model is None
    assert repeated.json() == created.json()
    assert calls == 1
    assert not repeated_db.added and repeated_db.commits == 0
