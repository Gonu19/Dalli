/**
 * 목표 범위 계산 (`ENGINE.md` §3)과 실측 baseline 산출 (`ENGINE.md` §2).
 *
 * 목표 중심값의 원천은 러닝 회차에 따라 다르다.
 * - 1회차: 온보딩에서 정한 **초기 목표값**
 * - 2회차부터: 직전 러닝들에서 확정된 **실측 baseline**
 *
 * 엔진 입장에서는 둘 다 "기준이 되는 spm 하나"이므로 `referenceCadence`로 받는다.
 */

import {
  BASELINE_MIN_DURATION_SEC,
  BASELINE_MIN_SAMPLES,
  BASELINE_WINDOW_END_SEC,
  BASELINE_WINDOW_START_SEC,
  CADENCE_CLAMP_MAX,
  CADENCE_CLAMP_MIN,
  CONDITION_ADJUST,
  EXPERIENCE_BASE_CADENCE,
  INITIAL_TARGET_ADJUST_RANGE,
  IDLE_CADENCE_THRESHOLD,
  PURPOSE_ADJUST,
  TARGET_HALF_WIDTH,
} from './constants';
import { clamp, median } from './math';
import type {
  CadenceSample,
  ConditionValue,
  ExperienceLevel,
  RunningPurpose,
  TargetRange,
} from './types';

/**
 * 온보딩에서 첫 러닝의 목표 중심값을 규칙으로 정한다 (`ENGINE.md` §2).
 * 신체 정보는 쓰지 않는다 — 경험 수준과 목적 둘뿐이다.
 *
 * 결과는 150~168이라 클램프가 실제로 걸리진 않지만 방어로 남긴다.
 * 사용자는 이 값을 온보딩에서 ±5까지 손으로 조절할 수 있다.
 *
 * **baseline이 확정되면 이 함수는 그 사용자에게 다시 호출되지 않는다.**
 */
export function computeInitialTargetCadence(
  experienceLevel: ExperienceLevel,
  purpose: RunningPurpose,
): number {
  return clamp(
    EXPERIENCE_BASE_CADENCE[experienceLevel] + PURPOSE_ADJUST[purpose],
    CADENCE_CLAMP_MIN,
    CADENCE_CLAMP_MAX,
  );
}

/**
 * `center = clamp(referenceCadence + conditionAdjust, 130, 185)` 후 ±4.
 * 클램프는 center에만 건다 — min/max 각각에 걸면 범위 폭이 찌그러진다.
 */
export function computeTargetRange(
  referenceCadence: number,
  condition: ConditionValue,
): TargetRange {
  const center = clamp(
    Math.round(referenceCadence + CONDITION_ADJUST[condition]),
    CADENCE_CLAMP_MIN,
    CADENCE_CLAMP_MAX,
  );

  return { center, min: center - TARGET_HALF_WIDTH, max: center + TARGET_HALF_WIDTH };
}

/**
 * 온보딩 조절 화면에서 사용자가 만진 값을 허용 범위로 자른다 (`ENGINE.md` §2).
 *
 * 추천값 ±10 안에서만 움직이고, 그 위에 절대 클램프 130~185가 우선한다.
 * 130 미만을 허용하면 걷기 구간(50~120)과 겹쳐 **걷는 것이 목표 달성이 된다.**
 */
export function clampAdjustedTarget(value: number, recommended: number): number {
  const lower = Math.max(recommended - INITIAL_TARGET_ADJUST_RANGE, CADENCE_CLAMP_MIN);
  const upper = Math.min(recommended + INITIAL_TARGET_ADJUST_RANGE, CADENCE_CLAMP_MAX);
  return clamp(Math.round(value), lower, upper);
}

/** DB·API가 원본으로 갖는 min/max에서 표시용 중심값을 복원한다 (±4 대칭이라 항상 정수). */
export function targetCenter(min: number, max: number): number {
  return (min + max) / 2;
}

/**
 * 러닝 **종료 후** 실측 baseline 산출.
 *
 * 구간 t = 90~270초(워밍업 직후 3분), 정지(< 50 spm) 샘플 제외, 중앙값.
 * 유효 샘플 30개 미만이거나 duration < 360초면 확정하지 않는다 (`null`).
 *
 * 러닝 중에는 호출하지 않는다. 확정값은 다음 러닝부터 적용된다.
 */
export function computeMeasuredBaseline(
  samples: readonly CadenceSample[],
  durationSec: number,
): number | null {
  if (durationSec < BASELINE_MIN_DURATION_SEC) return null;

  const valid = samples.filter(
    (sample) =>
      sample.elapsedSec >= BASELINE_WINDOW_START_SEC &&
      sample.elapsedSec <= BASELINE_WINDOW_END_SEC &&
      sample.cadence >= IDLE_CADENCE_THRESHOLD,
  );
  if (valid.length < BASELINE_MIN_SAMPLES) return null;

  const value = median(valid.map((sample) => sample.cadence));
  return value === null ? null : Math.round(value);
}
