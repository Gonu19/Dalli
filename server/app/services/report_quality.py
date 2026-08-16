from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
import re
from typing import Annotated, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.fallback import FallbackReportContent


NonEmptyText = Annotated[str, Field(min_length=1)]


class LLMReportContent(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    verdict: NonEmptyText
    evidence: list[NonEmptyText] = Field(min_length=1, max_length=3)
    hypothesis: NonEmptyText | None
    prescription: NonEmptyText | None
    next_goal_text: NonEmptyText
    next_target_min: int
    next_target_max: int
    recovery_note: NonEmptyText | None
    limitation: NonEmptyText | None


class HardGateReason(StrEnum):
    SCHEMA_INVALID = "SCHEMA_INVALID"
    EVIDENCE_COUNT_INVALID = "EVIDENCE_COUNT_INVALID"
    PROTECTED_VALUE_CHANGED = "PROTECTED_VALUE_CHANGED"
    LIMITATION_CHANGED = "LIMITATION_CHANGED"
    UNSUPPORTED_NUMERIC_CLAIM = "UNSUPPORTED_NUMERIC_CLAIM"
    MEDICAL_CLAIM_DETECTED = "MEDICAL_CLAIM_DETECTED"
    BLAMING_LANGUAGE_DETECTED = "BLAMING_LANGUAGE_DETECTED"
    NEXT_GOAL_CONTRADICTION = "NEXT_GOAL_CONTRADICTION"
    RAW_SENSOR_PAYLOAD_DETECTED = "RAW_SENSOR_PAYLOAD_DETECTED"
    MANUAL_RUN_LLM_BLOCKED = "MANUAL_RUN_LLM_BLOCKED"
    UNANALYZABLE_RUN_LLM_BLOCKED = "UNANALYZABLE_RUN_LLM_BLOCKED"
    LLM_DEADLINE_EXCEEDED = "LLM_DEADLINE_EXCEEDED"
    EVALUATOR_ERROR = "EVALUATOR_ERROR"


@dataclass(frozen=True)
class HardGateResult:
    passed: bool
    reasons: tuple[HardGateReason, ...]
    content: LLMReportContent | None = None


MEDICAL_PATTERNS = (
    re.compile(pattern)
    for pattern in (
        r"\b진단(?:입니다|이에요|이다|됐다)",
        r"\b치료(?:가 필요|해야|하세요)",
        r"\b(?:골절|염좌|질병|부상)(?:입니다|이에요|이다)",
        r"\b(?:약|진통제)을? (?:복용|드세요)",
    )
)
MEDICAL_PATTERNS = tuple(MEDICAL_PATTERNS)
BLAMING_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"의지(?:가|는) 부족",
        r"노력(?:이|은) 부족",
        r"게으르",
        r"당신(?:의)? 잘못",
        r"성격(?:이|의) 문제",
        r"사용자 탓",
    )
)
NUMBER_PATTERN = re.compile(r"(?<![\w])[-+]?\d+(?:\.\d+)?")
RHYTHM_TARGET_PATTERN = re.compile(r"리듬\s*([-+]?\d+(?:\.\d+)?)")


def _add_reason(reasons: list[HardGateReason], reason: HardGateReason) -> None:
    if reason not in reasons:
        reasons.append(reason)


def _all_text(content: LLMReportContent) -> tuple[str, ...]:
    return tuple(
        text
        for text in (
            content.verdict,
            *content.evidence,
            content.hypothesis,
            content.prescription,
            content.next_goal_text,
            content.recovery_note,
            content.limitation,
        )
        if text is not None
    )


def _canonical_number(value: int | float | Decimal) -> str:
    decimal = Decimal(str(value))
    return format(decimal.normalize(), "f")


def _numeric_allowlist(summary: Mapping[str, object]) -> set[str]:
    allowed: set[str] = set()
    for key, value in summary.items():
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            continue
        allowed.add(_canonical_number(value))
        if key in {"rhythm_score", "late_drop_rate", "fatigue_index"}:
            allowed.add(str(round(float(value) * 100)))
        if key in {"duration_sec", "goal_value", "active_duration_sec", "in_range_sec"}:
            allowed.add(str(round(float(value))))
        if key in {"duration_sec", "goal_value"} and float(value) % 60 == 0:
            allowed.add(_canonical_number(float(value) / 60))
        if key in {"distance_m", "goal_value"} and float(value) % 1000 == 0:
            allowed.add(_canonical_number(float(value) / 1000))
    next_min = summary.get("next_target_min")
    next_max = summary.get("next_target_max")
    if isinstance(next_min, int) and isinstance(next_max, int):
        allowed.add(_canonical_number(round((next_min + next_max) / 2)))
    return allowed


def _has_unsupported_numeric_claim(
    content: LLMReportContent,
    summary: Mapping[str, object],
) -> bool:
    allowed = _numeric_allowlist(summary)
    for field_name, texts in (
        ("verdict", (content.verdict,)),
        ("evidence", tuple(content.evidence)),
        ("hypothesis", (content.hypothesis,)),
        ("prescription", (content.prescription,)),
        ("next_goal_text", (content.next_goal_text,)),
        ("recovery_note", (content.recovery_note,)),
        ("limitation", (content.limitation,)),
    ):
        for text in texts:
            if text is None:
                continue
            for match in NUMBER_PATTERN.finditer(text):
                number = _canonical_number(Decimal(match.group()))
                # CONTRACT's prescription example explicitly permits "시작 5분".
                if field_name == "prescription" and number == "5" and "시작" in text:
                    continue
                if number not in allowed:
                    return True
    return False


def _next_goal_contradicts(
    content: LLMReportContent,
    fallback: FallbackReportContent,
    summary: Mapping[str, object],
) -> bool:
    center = round((fallback.next_target_min + fallback.next_target_max) / 2)
    mentioned = RHYTHM_TARGET_PATTERN.findall(content.next_goal_text)
    if any(Decimal(value) != Decimal(center) for value in mentioned):
        return True

    current_min = summary.get("current_target_min")
    current_max = summary.get("current_target_max")
    if not isinstance(current_min, int) or not isinstance(current_max, int):
        return False
    current_center = (current_min + current_max) / 2
    direction = center - current_center
    text = content.next_goal_text
    says_down = any(word in text for word in ("낮추", "줄이"))
    says_up = any(word in text for word in ("높이", "올리", "늘리"))
    return (direction > 0 and says_down) or (direction < 0 and says_up) or (
        direction == 0 and (says_down or says_up)
    )


def evaluate_report_output(
    parsed: object,
    fallback: FallbackReportContent,
    summary: Mapping[str, object],
) -> HardGateResult:
    reasons: list[HardGateReason] = []
    if isinstance(parsed, dict):
        evidence = parsed.get("evidence")
        if isinstance(evidence, list) and not 1 <= len(evidence) <= 3:
            _add_reason(reasons, HardGateReason.EVIDENCE_COUNT_INVALID)
    try:
        content = LLMReportContent.model_validate(parsed)
    except ValidationError:
        _add_reason(reasons, HardGateReason.SCHEMA_INVALID)
        return HardGateResult(False, tuple(reasons))

    if (
        content.next_target_min != fallback.next_target_min
        or content.next_target_max != fallback.next_target_max
    ):
        _add_reason(reasons, HardGateReason.PROTECTED_VALUE_CHANGED)
    if content.limitation != fallback.limitation:
        _add_reason(reasons, HardGateReason.LIMITATION_CHANGED)
    if _has_unsupported_numeric_claim(content, summary):
        _add_reason(reasons, HardGateReason.UNSUPPORTED_NUMERIC_CLAIM)
    joined = " ".join(_all_text(content))
    if any(pattern.search(joined) for pattern in MEDICAL_PATTERNS):
        _add_reason(reasons, HardGateReason.MEDICAL_CLAIM_DETECTED)
    if any(pattern.search(joined) for pattern in BLAMING_PATTERNS):
        _add_reason(reasons, HardGateReason.BLAMING_LANGUAGE_DETECTED)
    if _next_goal_contradicts(content, fallback, summary):
        _add_reason(reasons, HardGateReason.NEXT_GOAL_CONTRADICTION)
    return HardGateResult(not reasons, tuple(reasons), content if not reasons else None)


def evaluate_outgoing_payload(payload: object, raw_samples: object, raw_events: object) -> HardGateResult:
    try:
        serialized = repr(payload)
        has_forbidden_key = isinstance(payload, Mapping) and any(
            key in payload for key in ("samples", "events")
        )
        contains_raw = (
            (raw_samples not in (None, []) and repr(raw_samples) in serialized)
            or (raw_events not in (None, []) and repr(raw_events) in serialized)
        )
        if has_forbidden_key or contains_raw:
            return HardGateResult(False, (HardGateReason.RAW_SENSOR_PAYLOAD_DETECTED,))
        return HardGateResult(True, ())
    except Exception:
        return HardGateResult(False, (HardGateReason.EVALUATOR_ERROR,))


def validate_fallback_content(fallback: FallbackReportContent) -> None:
    values = {
        field: getattr(fallback, field)
        for field in LLMReportContent.model_fields
    }
    content = LLMReportContent.model_validate(values)
    if (
        content.next_target_min != fallback.next_target_min
        or content.next_target_max != fallback.next_target_max
        or content.limitation != fallback.limitation
    ):
        raise ValueError("fallback protected values changed")
