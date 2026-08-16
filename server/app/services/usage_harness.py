"""Evaluation-only usage, cost, and attempt accounting for AI reports.

This module deliberately has no database or network client.  A caller supplies a
response (or an exception) from the existing report path and receives a safe,
JSONL-friendly record.  It is therefore suitable for fake tests and for a
future, explicitly approved live evaluation without changing the API contract.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import StrEnum
import json
from pathlib import Path
from typing import Callable, Mapping
from uuid import uuid4


REPORT_FIELDS = (
    "verdict",
    "evidence",
    "hypothesis",
    "prescription",
    "next_goal_text",
    "next_target_min",
    "next_target_max",
    "recovery_note",
    "limitation",
)
DEFAULT_MAX_OUTPUT_TOKENS = 600


class UsageHarnessError(ValueError):
    """Base class for deterministic preflight and accounting failures."""


class BudgetExceeded(UsageHarnessError):
    pass


class UnknownPricing(UsageHarnessError):
    pass


class UsageStatus(StrEnum):
    AVAILABLE = "available"
    PARTIAL = "partial"
    MISSING = "missing"
    INVALID = "invalid"


class AttemptStatus(StrEnum):
    COMPLETED = "completed"
    INCOMPLETE = "incomplete"
    TIMEOUT = "timeout"
    PROVIDER_ERROR = "provider_error"
    SCHEMA_FAILED = "schema_failed"
    VALIDATOR_FAILED = "validator_failed"
    EVALUATOR_ERROR = "evaluator_error"
    USAGE_INVALID = "usage_invalid"


class CostStatus(StrEnum):
    AVAILABLE = "available"
    UNKNOWN = "unknown"


def _field(value: object, name: str, default: object = None) -> object:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _non_negative_int(value: object, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise UsageHarnessError(f"invalid {name}")
    return value


def _decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise UsageHarnessError("invalid decimal value") from exc


def _decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


@dataclass(frozen=True)
class PricingTable:
    """Versioned price source; values are USD per one million tokens."""

    pricing_id: str
    model: str
    input_usd_per_million: Decimal
    cached_input_usd_per_million: Decimal
    output_usd_per_million: Decimal
    source_url: str
    checked_on: str
    currency: str = "USD"
    unit_tokens: int = 1_000_000

    def __post_init__(self) -> None:
        if self.unit_tokens <= 0 or any(
            price < 0
            for price in (
                self.input_usd_per_million,
                self.cached_input_usd_per_million,
                self.output_usd_per_million,
            )
        ):
            raise UsageHarnessError("pricing values must be non-negative")


# Checked against the official model page on 2026-08-16.
GPT_4O_MINI_PRICING = PricingTable(
    pricing_id="openai-gpt-4o-mini-2026-08-16",
    model="gpt-4o-mini",
    input_usd_per_million=Decimal("0.15"),
    cached_input_usd_per_million=Decimal("0.075"),
    output_usd_per_million=Decimal("0.60"),
    source_url="https://developers.openai.com/api/docs/models/gpt-4o-mini",
    checked_on="2026-08-16",
)


@dataclass(frozen=True)
class UsageRecord:
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    usage_status: UsageStatus
    diagnostics: tuple[str, ...] = ()
    computed_total_tokens: int | None = None

    @classmethod
    def from_response(cls, response: object | None) -> "UsageRecord":
        usage = _field(response, "usage") if response is not None else None
        if usage is None:
            return cls(None, None, None, None, UsageStatus.MISSING, ("usage_missing",), None)
        details = _field(usage, "input_tokens_details")
        input_tokens = _non_negative_int(_field(usage, "input_tokens"), "input_tokens")
        cached_tokens = _non_negative_int(
            _field(details, "cached_tokens"), "cached_tokens"
        )
        output_tokens = _non_negative_int(_field(usage, "output_tokens"), "output_tokens")
        total_tokens = _non_negative_int(_field(usage, "total_tokens"), "total_tokens")
        values = (input_tokens, cached_tokens, output_tokens, total_tokens)
        diagnostics: list[str] = []
        if cached_tokens is not None and input_tokens is not None and cached_tokens > input_tokens:
            diagnostics.append("cached_tokens_exceed_input_tokens")
        if input_tokens is not None and output_tokens is not None and total_tokens is not None:
            if input_tokens + output_tokens != total_tokens:
                diagnostics.append("total_tokens_mismatch")
        if diagnostics:
            computed = input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None
            return cls(input_tokens, cached_tokens, output_tokens, total_tokens, UsageStatus.INVALID, tuple(diagnostics), computed)
        present = sum(value is not None for value in values)
        status = UsageStatus.AVAILABLE if present == 4 else UsageStatus.PARTIAL
        if present == 0:
            status = UsageStatus.MISSING
        computed = input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None
        return cls(input_tokens, cached_tokens, output_tokens, total_tokens, status, tuple(diagnostics), computed)


@dataclass(frozen=True)
class CostBreakdown:
    uncached_input_cost: Decimal | None
    cached_input_cost: Decimal | None
    output_cost: Decimal | None
    total_cost: Decimal | None
    cost_status: CostStatus
    reason: str | None = None


def calculate_cost(usage: UsageRecord, pricing: PricingTable | None) -> CostBreakdown:
    if pricing is None:
        return CostBreakdown(None, None, None, None, CostStatus.UNKNOWN, "pricing_missing")
    if usage.usage_status != "available":
        return CostBreakdown(None, None, None, None, CostStatus.UNKNOWN, f"usage_{usage.usage_status}")
    assert usage.input_tokens is not None
    assert usage.cached_input_tokens is not None
    assert usage.output_tokens is not None
    uncached = usage.input_tokens - usage.cached_input_tokens
    if uncached < 0:
        return CostBreakdown(None, None, None, None, CostStatus.UNKNOWN, "cached_tokens_exceed_input_tokens")
    unit = Decimal(pricing.unit_tokens)
    uncached_cost = Decimal(uncached) * pricing.input_usd_per_million / unit
    cached_cost = Decimal(usage.cached_input_tokens) * pricing.cached_input_usd_per_million / unit
    output_cost = Decimal(usage.output_tokens) * pricing.output_usd_per_million / unit
    return CostBreakdown(
        uncached_cost,
        cached_cost,
        output_cost,
        uncached_cost + cached_cost + output_cost,
        CostStatus.AVAILABLE,
    )


def _response_id(response: object | None) -> str | None:
    for name in ("id", "_request_id", "request_id"):
        value = _field(response, name)
        if isinstance(value, str) and value:
            return value
    return None


def _response_status(response: object | None) -> str | None:
    value = _field(response, "status")
    return value if isinstance(value, str) else None


def _actual_model(response: object | None, requested_model: str) -> str | None:
    value = _field(response, "model")
    return value if isinstance(value, str) and value else None


def _request_id(response: object | None) -> str | None:
    for name in ("_request_id", "request_id"):
        value = _field(response, name)
        if isinstance(value, str) and value:
            return value
    return None


def _truncation(response: object | None) -> tuple[bool | None, str]:
    status = _response_status(response)
    if status != "incomplete":
        return None, "unknown"
    details = _field(response, "incomplete_details")
    reason = _field(details, "reason")
    if isinstance(reason, str) and reason in {"max_output_tokens", "token_limit"}:
        return True, "known"
    return None, "unknown"


def _report_dict(report: object | None) -> dict[str, object] | None:
    if report is None:
        return None
    if hasattr(report, "model_dump"):
        raw = report.model_dump()  # type: ignore[attr-defined]
    elif isinstance(report, Mapping):
        raw = dict(report)
    else:
        raw = {name: _field(report, name) for name in REPORT_FIELDS}
    return {name: raw.get(name) for name in REPORT_FIELDS}


def _safe_exception(exc: Exception | None) -> tuple[str | None, str | None]:
    if exc is None:
        return None, None
    name = type(exc).__name__
    if isinstance(exc, TimeoutError) or name in {"APITimeoutError", "FutureTimeoutError"}:
        return "timeout", "request_timeout"
    if name == "RateLimitError":
        return "provider_error", "rate_limit"
    if name in {"AuthenticationError", "APIConnectionError", "APIStatusError"}:
        return "provider_error", name
    if name in {"ValidationError", "JSONDecodeError", "SchemaError"}:
        return "schema_failed", "schema_invalid"
    if name in {"HardGateViolation", "ValidatorError"}:
        return "validator_failed", "validator_failed"
    if name in {"EvaluatorError", "UsageHarnessError"}:
        return "evaluator_error", name
    return "provider_error", name


@dataclass
class AttemptRecord:
    schema_version: str
    evaluation_run_id: str
    scenario_id: str
    attempt_id: str
    attempt_index: int
    requested_model: str
    actual_model: str | None
    prompt_version: str
    started_at: str
    ended_at: str
    elapsed_ms: int
    response_status: str | None
    response_completed: bool | None
    truncation: bool | None
    truncation_status: str
    attempt_status: AttemptStatus
    failure_stage: str | None
    reason_codes: list[str]
    structured_report: dict[str, object] | None
    fallback_used: bool
    hard_gate_passed: bool | None
    usage: UsageRecord
    cost: CostBreakdown
    pricing_id: str | None
    response_id: str | None
    request_id: str | None
    input_usd_per_million: str | None
    cached_input_usd_per_million: str | None
    output_usd_per_million: str | None
    attempt_cost: str | None
    reserved_max_cost: str | None
    cumulative_confirmed_cost: str | None
    cumulative_upper_bound: str | None
    human_evaluation_target: bool
    evaluator_error: str | None = None

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["usage"] = asdict(self.usage)
        data["cost"] = {
            key: (_decimal_text(value) if isinstance(value, Decimal) else value)
            for key, value in asdict(self.cost).items()
        }
        return data


def build_attempt_record(
    *,
    evaluation_run_id: str,
    scenario_id: str,
    attempt_index: int,
    requested_model: str,
    prompt_version: str,
    started_at: datetime,
    ended_at: datetime,
    response: object | None = None,
    report: object | None = None,
    exception: Exception | None = None,
    hard_gate_passed: bool | None = None,
    reason_codes: list[str] | tuple[str, ...] = (),
    fallback_used: bool = False,
    pricing: PricingTable | None = None,
    failure_stage: str | None = None,
    reserved_max_cost: Decimal | None = None,
    prior_confirmed_cost: Decimal = Decimal("0"),
    prior_upper_bound: Decimal = Decimal("0"),
    human_evaluation_target: bool = True,
) -> AttemptRecord:
    usage = UsageRecord.from_response(response)
    cost = calculate_cost(usage, pricing)
    response_status = _response_status(response)
    exc_status, exc_reason = _safe_exception(exception)
    reasons = list(reason_codes)
    if exc_reason and exc_reason not in reasons:
        reasons.append(exc_reason)
    if usage.diagnostics:
        reasons.extend(code for code in usage.diagnostics if code not in reasons)
    if exception is not None:
        status = AttemptStatus(exc_status or AttemptStatus.PROVIDER_ERROR)
    elif hard_gate_passed is False:
        status = AttemptStatus.VALIDATOR_FAILED
    elif response is None and report is None:
        status = AttemptStatus.INCOMPLETE
    elif response_status == "incomplete":
        status = AttemptStatus.INCOMPLETE
    elif usage.usage_status == "invalid":
        status = AttemptStatus.USAGE_INVALID
    else:
        status = AttemptStatus.COMPLETED
    actual_model = _actual_model(response, requested_model)
    model_pricing_matches = pricing is not None and (response is None or actual_model == pricing.model)
    if pricing is not None and not model_pricing_matches:
        reason = "actual_model_missing" if actual_model is None else "actual_model_pricing_unknown"
        cost = CostBreakdown(None, None, None, None, CostStatus.UNKNOWN, reason)
        reasons.append(reason)
    applied_pricing = pricing if model_pricing_matches else None
    confirmed = prior_confirmed_cost
    upper_bound = prior_upper_bound
    if cost.total_cost is not None:
        confirmed += cost.total_cost
        upper_bound += cost.total_cost
    elif reserved_max_cost is not None:
        upper_bound += reserved_max_cost
    completed = response_status == "completed" if response_status is not None else None
    truncation, truncation_status = _truncation(response)
    elapsed_ms = max(0, int((ended_at - started_at).total_seconds() * 1000))
    return AttemptRecord(
        schema_version="dalli-ai-usage-attempt.v1",
        evaluation_run_id=evaluation_run_id,
        scenario_id=scenario_id,
        attempt_id=str(uuid4()),
        attempt_index=attempt_index,
        requested_model=requested_model,
        actual_model=actual_model,
        prompt_version=prompt_version,
        started_at=started_at.astimezone(timezone.utc).isoformat(),
        ended_at=ended_at.astimezone(timezone.utc).isoformat(),
        elapsed_ms=elapsed_ms,
        response_status=response_status,
        response_completed=completed,
        truncation=truncation,
        truncation_status=truncation_status,
        attempt_status=status,
        failure_stage=failure_stage,
        reason_codes=reasons,
        structured_report=_report_dict(report),
        fallback_used=fallback_used,
        hard_gate_passed=hard_gate_passed,
        usage=usage,
        cost=cost,
        pricing_id=pricing.pricing_id if applied_pricing else None,
        response_id=_response_id(response),
        request_id=_request_id(response),
        input_usd_per_million=_decimal_text(pricing.input_usd_per_million) if applied_pricing else None,
        cached_input_usd_per_million=(
            _decimal_text(pricing.cached_input_usd_per_million) if applied_pricing else None
        ),
        output_usd_per_million=_decimal_text(pricing.output_usd_per_million) if applied_pricing else None,
        attempt_cost=_decimal_text(cost.total_cost),
        reserved_max_cost=_decimal_text(reserved_max_cost),
        cumulative_confirmed_cost=_decimal_text(confirmed),
        cumulative_upper_bound=_decimal_text(upper_bound),
        human_evaluation_target=human_evaluation_target,
        evaluator_error=None,
    )


@dataclass(frozen=True)
class PreflightSummary:
    evaluation_run_id: str
    requested_model: str
    scenario_ids: tuple[str, ...]
    repeat_count: int
    max_attempts: int
    max_scenarios: int
    max_attempts_per_scenario: int
    estimated_max_input_tokens: int
    estimated_max_output_tokens: int
    estimated_max_cost: Decimal | None
    cost_cap: Decimal
    pricing_id: str | None
    live_execution_allowed: bool
    approved: bool
    block_reasons: tuple[str, ...] = ()

    @property
    def attempt_count(self) -> int:
        return len(self.scenario_ids) * self.repeat_count

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["estimated_max_cost"] = _decimal_text(self.estimated_max_cost)
        data["cost_cap"] = _decimal_text(self.cost_cap)
        data["scenario_ids"] = list(self.scenario_ids)
        data["block_reasons"] = list(self.block_reasons)
        data["attempt_count"] = self.attempt_count
        data["actual_call"] = self.live_execution_allowed
        data["worst_case_cache_free_cost"] = data["estimated_max_cost"]
        return data


def build_preflight(
    *,
    requested_model: str,
    scenario_ids: list[str] | tuple[str, ...],
    repeat_count: int,
    max_attempts: int,
    estimated_max_input_tokens: int,
    estimated_max_output_tokens: int,
    cost_cap: Decimal,
    pricing: PricingTable | None,
    live_execution_allowed: bool = False,
    evaluation_run_id: str | None = None,
    max_scenarios: int = 12,
    max_attempts_per_scenario: int = 2,
) -> PreflightSummary:
    if repeat_count <= 0 or max_attempts <= 0 or max_scenarios <= 0 or max_attempts_per_scenario <= 0:
        raise UsageHarnessError("repeat_count and max_attempts must be positive")
    if estimated_max_input_tokens < 0 or estimated_max_output_tokens < 0:
        raise UsageHarnessError("token estimates must be non-negative")
    count = len(scenario_ids) * repeat_count
    reasons: list[str] = []
    if count > max_attempts:
        reasons.append("max_attempts_exceeded")
    if len(scenario_ids) > max_scenarios:
        reasons.append("max_scenarios_exceeded")
    if repeat_count > max_attempts_per_scenario:
        reasons.append("max_attempts_per_scenario_exceeded")
    estimated_cost: Decimal | None = None
    if pricing is None:
        reasons.append("pricing_unknown")
    else:
        unit = Decimal(pricing.unit_tokens)
        estimated_cost = Decimal(count) * (
            Decimal(estimated_max_input_tokens) * pricing.input_usd_per_million / unit
            + Decimal(estimated_max_output_tokens) * pricing.output_usd_per_million / unit
        )
        if estimated_cost > cost_cap:
            reasons.append("cost_cap_exceeded")
    if not live_execution_allowed:
        reasons.append("live_execution_not_approved")
    return PreflightSummary(
        evaluation_run_id=evaluation_run_id or str(uuid4()),
        requested_model=requested_model,
        scenario_ids=tuple(scenario_ids),
        repeat_count=repeat_count,
        max_attempts=max_attempts,
        max_scenarios=max_scenarios,
        max_attempts_per_scenario=max_attempts_per_scenario,
        estimated_max_input_tokens=estimated_max_input_tokens,
        estimated_max_output_tokens=estimated_max_output_tokens,
        estimated_max_cost=estimated_cost,
        cost_cap=cost_cap,
        pricing_id=pricing.pricing_id if pricing else None,
        live_execution_allowed=live_execution_allowed,
        approved=not reasons,
        block_reasons=tuple(reasons),
    )


def enforce_preflight(preflight: PreflightSummary) -> None:
    if not preflight.approved:
        raise BudgetExceeded(",".join(preflight.block_reasons))


def run_guarded_call(preflight: PreflightSummary, call: Callable[[], object]) -> object:
    """Invoke an injected client call only after the dry-run gate passes."""
    enforce_preflight(preflight)
    return call()


class AttemptJsonlWriter:
    """Append only safe attempt records; raw prompts and samples are excluded."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def append(self, record: AttemptRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.to_dict(), ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def build_evaluation_summary(
    preflight: PreflightSummary, records: list[AttemptRecord] | tuple[AttemptRecord, ...]
) -> dict[str, object]:
    """Return a separate, safe run summary; it contains no report/prompt payload."""
    confirmed = sum(
        (record.cost.total_cost for record in records if record.cost.total_cost is not None),
        Decimal("0"),
    )
    upper_bounds = [
        _decimal(record.cumulative_upper_bound)
        for record in records
        if record.cumulative_upper_bound is not None
    ]
    return {
        "schema_version": "dalli-ai-usage-summary.v1",
        "evaluation_run_id": preflight.evaluation_run_id,
        "preflight": preflight.to_dict(),
        "attempt_count": len(records),
        "usage_unknown_attempt_count": sum(
            record.cost.total_cost is None for record in records
        ),
        "confirmed_cost": _decimal_text(confirmed),
        "cumulative_upper_bound": _decimal_text(max(upper_bounds, default=confirmed)),
        "status_counts": {
            status: sum(record.attempt_status == status for record in records)
            for status in sorted({record.attempt_status for record in records})
        },
    }


def write_evaluation_summary(
    path: str | Path,
    preflight: PreflightSummary,
    records: list[AttemptRecord] | tuple[AttemptRecord, ...],
) -> None:
    """Write only the aggregate run summary, separate from append-only attempts."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(build_evaluation_summary(preflight, records), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
