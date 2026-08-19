/**
 * 다음 루틴 제안 규칙 검증.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/routine-check.ts
 */

import {
  defaultPlanTitle,
  nextFreeDate,
  suggestDistanceM,
  suggestIntervalDays,
  suggestPlanDate,
} from '../../store/routine-suggestion';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

// 1. 간격 — 주간 목표 횟수가 기본, 부담되면 하루 더
check('주 3회면 2일', suggestIntervalDays(3, 0.2), 2);
check('주 5회면 1일', suggestIntervalDays(5, 0.2), 1);
check('주 2회면 4일 상한', suggestIntervalDays(2, 0.2), 4);
check('횟수를 모르면 2일', suggestIntervalDays(null, null), 2);
check('부담되면 하루 더', suggestIntervalDays(3, 0.7), 3);
check('부담돼도 4일을 넘지 않는다', suggestIntervalDays(2, 0.9), 4);
check('부담 경계값 0.6은 하루 더', suggestIntervalDays(3, 0.6), 3);
check('피로도를 모르면 쉬는 날을 늘리지 않는다', suggestIntervalDays(3, null), 2);

// 2. 날짜 — 로컬 기준 YYYY-MM-DD
check('제안 날짜', suggestPlanDate(new Date('2026-08-20T09:00:00'), 3, 0.2), '2026-08-22');
check('부담되면 하루 밀린다', suggestPlanDate(new Date('2026-08-20T09:00:00'), 3, 0.8), '2026-08-23');
check('월 경계를 넘는다', suggestPlanDate(new Date('2026-08-30T09:00:00'), 3, 0.2), '2026-09-01');

// 3. 이미 계획이 있는 날은 미룬다 — 덮어쓰지 않는다
check('빈 날짜는 그대로', nextFreeDate('2026-08-22', new Set()), '2026-08-22');
check('계획이 있으면 다음 날', nextFreeDate('2026-08-22', new Set(['2026-08-22'])), '2026-08-23');
check('연속으로 차 있으면 계속 민다', nextFreeDate('2026-08-22', new Set(['2026-08-22', '2026-08-23'])), '2026-08-24');

// 4. 거리 — 최근 러닝 중앙값을 0.5km 단위로
check('중앙값 반올림', suggestDistanceM([2900, 3100, 3300]), 3000);
check('짝수 개는 가운데 둘의 평균', suggestDistanceM([2000, 3000]), 2500);
check('1km 미만은 1km로 올린다', suggestDistanceM([300, 400]), 1000);
check('GPS 기록이 없으면 제안하지 않는다', suggestDistanceM([null, undefined]), null);
check('빈 배열도 null', suggestDistanceM([]), null);

// 5. 제목
check('기본 제목', defaultPlanTitle(3000), '3km 러닝');
check('소수 거리 제목', defaultPlanTitle(2500), '2.5km 러닝');

console.log('');
console.log(failures === 0 ? 'OK — 전 항목 통과' : `FAILED — ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
