/**
 * 계획 연결 검증 (`BE-07` 전후 6시간 규칙).
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/plan-link-check.ts
 */

import { selectPlanForRun } from '../../store/plan-link';
import type { PlanCandidate } from '../../store/plan-link';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

const planned = (id: string) => ({ id, status: 'PLANNED' as const });

/** 로컬 시각으로 날짜를 만든다 — 서버의 `planned_date`와 같은 축. */
const at = (day: number, hour: number) => new Date(2026, 7, day, hour, 30);

const days: PlanCandidate[] = [
  { date: '2026-08-15', plan: planned('plan-15') },
  { date: '2026-08-16', plan: planned('plan-16') },
  { date: '2026-08-17', plan: planned('plan-17') },
  { date: '2026-08-18', plan: { id: 'plan-18', status: 'DONE' } },
  { date: '2026-08-19', plan: null },
];

// 1. 오늘 계획은 언제나 우선
check('낮 러닝은 오늘 계획', selectPlanForRun(days, at(16, 14)), 'plan-16');
check('새벽 러닝도 오늘 계획이 있으면 오늘', selectPlanForRun(days, at(16, 3)), 'plan-16');

// 2. 전후 6시간 — 계획이 없는 날에만 이웃을 본다
const onlyNeighbours: PlanCandidate[] = [
  { date: '2026-08-15', plan: planned('plan-15') },
  { date: '2026-08-16', plan: null },
  { date: '2026-08-17', plan: planned('plan-17') },
];
check('06시 이전이면 어제 계획', selectPlanForRun(onlyNeighbours, at(16, 5)), 'plan-15');
check('06시를 넘기면 어제 계획은 만료', selectPlanForRun(onlyNeighbours, at(16, 7)), null);
check('18시 이후면 내일 계획', selectPlanForRun(onlyNeighbours, at(16, 19)), 'plan-17');
check('18시 이전이면 내일 계획 없음', selectPlanForRun(onlyNeighbours, at(16, 17)), null);

// 3. 이미 처리된 계획은 건드리지 않는다
check('DONE 계획은 연결하지 않는다', selectPlanForRun(days, at(18, 14)), null);
check('계획이 없는 날', selectPlanForRun(days, at(19, 14)), null);
check('응답에 없는 날짜', selectPlanForRun(days, at(25, 14)), null);
check('빈 캘린더', selectPlanForRun([], at(16, 14)), null);

console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
if (failures > 0) process.exitCode = 1;
