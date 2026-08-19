/**
 * 다음 루틴 제안 규칙 (`ROADMAP.md` F2 후속).
 *
 * AI 리포트가 목표를 말해주고 끝나면 사용자의 일상은 바뀌지 않는다. 그 목표를
 * **날짜가 붙은 계획**으로 옮기는 것이 이 모듈이다.
 *
 * **날짜는 LLM이 정하지 않는다.** 피로도와 주간 목표 횟수라는 두 숫자면 충분하고,
 * 규칙이면 언제나 같은 답이 나와 사용자가 예측할 수 있다.
 *
 * 순수 함수다. 시각도 만들지 않고 받은 값으로만 판단한다.
 */

import { localDateKey, shiftDays } from './plan-link';

/** 이 이상이면 하루 더 쉰다. 화면의 "부담됨" 구간과 같은 값이다. */
export const FATIGUE_HEAVY = 0.6;

/** 주간 목표 횟수를 모를 때 쓰는 기본 간격(일). 주 3회에 해당한다. */
const DEFAULT_INTERVAL_DAYS = 2;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 4;

/** 거리 제안 단위(m). 0.5km보다 잘게 제안하면 사용자가 의미를 못 읽는다. */
const DISTANCE_STEP_M = 500;
const MIN_DISTANCE_M = 1_000;

/**
 * 다음 러닝까지의 간격(일).
 *
 * 주간 목표 횟수로 기본 간격을 잡고, 이번 러닝이 부담됐으면 하루를 더 준다.
 * 이틀 이상 밀지 않는 이유는 습관이 끊기기 때문이다.
 */
export function suggestIntervalDays(
  weeklyGoalCount: number | null | undefined,
  fatigueIndex: number | null | undefined,
): number {
  const base =
    weeklyGoalCount != null && weeklyGoalCount > 0
      ? Math.round(7 / weeklyGoalCount)
      : DEFAULT_INTERVAL_DAYS;
  const rest = fatigueIndex != null && fatigueIndex >= FATIGUE_HEAVY ? 1 : 0;
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, base + rest));
}

/** 제안 날짜 `YYYY-MM-DD`. 기기 로컬 기준이라 서버의 `planned_date`와 축이 같다. */
export function suggestPlanDate(
  from: Date,
  weeklyGoalCount: number | null | undefined,
  fatigueIndex: number | null | undefined,
): string {
  return localDateKey(shiftDays(from, suggestIntervalDays(weeklyGoalCount, fatigueIndex)));
}

/**
 * 이미 계획이 있는 날은 비켜간다.
 *
 * `plans`는 (user, planned_date) 유니크라 하루에 계획이 하나뿐이다 (`CONTRACT.md`).
 * 덮어쓰면 사용자가 직접 세운 계획이 사라지므로 **미룬다.**
 */
export function nextFreeDate(dateKey: string, taken: ReadonlySet<string>, maxShift = 7): string {
  const base = new Date(`${dateKey}T00:00:00`);
  for (let shift = 0; shift <= maxShift; shift += 1) {
    const key = localDateKey(shiftDays(base, shift));
    if (!taken.has(key)) return key;
  }
  return dateKey;
}

/**
 * 목표 거리(m). 최근 러닝들의 중앙값을 0.5km 단위로 맞춘다.
 * GPS 기록이 하나도 없으면 `null` — 근거 없이 거리를 제안하지 않는다.
 */
export function suggestDistanceM(recentDistances: readonly (number | null | undefined)[]): number | null {
  const values = recentDistances
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;

  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return Math.max(MIN_DISTANCE_M, Math.round(median / DISTANCE_STEP_M) * DISTANCE_STEP_M);
}

/** 계획 제목. 사용자가 시트에서 고친 값이 있으면 그것을 쓴다. */
export function defaultPlanTitle(distanceM: number): string {
  return `${Number((distanceM / 1000).toFixed(2))}km 러닝`;
}
