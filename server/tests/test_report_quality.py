from dataclasses import replace

import pytest

from app.services.llm import _safe_summary, generate_llm_report
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


def test_unsupported_numeric_claim_is_rejected_but_documented_rounding_passes() -> None:
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
    assert unsupported.reasons == (HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,)


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
        HardGateReason.UNSUPPORTED_NUMERIC_CLAIM,
        HardGateReason.MEDICAL_CLAIM_DETECTED,
        HardGateReason.BLAMING_LANGUAGE_DETECTED,
        HardGateReason.NEXT_GOAL_CONTRADICTION,
    }
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
        ({"evidence": ["안정 구간 87%"]}, HardGateReason.UNSUPPORTED_NUMERIC_CLAIM),
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
