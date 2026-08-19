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
    ROUTINE_EVIDENCE_NOT_ALLOWED = "ROUTINE_EVIDENCE_NOT_ALLOWED"
    ROUTINE_INTERVAL_UNAVAILABLE = "ROUTINE_INTERVAL_UNAVAILABLE"
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
        r"(?:염|증|병)(?:으로|로)?\s*진단(?:됩니다|됐습니다|되었|했)",
        r"진단(?:됩니다|됐습니다|되었|했)(?:\.|$)",
        r"치료(?:를|가)?\s*(?:받아야|받으세요|필요|해야|하세요)",
        r"(?:약물|진통제|소염제)(?:을|를)?\s*(?:복용|드세요)",
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
        r"고작\s+.+밖에\s+못",
        r"한심",
        r"핑계(?:입니다|예요|다)",
        r"정신력(?:이|은) 약",
    )
)
NUMBER_PATTERN = re.compile(
    r"(?<![\w])(?P<number>[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)"
    r"\s*(?P<unit>spm|km|m|%|초|분|일|회)?",
    re.IGNORECASE,
)
APPROXIMATE_NUMBER_PATTERN = re.compile(r"약|대략|거의|정도|가량|쯤|내외")
DURATION_SUMMARY_KEYS = ("duration_sec", "active_duration_sec", "in_range_sec")
RHYTHM_TARGET_PATTERN = re.compile(r"리듬\s*([-+]?\d+(?:\.\d+)?)")
RHYTHM_RANGE_PATTERN = re.compile(
    r"리듬\s*([-+]?\d+(?:\.\d+)?)\s*(?:~|-|–)\s*([-+]?\d+(?:\.\d+)?)"
)
ROUTINE_EVIDENCE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"(?:이번\s*주|주간).{0,30}\d+\s*(?:회|일|개)?",
        r"\d+\s*회\s*중\s*\d+\s*회",
        r"(?:계획|플랜).{0,30}\d+\s*(?:개|회|일)?",
        r"(?:간격|직전\s*러닝|마지막\s*러닝|쉬고).{0,30}\d+\s*일",
    )
)
HABIT_INTERVAL_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"러닝.{0,20}간격",
        r"간격.{0,20}(?:러닝|달리기|운동)",
        r"(?:하루|이틀|사흘|며칠)\s*(?:안에|후|간격|쉬고)",
        r"\d+\s*일\s*(?:안에|후|간격|쉬고)",
    )
)


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
    for field in ("detail_time_blocks", "detail_rapid_changes", "segment_summary"):
        values = summary.get(field)
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, Mapping):
                continue
            for key, value in item.items():
                if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
                    continue
                allowed.add(_canonical_number(value))
                if str(key).endswith("_delta"):
                    allowed.add(_canonical_number(abs(float(value))))
                if str(key).endswith("_sec") and float(value) % 60 == 0:
                    allowed.add(_canonical_number(float(value) / 60))
    return allowed


def _numeric_unit_allowlist(summary: Mapping[str, object]) -> dict[str, set[str]]:
    allowed: dict[str, set[str]] = {
        "%": set(),
        "초": set(),
        "분": set(),
        "일": set(),
        "m": set(),
        "km": set(),
        "spm": set(),
        "회": set(),
    }

    def add(unit: str, value: object) -> None:
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            return
        allowed[unit].add(_canonical_number(value))

    for key in ("rhythm_score", "late_drop_rate", "fatigue_index"):
        value = summary.get(key)
        if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
            add("%", round(float(value) * 100))
    for key in ("duration_sec", "active_duration_sec", "in_range_sec", "avg_pace_sec_per_km"):
        value = summary.get(key)
        if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
            add("초", round(float(value)))
    for key in ("duration_sec", "active_duration_sec"):
        value = summary.get(key)
        if isinstance(value, (int, float, Decimal)) and float(value) % 60 == 0:
            add("분", float(value) / 60)

    goal_value = summary.get("goal_value")
    if summary.get("goal_type") == "TIME":
        add("초", goal_value)
        if isinstance(goal_value, (int, float, Decimal)) and float(goal_value) % 60 == 0:
            add("분", float(goal_value) / 60)
    elif summary.get("goal_type") == "DISTANCE":
        add("m", goal_value)
        if isinstance(goal_value, (int, float, Decimal)) and float(goal_value) % 1000 == 0:
            add("km", float(goal_value) / 1000)

    distance = summary.get("distance_m")
    add("m", distance)
    if isinstance(distance, (int, float, Decimal)) and float(distance) % 1000 == 0:
        add("km", float(distance) / 1000)
    for key in (
        "avg_cadence", "next_target_min", "next_target_max",
        "current_target_min", "current_target_max",
    ):
        add("spm", summary.get(key))
    next_min = summary.get("next_target_min")
    next_max = summary.get("next_target_max")
    if isinstance(next_min, int) and isinstance(next_max, int):
        add("spm", round((next_min + next_max) / 2))
    for key in (
        "intervention_count",
        "downshift_count",
        "weekly_goal_count",
        "this_week_run_count",
        "this_week_plan_done",
        "this_week_plan_total",
    ):
        add("회", summary.get(key))
    add("일", summary.get("days_since_last_run"))
    for field in ("detail_time_blocks", "detail_rapid_changes", "segment_summary"):
        values = summary.get(field)
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, Mapping):
                continue
            for key, value in item.items():
                if str(key).endswith("_sec"):
                    add("초", value)
                    if isinstance(value, (int, float, Decimal)) and float(value) % 60 == 0:
                        add("분", float(value) / 60)
                elif "cadence" in str(key):
                    add("spm", value)
                    if str(key).endswith("_delta"):
                        add("spm", abs(float(value)))
    return allowed


def _duration_components(summary: Mapping[str, object]) -> tuple[tuple[int, int], ...]:
    components: set[tuple[int, int]] = set()
    for key in DURATION_SUMMARY_KEYS:
        value = summary.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            continue
        total_seconds = round(float(value))
        if total_seconds < 0:
            continue
        components.add(divmod(total_seconds, 60))
    return tuple(components)


def _approximate_duration_minutes(summary: Mapping[str, object]) -> set[str]:
    """Return grounded floor/nearest-minute values for approximate duration text."""
    allowed: set[str] = set()
    for key in DURATION_SUMMARY_KEYS:
        value = summary.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            continue
        total_seconds = round(float(value))
        if total_seconds < 60:
            continue
        minutes = total_seconds // 60
        allowed.add(_canonical_number(minutes))
        allowed.add(_canonical_number(round(total_seconds / 60)))
    return allowed


def _has_exact_duration_component(
    text: str,
    number: str,
    unit: str,
    components: tuple[tuple[int, int], ...],
) -> bool:
    """Allow grounded `N분 M초` output when the source duration is not minute-aligned."""
    if unit == "분":
        return any(
            number == str(minutes)
            and seconds > 0
            and re.search(rf"(?<!\d){seconds}\s*초", text) is not None
            for minutes, seconds in components
        )
    if unit == "초":
        return any(
            number == str(seconds)
            and seconds > 0
            and re.search(rf"(?<!\d){minutes}\s*분", text) is not None
            for minutes, seconds in components
        )
    return False


def _has_nearby_approximation_marker(text: str, match: re.Match[str]) -> bool:
    window_start = max(0, match.start() - 6)
    window_end = min(len(text), match.end() + 8)
    return APPROXIMATE_NUMBER_PATTERN.search(text[window_start:window_end]) is not None


def _has_unsupported_numeric_claim(
    content: LLMReportContent,
    summary: Mapping[str, object],
) -> bool:
    allowed = _numeric_allowlist(summary)
    allowed_by_unit = _numeric_unit_allowlist(summary)
    duration_components = _duration_components(summary)
    approximate_duration_minutes = _approximate_duration_minutes(summary)
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
                number = _canonical_number(Decimal(match.group("number").replace(",", "")))
                unit = match.group("unit")
                # CONTRACT's prescription example explicitly permits "시작 5분".
                if (
                    field_name == "prescription"
                    and number == "5"
                    and unit == "분"
                    and "시작" in text
                ):
                    continue
                if unit is not None:
                    normalized_unit = unit.lower()
                    if number in allowed_by_unit[normalized_unit]:
                        continue
                    if (
                        normalized_unit == "분"
                        and number in approximate_duration_minutes
                        and _has_nearby_approximation_marker(text, match)
                    ):
                        continue
                    if _has_exact_duration_component(
                        text,
                        number,
                        normalized_unit,
                        duration_components,
                    ):
                        continue
                    return True
                if unit is None and number not in allowed:
                    return True
    return False


def _has_forbidden_routine_evidence(
    content: LLMReportContent,
    summary: Mapping[str, object],
) -> bool:
    if summary.get("running_purpose") == "HABIT":
        return False
    return any(
        pattern.search(evidence) is not None
        for evidence in content.evidence
        for pattern in ROUTINE_EVIDENCE_PATTERNS
    )


def _has_unavailable_habit_interval(
    content: LLMReportContent,
    summary: Mapping[str, object],
) -> bool:
    if summary.get("running_purpose") != "HABIT":
        return False
    if summary.get("days_since_last_run") is not None:
        return False
    return any(
        pattern.search(text) is not None
        for text in _all_text(content)
        for pattern in HABIT_INTERVAL_PATTERNS
    )


def _next_goal_contradicts(
    content: LLMReportContent,
    fallback: FallbackReportContent,
    summary: Mapping[str, object],
) -> bool:
    center = round((fallback.next_target_min + fallback.next_target_max) / 2)
    range_match = RHYTHM_RANGE_PATTERN.search(content.next_goal_text)
    if range_match is not None:
        mentioned_range = tuple(Decimal(value) for value in range_match.groups())
        protected_range = (
            Decimal(fallback.next_target_min),
            Decimal(fallback.next_target_max),
        )
        if mentioned_range != protected_range:
            return True
    else:
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
    says_down = any(word in text for word in ("낮추", "줄이")) or bool(
        re.search(r"리듬(?:을|은)?\s*(?:더\s*)?느리게", text)
    )
    says_up = any(word in text for word in ("높이", "올리", "늘리")) or bool(
        re.search(r"리듬(?:을|은)?\s*(?:더\s*)?빠르게", text)
    )
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
    if _has_forbidden_routine_evidence(content, summary):
        _add_reason(reasons, HardGateReason.ROUTINE_EVIDENCE_NOT_ALLOWED)
    if _has_unavailable_habit_interval(content, summary):
        _add_reason(reasons, HardGateReason.ROUTINE_INTERVAL_UNAVAILABLE)
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
