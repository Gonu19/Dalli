"""Deterministic synthetic runs for Dalli report evaluation.

These fixtures are not real user evidence and do not validate medical or
scientific cadence thresholds.  Running judgments always come from the
production quality and metric services.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import mean
from uuid import UUID

from pydantic import TypeAdapter

from app.models import Run
from app.schemas.runs import AppRunCreate, ManualRunCreate, RunCreate
from app.services.metrics import RunMetrics, compute_run_metrics
from app.services.run_quality import AnalysisLimitation, RunQualityAssessment, assess_run_quality


SYNTHETIC_NOTICE = "합성 평가 데이터이며 실제 사용자 기록이나 의학적 근거가 아닙니다."
BASE_STARTED_AT = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
TARGET_MIN = 153
TARGET_MAX = 161


@dataclass(frozen=True)
class SyntheticScenario:
    key: str
    run_id: UUID
    client_run_id: str
    description: str
    payload: dict[str, object]
    expected_is_analyzable: bool
    expected_analysis_limitation: AnalysisLimitation | None
    expected_event_types: tuple[str, ...]
    ai_call_allowed: bool
    basis: str
    confirmation_needed: str | None = None


@dataclass(frozen=True)
class EvaluatedSyntheticScenario:
    scenario: SyntheticScenario
    quality: RunQualityAssessment
    metrics: RunMetrics


def _samples(
    duration_sec: int,
    *,
    cadence_for_second=None,
    include_gps: bool = True,
) -> list[dict[str, float | int | None]]:
    cadence_for_second = cadence_for_second or (lambda _second: 157)
    result: list[dict[str, float | int | None]] = []
    for second in range(0, duration_sec, 5):
        cadence = int(cadence_for_second(second))
        result.append(
            {
                "t": second,
                "c": cadence,
                "p": 430 if include_gps else None,
                "d": round(second * 2.3, 1) if include_gps else None,
            }
        )
    return result


def _event(second: int, event_type: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    return {"t": second, "type": event_type, "payload": payload or {}}


def _app_payload(
    *,
    index: int,
    key: str,
    duration_sec: int = 600,
    completed: bool = True,
    condition: int = 3,
    samples: list[dict[str, object]] | None = None,
    events: list[dict[str, object]] | None = None,
    final_target: tuple[int, int] = (TARGET_MIN, TARGET_MAX),
    intervention_count: int = 0,
    downshift_count: int = 0,
    include_gps: bool = True,
) -> dict[str, object]:
    run_samples = samples if samples is not None else _samples(duration_sec, include_gps=include_gps)
    started_at = BASE_STARTED_AT + timedelta(days=index)
    cadence_values = [int(sample["c"]) for sample in run_samples]
    return {
        "client_run_id": f"dalli-synthetic-{index:02d}-{key}",
        "source": "APP",
        "plan_id": None,
        "started_at": started_at.isoformat().replace("+00:00", "Z"),
        "ended_at": (started_at + timedelta(seconds=duration_sec)).isoformat().replace("+00:00", "Z"),
        "goal_type": "TIME",
        "goal_value": duration_sec,
        "condition": condition,
        "target_cadence_min": TARGET_MIN,
        "target_cadence_max": TARGET_MAX,
        "final_target_min": final_target[0],
        "final_target_max": final_target[1],
        "duration_sec": duration_sec,
        "distance_m": round(duration_sec * 2.3) if include_gps else None,
        "avg_cadence": round(mean(cadence_values)) if cadence_values else None,
        "avg_pace_sec_per_km": 430 if include_gps else None,
        "completed": completed,
        "intervention_count": intervention_count,
        "downshift_count": downshift_count,
        "memo": SYNTHETIC_NOTICE,
        "samples": run_samples,
        "events": events
        if events is not None
        else [
            _event(0, "RUN_START", {"min": TARGET_MIN, "max": TARGET_MAX}),
            _event(duration_sec, "RUN_END", {"completed": completed}),
        ],
    }


def _manual_payload(index: int, key: str) -> dict[str, object]:
    started_at = BASE_STARTED_AT + timedelta(days=index)
    return {
        "client_run_id": f"dalli-synthetic-{index:02d}-{key}",
        "source": "MANUAL",
        "plan_id": None,
        "started_at": started_at.isoformat().replace("+00:00", "Z"),
        "duration_sec": 900,
        "distance_m": 2100,
        "condition": 3,
        "completed": True,
        "memo": SYNTHETIC_NOTICE,
    }


def _scenario_specs() -> tuple[SyntheticScenario, ...]:
    specs: list[SyntheticScenario] = []

    def add(
        key: str,
        index: int,
        description: str,
        payload: dict[str, object],
        analyzable: bool,
        limitation: AnalysisLimitation | None,
        event_types: tuple[str, ...],
        ai_allowed: bool,
        basis: str,
        confirmation_needed: str | None = None,
    ) -> None:
        specs.append(
            SyntheticScenario(
                key=key,
                run_id=UUID(f"d1500000-0000-4000-8000-{index:012d}"),
                client_run_id=str(payload["client_run_id"]),
                description=description,
                payload=payload,
                expected_is_analyzable=analyzable,
                expected_analysis_limitation=limitation,
                expected_event_types=event_types,
                ai_call_allowed=ai_allowed,
                basis=basis,
                confirmation_needed=confirmation_needed,
            )
        )

    add(
        "stable_completion",
        1,
        "목표 범위를 안정적으로 유지한 합성 완주",
        _app_payload(index=1, key="stable-completion"),
        True,
        None,
        ("RUN_START", "RUN_END"),
        True,
        "CONTRACT analyzability; ENGINE §12",
    )

    early_fast_samples = _samples(600, cadence_for_second=lambda second: 170 if 90 <= second < 180 else 157)
    add(
        "early_overspeed", 2, "초반 목표 상단을 넘고 TOO_FAST 개입이 기록된 합성 러닝",
        _app_payload(
            index=2,
            key="early-overspeed",
            samples=early_fast_samples,
            intervention_count=1,
            events=[
                _event(0, "RUN_START", {"min": TARGET_MIN, "max": TARGET_MAX}),
                _event(110, "TOO_FAST", {"cadence": 170}),
                _event(600, "RUN_END", {"completed": True}),
            ],
        ),
        True, None, ("RUN_START", "TOO_FAST", "RUN_END"), True, "ENGINE §7 and §12",
    )

    late_drop_samples = _samples(600, cadence_for_second=lambda second: 160 if second < 400 else 140)
    add(
        "late_cadence_decline",
        3,
        "LDR 계산 조건을 충족하는 후반 리듬 저하 합성 러닝",
        _app_payload(index=3, key="late-cadence-decline", samples=late_drop_samples),
        True,
        None,
        ("RUN_START", "RUN_END"),
        True,
        "ENGINE §12 LDR",
    )

    recovered_samples = _samples(600, cadence_for_second=lambda second: 145 if 180 <= second < 240 else 157)
    add(
        "deviation_then_recovery", 4, "느린 이탈 뒤 샘플이 목표 범위로 회복되는 합성 러닝",
        _app_payload(
            index=4,
            key="deviation-then-recovery",
            samples=recovered_samples,
            intervention_count=1,
            events=[
                _event(0, "RUN_START", {"min": TARGET_MIN, "max": TARGET_MAX}),
                _event(200, "TOO_SLOW", {"cadence": 145}),
                _event(600, "RUN_END", {"completed": True}),
            ],
        ),
        True, None, ("RUN_START", "TOO_SLOW", "RUN_END"), True, "ENGINE §6-7; 회복 전용 event enum은 없음",
    )

    downshift_samples = _samples(600, cadence_for_second=lambda second: 157 if second < 300 else 152)
    add(
        "target_downshift", 5, "300초부터 새 목표 범위를 적용하는 합성 러닝",
        _app_payload(
            index=5,
            key="target-downshift",
            samples=downshift_samples,
            final_target=(148, 156),
            intervention_count=2,
            downshift_count=1,
            events=[
                _event(0, "RUN_START", {"min": TARGET_MIN, "max": TARGET_MAX}),
                _event(260, "TOO_SLOW", {"cadence": 148}),
                _event(
                    300,
                    "TARGET_ADJUSTED",
                    {"min": 148, "max": 156, "reason": "no_recovery"},
                ),
                _event(600, "RUN_END", {"completed": True}),
            ],
        ),
        True, None, ("RUN_START", "TOO_SLOW", "TARGET_ADJUSTED", "RUN_END"), True, "ENGINE §8 and §12",
    )

    add(
        "incomplete_run", 6, "센서 품질은 충분하지만 completed=false인 합성 러닝",
        _app_payload(index=6, key="incomplete-run", completed=False),
        True, None, ("RUN_START", "RUN_END"), True,
        "CONTRACT Run; fallback next-target rule",
    )
    add(
        "tired_condition", 7, "condition=1인 피곤한 상태의 합성 러닝",
        _app_payload(index=7, key="tired-condition", condition=1),
        True, None, ("RUN_START", "RUN_END"), True, "ENGINE §12 FI",
    )
    add(
        "first_run_baseline_candidate", 8, "기존 이력 없이 기준 리듬 후보로 사용할 합성 첫 APP 러닝",
        _app_payload(index=8, key="first-run-baseline-candidate"),
        True, None, ("RUN_START", "RUN_END"), True, "ENGINE §2",
        "server에 기준 리듬 산출 production 함수가 없어 후보 값 자체는 검증하지 않음",
    )
    add(
        "too_short", 9, "활동 시간이 179초인 합성 APP 러닝",
        _app_payload(index=9, key="too-short", duration_sec=179),
        False, "TOO_SHORT", ("RUN_START", "RUN_END"), False,
        "CONTRACT active_duration_sec >= 180",
    )

    insufficient_samples = _samples(600)[:83]
    add(
        "insufficient_sensor_coverage", 10,
        "센서 커버리지가 70% 미만인 합성 APP 러닝",
        _app_payload(
            index=10,
            key="insufficient-sensor-coverage",
            samples=insufficient_samples,
        ),
        False, "INSUFFICIENT_SENSOR_DATA", ("RUN_START", "RUN_END"), False,
        "CONTRACT sensor coverage >= 0.70",
    )
    add(
        "missing_gps_and_pace", 11, "GPS 거리와 페이스가 없는 합성 APP 러닝",
        _app_payload(index=11, key="missing-gps-and-pace", include_gps=False),
        True, None, ("RUN_START", "RUN_END"), True,
        "CONTRACT nullable GPS; ENGINE §10",
    )
    add(
        "manual_run", 12, "AI 분석 대상이 아닌 합성 수기 러닝",
        _manual_payload(12, "manual-run"),
        False, "MANUAL_RUN", (), False, "CONTRACT and ERD §5",
    )
    return tuple(specs)


SYNTHETIC_SCENARIOS = _scenario_specs()
SYNTHETIC_SCENARIO_KEYS = tuple(scenario.key for scenario in SYNTHETIC_SCENARIOS)
_SCENARIOS_BY_KEY = {scenario.key: scenario for scenario in SYNTHETIC_SCENARIOS}


def get_synthetic_scenario(key: str) -> SyntheticScenario:
    """Return a defensive copy so callers cannot mutate the fixed evaluation set."""
    try:
        return deepcopy(_SCENARIOS_BY_KEY[key])
    except KeyError:
        raise KeyError(f"unknown synthetic scenario: {key}") from None


def parse_synthetic_run(scenario: SyntheticScenario) -> AppRunCreate | ManualRunCreate:
    return TypeAdapter(RunCreate).validate_python(deepcopy(scenario.payload))


def evaluate_synthetic_scenario(key: str) -> EvaluatedSyntheticScenario:
    scenario = get_synthetic_scenario(key)
    parsed = parse_synthetic_run(scenario)
    values = parsed.model_dump(mode="python")
    if isinstance(parsed, ManualRunCreate):
        values.update(
            goal_type=None, goal_value=None, target_cadence_min=None,
            target_cadence_max=None, final_target_min=None, final_target_max=None,
            avg_cadence=None, avg_pace_sec_per_km=None, intervention_count=None,
            downshift_count=None, samples=None, events=None,
        )
    run = Run(id=scenario.run_id, user_id=UUID("d1500000-0000-4000-8000-999999999999"), **values)
    quality = assess_run_quality(run)
    metrics = compute_run_metrics(run, quality)
    return EvaluatedSyntheticScenario(scenario=scenario, quality=quality, metrics=metrics)
