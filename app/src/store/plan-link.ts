/**
 * 러닝과 캘린더 계획 연결 (`ROADMAP.md` `BE-07`, FR-023).
 *
 * 계획은 날짜만 갖는다(시각 없음). 그래서 **계획일 전후 6시간**까지를 같은 러닝으로 본다 —
 * 자정 직전에 나간 러닝이 다음 날 계획으로 넘어가거나, 새벽 러닝이 전날 계획을
 * 못 채우는 일을 막기 위해서다.
 *
 * 순수 함수다. 시각을 만들지 않고 받은 값으로만 판단한다.
 */

/** 연결 허용 폭 — 계획일 자정 기준 전후 6시간. */
export const PLAN_LINK_WINDOW_HOURS = 6;

/** 계획 후보가 갖춰야 하는 최소 모양. 캘린더 응답의 계획은 여기에 목표까지 얹어 온다. */
export type PlanLike = { id: string; status: 'PLANNED' | 'DONE' | 'SKIPPED' };

export type PlanCandidate<T extends PlanLike = PlanLike> = {
  date: string;
  plan: T | null;
};

/** `YYYY-MM-DD` (기기 로컬 기준). 서버의 `planned_date`와 같은 축을 쓴다. */
export function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * 이 러닝에 연결할 계획을 고른다. 없으면 `null`.
 *
 * - 오늘 계획은 언제나 후보
 * - 어제 계획은 **06시 이전**에 시작한 러닝까지 (자정 + 6시간)
 * - 내일 계획은 **18시 이후**에 시작한 러닝부터 (자정 − 6시간)
 * - 이미 `DONE`·`SKIPPED`인 계획은 건드리지 않는다
 *
 * 오늘 계획이 있으면 언제나 그쪽이 우선한다. 날짜당 계획이 하나뿐이므로
 * (`CONTRACT.md`) 후보가 둘 이상 겹치는 경우는 경계 시간대뿐이다.
 */
export function findPlanForRun<T extends PlanLike>(
  days: readonly PlanCandidate<T>[],
  startedAt: Date,
): T | null {
  const byDate = new Map(days.map((day) => [day.date, day.plan]));
  const openPlan = (key: string) => {
    const plan = byDate.get(key);
    return plan != null && plan.status === 'PLANNED' ? plan : null;
  };

  const today = openPlan(localDateKey(startedAt));
  if (today !== null) return today;

  const hour = startedAt.getHours();
  if (hour < PLAN_LINK_WINDOW_HOURS) {
    return openPlan(localDateKey(shiftDays(startedAt, -1)));
  }
  if (hour >= 24 - PLAN_LINK_WINDOW_HOURS) {
    return openPlan(localDateKey(shiftDays(startedAt, 1)));
  }
  return null;
}

/** 연결할 계획의 id만 필요한 곳(`runController`)을 위한 얇은 래퍼. */
export function selectPlanForRun(days: readonly PlanCandidate[], startedAt: Date): string | null {
  return findPlanForRun(days, startedAt)?.id ?? null;
}
