"""Evaluation-only runner for the six AIQ-07 baseline scenarios.

This module is deliberately separate from the FastAPI API and database path.
It performs a dry run by default; live OpenAI calls require ``--allow-live``
and an explicit artifact directory.  The artifact writer never stores prompts,
raw samples/events, API keys, or production payloads.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
from pathlib import Path
import sys
from typing import Callable

from openai import OpenAI

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings, get_settings
from app.services.fallback import build_fallback_report
from app.services.llm import generate_llm_report
from app.services.usage_harness import (
    AttemptJsonlWriter,
    AttemptRecord,
    GPT_4O_MINI_PRICING,
    PreflightSummary,
    build_attempt_record,
    build_evaluation_summary,
    build_preflight,
    enforce_preflight,
    write_evaluation_summary,
)
from tests.report_evaluation import BLIND_REVIEW_KEYS, build_blind_review_materials
from tests.synthetic_scenarios import evaluate_synthetic_scenario


DEFAULT_PROMPT_VERSION = "AIQ-07-baseline-v1"
DEFAULT_COST_CAP = Decimal("0.01")
DEFAULT_ESTIMATED_INPUT_TOKENS = 3000
DEFAULT_MAX_OUTPUT_TOKENS = 600


class _ReasonCapture(logging.Handler):
    """Capture only machine-readable LLM reason codes, never log text."""

    def __init__(self) -> None:
        super().__init__()
        self.reason_codes: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        values = getattr(record, "llm_reason_codes", None)
        if isinstance(values, (list, tuple)):
            for value in values:
                if isinstance(value, str) and value not in self.reason_codes:
                    self.reason_codes.append(value)


def _failure_exception(reason_codes: list[str]) -> Exception:
    """Turn swallowed production failure codes into safe attempt statuses."""
    if "LLM_DEADLINE_EXCEEDED" in reason_codes:
        return TimeoutError("evaluation request timed out")
    named_types = {
        "rate_limit": "RateLimitError",
        "authentication": "AuthenticationError",
        "connection": "APIConnectionError",
        "provider_status": "APIStatusError",
        "EVALUATOR_ERROR": "EvaluatorError",
    }
    for reason in reason_codes:
        type_name = named_types.get(reason)
        if type_name is not None:
            return type(type_name, (Exception,), {})()
    return type("ProviderError", (Exception,), {})()


def _report_dict(report: object) -> dict[str, object]:
    fields = (
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
    if hasattr(report, "model_dump"):
        raw = report.model_dump()  # type: ignore[attr-defined]
    else:
        raw = {field: getattr(report, field) for field in fields}
    return {field: raw.get(field) for field in fields}


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def build_aiq06_preflight(
    *,
    settings: Settings,
    live_execution_allowed: bool = False,
    cost_cap: Decimal = DEFAULT_COST_CAP,
    evaluation_run_id: str | None = None,
) -> PreflightSummary:
    """Build the fixed six-call preflight without reading or exposing the API key."""
    return build_preflight(
        requested_model=settings.openai_model,
        scenario_ids=list(BLIND_REVIEW_KEYS),
        repeat_count=1,
        max_attempts=12,
        estimated_max_input_tokens=DEFAULT_ESTIMATED_INPUT_TOKENS,
        estimated_max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
        cost_cap=cost_cap,
        pricing=(
            GPT_4O_MINI_PRICING
            if settings.openai_model == GPT_4O_MINI_PRICING.model
            else None
        ),
        live_execution_allowed=live_execution_allowed,
        evaluation_run_id=evaluation_run_id,
    )


def run_aiq06_evaluation(
    *,
    settings: Settings,
    preflight: PreflightSummary,
    output_dir: str | Path,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
    client_factory: Callable[..., object] = OpenAI,
    report_generator: Callable[..., object] = generate_llm_report,
) -> tuple[AttemptRecord, ...]:
    """Run the fixed evaluation set after preflight and write safe artifacts."""
    enforce_preflight(preflight)
    if preflight.scenario_ids != BLIND_REVIEW_KEYS or preflight.repeat_count != 1:
        raise ValueError("AIQ-06 requires the fixed six baseline scenarios exactly once")
    if not settings.llm_enabled or not settings.openai_api_key.get_secret_value():
        raise ValueError("live evaluation requires LLM_ENABLED=true and a local OPENAI_API_KEY")
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    _write_json(output_path / "preflight.json", preflight.to_dict())
    attempt_writer = AttemptJsonlWriter(output_path / "attempts.jsonl")
    records: list[AttemptRecord] = []
    reports: dict[str, dict[str, object]] = {}
    confirmed_cost = Decimal("0")
    upper_bound = Decimal("0")
    reserved_cost = (
        preflight.estimated_max_cost / preflight.attempt_count
        if preflight.estimated_max_cost is not None and preflight.attempt_count
        else None
    )

    llm_logger = logging.getLogger("app.services.llm")
    for attempt_index, scenario_key in enumerate(preflight.scenario_ids, start=1):
        evaluated = evaluate_synthetic_scenario(scenario_key)
        fallback = build_fallback_report(
            evaluated.run,
            evaluated.quality,
            evaluated.metrics,
        )
        responses: list[object] = []
        reason_capture = _ReasonCapture()
        llm_logger.addHandler(reason_capture)
        started_at = datetime.now(timezone.utc)
        content = None
        exception: Exception | None = None
        try:
            content = report_generator(
                evaluated.run,
                evaluated.quality,
                evaluated.metrics,
                fallback,
                settings,
                client_factory=client_factory,
                response_observer=responses.append,
            )
        except Exception as exc:  # pragma: no cover - defensive runner boundary
            exception = exc
        finally:
            ended_at = datetime.now(timezone.utc)
            llm_logger.removeHandler(reason_capture)

        report = content if content is not None else fallback
        reports[scenario_key] = _report_dict(report)
        record_exception = exception
        if record_exception is None and content is None and not responses:
            record_exception = _failure_exception(reason_capture.reason_codes)
        hard_gate_passed = (
            True if content is not None else False if responses else None
        )
        record = build_attempt_record(
            evaluation_run_id=preflight.evaluation_run_id,
            scenario_id=scenario_key,
            attempt_index=attempt_index,
            requested_model=preflight.requested_model,
            prompt_version=prompt_version,
            started_at=started_at,
            ended_at=ended_at,
            response=responses[-1] if responses else None,
            report=report,
            exception=record_exception,
            hard_gate_passed=hard_gate_passed,
            reason_codes=reason_capture.reason_codes,
            fallback_used=content is None,
            pricing=GPT_4O_MINI_PRICING,
            reserved_max_cost=reserved_cost,
            prior_confirmed_cost=confirmed_cost,
            prior_upper_bound=upper_bound,
            human_evaluation_target=True,
        )
        records.append(record)
        attempt_writer.append(record)
        if record.cumulative_confirmed_cost is not None:
            confirmed_cost = Decimal(record.cumulative_confirmed_cost)
        if record.cumulative_upper_bound is not None:
            upper_bound = Decimal(record.cumulative_upper_bound)

    blind_items, blind_mapping = build_blind_review_materials(
        reports,
        review_version=prompt_version,
    )
    _write_json(
        output_path / "blind_materials.json",
        [asdict(item) for item in blind_items],
    )
    _write_json(output_path / "blind_mapping.json", blind_mapping)
    write_evaluation_summary(output_path / "summary.json", preflight, records)
    return tuple(records)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-live", action="store_true")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--cost-cap", type=Decimal, default=DEFAULT_COST_CAP)
    parser.add_argument("--prompt-version", default=DEFAULT_PROMPT_VERSION)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    settings = get_settings()
    preflight = build_aiq06_preflight(
        settings=settings,
        live_execution_allowed=args.allow_live,
        cost_cap=args.cost_cap,
    )
    print(json.dumps(preflight.to_dict(), ensure_ascii=False, indent=2))
    if not preflight.approved:
        return 2
    if args.output_dir is None:
        raise SystemExit("--output-dir is required for an approved evaluation")
    if not settings.llm_enabled or not settings.openai_api_key.get_secret_value():
        raise SystemExit("live evaluation requires LLM_ENABLED=true and a local OPENAI_API_KEY")

    records = run_aiq06_evaluation(
        settings=settings,
        preflight=preflight,
        output_dir=args.output_dir,
        prompt_version=args.prompt_version,
    )
    summary = build_evaluation_summary(preflight, records)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
