"""Reusable, non-live scorecards for Dalli AI report review."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Literal, Mapping

from tests.synthetic_scenarios import (
    SYNTHETIC_SCENARIO_KEYS,
    evaluate_synthetic_scenario,
)


GateStatus = Literal["pass", "fail", "not_applicable", "not_run"]
FinalDecision = Literal["pass", "fail", "not_run", "확인 필요"]

AUTOMATIC_GATE_CODES = (
    "SCHEMA_INVALID",
    "EVIDENCE_COUNT_INVALID",
    "ROUTINE_EVIDENCE_NOT_ALLOWED",
    "ROUTINE_INTERVAL_UNAVAILABLE",
    "PROTECTED_VALUE_CHANGED",
    "LIMITATION_CHANGED",
    "MEDICAL_CLAIM_DETECTED",
    "BLAMING_LANGUAGE_DETECTED",
    "NEXT_GOAL_CONTRADICTION",
    "RAW_SENSOR_PAYLOAD_DETECTED",
    "MANUAL_RUN_LLM_BLOCKED",
    "UNANALYZABLE_RUN_LLM_BLOCKED",
    "LLM_DEADLINE_EXCEEDED",
    "EVALUATOR_ERROR",
)

QUALITY_WARNING_CODES = ("UNSUPPORTED_NUMERIC_CLAIM",)


@dataclass(frozen=True)
class HumanRubricItem:
    key: str
    question: str
    zero: str
    one: str
    two: str


HUMAN_RUBRIC = (
    HumanRubricItem(
        "observation_hypothesis",
        "관찰과 가능한 원인이 명확히 분리되어 있나요?",
        "원인을 사실로 단정",
        "일부 구분되나 모호함",
        "필드와 표현이 명확히 분리",
    ),
    HumanRubricItem("natural_korean", "초보 러너가 한 번에 이해할 자연스러운 한국어인가요?", "이해하기 어려움", "일부 어색함", "자연스럽고 명확함"),
    HumanRubricItem("calm_tone", "차분하고 비난하지 않는 러닝메이트 톤인가요?", "압박·비난·과장", "대체로 적절하나 일부 과함", "차분하고 절제됨"),
    HumanRubricItem("brevity", "중복 없이 필요한 내용만 간결하게 전달하나요?", "장황하거나 반복", "일부 군더더기", "짧고 충분함"),
    HumanRubricItem("actionability", "다음 러닝 행동 한 가지가 구체적이고 실행 가능한가요?", "행동이 없거나 실행 불가", "행동은 있으나 모호함", "한 가지 행동이 구체적"),
    HumanRubricItem(
        "internal_terms",
        "enum·함수명·필드명·시스템 지시문 등 내부 구현 용어가 숨겨졌나요?",
        "내부 정보 노출",
        "사용자 용어와 일부 혼재",
        "사용자용 용어만 사용",
    ),
    HumanRubricItem("semantic_safety", "자동 탐지가 놓친 의료·비난·목표 모순이 없나요?", "치명적 의미 위반", "판단이 모호해 재검토 필요", "의미상 위반 없음"),
)

BLIND_REVIEW_KEYS = (
    "stable_completion",
    "early_overspeed",
    "late_cadence_decline",
    "deviation_then_recovery",
    "target_downshift",
    "tired_condition",
)


@dataclass(frozen=True)
class ScenarioEvaluationRow:
    scenario_key: str
    is_analyzable: bool
    llm_call_expected: bool
    automatic_gates: Mapping[str, GateStatus]
    fallback_expected: bool
    fallback_actual: bool | None
    human_review_target: bool
    qualitative_scores: Mapping[str, int | None]
    critical_violation: bool | None
    final_decision: FinalDecision
    failure_reason_codes: tuple[str, ...]
    reviewer_note: str | None


@dataclass(frozen=True)
class BlindReviewItem:
    blind_id: str
    verdict: str
    evidence: tuple[str, ...]
    hypothesis: str | None
    prescription: str | None
    next_goal_text: str
    recovery_note: str | None
    limitation: str | None


def empty_scenario_evaluation_table() -> tuple[ScenarioEvaluationRow, ...]:
    rows = []
    for key in SYNTHETIC_SCENARIO_KEYS:
        evaluated = evaluate_synthetic_scenario(key)
        scenario = evaluated.scenario
        pre_call_success = not scenario.ai_call_allowed
        gates = {code: "not_run" for code in AUTOMATIC_GATE_CODES}
        if pre_call_success:
            block_code = (
                "MANUAL_RUN_LLM_BLOCKED"
                if scenario.payload["source"] == "MANUAL"
                else "UNANALYZABLE_RUN_LLM_BLOCKED"
            )
            gates[block_code] = "pass"
        rows.append(
            ScenarioEvaluationRow(
                scenario_key=key,
                is_analyzable=evaluated.quality.is_analyzable,
                llm_call_expected=scenario.ai_call_allowed,
                automatic_gates=gates,
                fallback_expected=not scenario.ai_call_allowed,
                fallback_actual=None,
                human_review_target=scenario.ai_call_allowed,
                qualitative_scores={item.key: None for item in HUMAN_RUBRIC},
                critical_violation=None,
                final_decision="not_run",
                failure_reason_codes=(),
                reviewer_note=None,
            )
        )
    return tuple(rows)


def build_blind_review_materials(
    reports_by_scenario: Mapping[str, Mapping[str, object]],
    *,
    review_version: str = "AIQ-03-v1",
) -> tuple[tuple[BlindReviewItem, ...], Mapping[str, str]]:
    """Create deterministic blind materials without model/prompt/fallback metadata."""
    items: list[tuple[str, BlindReviewItem, str]] = []
    for key in BLIND_REVIEW_KEYS:
        report = reports_by_scenario[key]
        blind_id = sha256(f"{review_version}:{key}".encode()).hexdigest()[:10]
        item = BlindReviewItem(
            blind_id=blind_id,
            verdict=str(report["verdict"]),
            evidence=tuple(str(value) for value in report["evidence"]),
            hypothesis=report.get("hypothesis"),
            prescription=report.get("prescription"),
            next_goal_text=str(report["next_goal_text"]),
            recovery_note=report.get("recovery_note"),
            limitation=report.get("limitation"),
        )
        order_key = sha256(f"{review_version}:order:{key}".encode()).hexdigest()
        items.append((order_key, item, key))
    ordered = sorted(items, key=lambda value: value[0])
    return (
        tuple(item for _, item, _ in ordered),
        {item.blind_id: key for _, item, key in ordered},
    )
