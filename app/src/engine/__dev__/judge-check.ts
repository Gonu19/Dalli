/**
 * `F1-05` 판정 검증 — `ReplaySource`로 시나리오를 관통시킨다.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/judge-check.ts
 *
 * 실기기도 맥도 서버도 없이 `ENGINE.md` §5~§9 타임라인 전체를 확인한다.
 */

import { SAMPLE_INTERVAL_SEC } from '../constants';
import { cueForEvent } from '../cues';
import { createJudgeState, judge } from '../judge';
import type { JudgeState } from '../judge';
import { ReplaySource } from '../sources/replay-source';
import { computeTargetRange } from '../target';
import type { CadenceSample, RunEvent } from '../types';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

type Driven = { state: JudgeState; events: RunEvent[] };

/** 케이던스 함수를 5초 tick 배열로 만들어 `ReplaySource`로 판정에 흘려보낸다. */
function drive(
  durationSec: number,
  spmAt: (t: number) => number,
  options: { center?: number; goalProgress?: number } = {},
): Driven {
  const samples: CadenceSample[] = [];
  for (let t = 0; t <= durationSec; t += SAMPLE_INTERVAL_SEC) {
    samples.push({ elapsedSec: t, cadence: spmAt(t) });
  }

  let state = createJudgeState(computeTargetRange(options.center ?? 157, 3));
  const events: RunEvent[] = [];

  new ReplaySource(samples, { speed: Infinity }).start((sample) => {
    const result = judge(state, {
      elapsedSec: sample.elapsedSec,
      cadence: sample.cadence,
      goalProgress: options.goalProgress,
    });
    state = result.state;
    events.push(...result.events);
  });

  return { state, events };
}

const types = (events: RunEvent[]) => events.map((event) => event.type);
const at = (events: RunEvent[], type: RunEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.t);

// 1. 워밍업 90초 — 아무리 벗어나도 무개입 (§5)
check('워밍업 구간 무개입', types(drive(85, () => 200).events), []);
check('워밍업 중 verdict는 IN_RANGE', drive(85, () => 200).state.verdict, 'IN_RANGE');

// 2. TOO_FAST — 90초 이후 발동, 세션 2회 상한 후 침묵 (§7)
const fast = drive(900, () => 175); // 중심 +18 = 급격 이탈 → 10초 기준
check('급격 과속은 90초 직후 10초 만에 개입', at(fast.events, 'TOO_FAST')[0], 100);
check('TOO_FAST 세션 2회 상한', at(fast.events, 'TOO_FAST').length, 2);
check('과속은 하향으로 이어지지 않는다', fast.state.downshiftCount, 0);
check('과속만으로는 리커버리도 없다', fast.state.recovery, false);

// 목표 90% 이후에는 막판 스퍼트를 막지 않는다 (§10)
check('진행률 90% 이후 TOO_FAST 침묵', types(drive(900, () => 175, { goalProgress: 0.95 }).events), []);

// 3. TOO_SLOW — 5분 이전 침묵 (§5)
const slowGate = drive(600, () => 150); // 중심 −7 = 일반 이탈
check('TOO_SLOW 첫 개입은 300초', at(slowGate.events, 'TOO_SLOW')[0], 300);

// 4. Downshift — 일반 이탈 실패 2회 (§8). DEMO.md의 157 → 152가 그대로 나온다.
check('실패 2회 후 하향', at(slowGate.events, 'TARGET_ADJUSTED'), [440]);
check('하향 후 중심값', slowGate.state.target, { center: 152, min: 148, max: 156 });
check('하향 1회 기록', slowGate.state.downshiftCount, 1);

// 5. 급격 이탈은 실패 1회로 하향 (§8)
const severe = drive(600, () => 140); // 중심 −17
check(
  '급격 저속은 실패 1회로 하향',
  severe.events.find((event) => event.type === 'TARGET_ADJUSTED'),
  { t: 360, type: 'TARGET_ADJUSTED', payload: { min: 148, max: 156, reason: 'severe' } },
);

// 6. 걷기 60초 → 즉시 하향, 러닝 샘플이 없으므로 고정 −5 (§8)
const walking = drive(600, (t) => (t < 300 ? 157 : 110));
check(
  '걷기 60초 하향',
  walking.events.find((event) => event.type === 'TARGET_ADJUSTED'),
  { t: 360, type: 'TARGET_ADJUSTED', payload: { min: 148, max: 156, reason: 'walking' } },
);

// 7. 하향 2회 소진 → 리커버리, 이후 완전 침묵 (§9)
const exhausted = drive(2400, () => 140);
check('하향은 세션 2회까지', exhausted.state.downshiftCount, 2);
check('하향 간격 5분 이상', (() => {
  const stamps = at(exhausted.events, 'TARGET_ADJUSTED');
  return stamps.length === 2 && stamps[1] - stamps[0] >= 300;
})(), true);
check('3번째 조건에서 리커버리 진입', (() => {
  const event = exhausted.events.find((e) => e.type === 'RECOVERY_MODE_ON');
  if (event?.type !== 'RECOVERY_MODE_ON') return null;
  // 하향 2회를 다 쓴 뒤에 와야 한다.
  return { reason: event.payload.reason, afterSecondDownshift: event.t > at(exhausted.events, 'TARGET_ADJUSTED')[1] };
})(), { reason: 'downshift_exhausted', afterSecondDownshift: true });
check('리커버리 이후 이벤트 없음', (() => {
  const index = exhausted.events.findIndex((event) => event.type === 'RECOVERY_MODE_ON');
  return exhausted.events.slice(index + 1).length;
})(), 0);
check('리커버리 중 verdict는 IN_RANGE', exhausted.state.verdict, 'IN_RANGE');

// 8. 하한 130 도달 → 횟수와 무관하게 즉시 리커버리 (§8)
const floor = drive(900, () => 121, { center: 134 });
check('하한 도달 시 리커버리 사유', (() => {
  const event = floor.events.find((e) => e.type === 'RECOVERY_MODE_ON');
  return event?.type === 'RECOVERY_MODE_ON' ? event.payload.reason : null;
})(), 'floor_reached');
check('하향 1회만에 하한', floor.state.target.center, 130);

// 9. 센서 품질 미달 → UNAVAILABLE, 판정 보류 (`F1-05`)
const blind = judge(createJudgeState(computeTargetRange(157, 3)), { elapsedSec: 400, cadence: null });
check('cadence null이면 UNAVAILABLE', blind.state.verdict, 'UNAVAILABLE');
check('UNAVAILABLE에서는 개입 없음', blind.events.length, 0);

// 10. DEMO.md 시나리오 관통 — 과속 1회 → 안정 → 저하 → 실패 2회 → 하향
const demo = drive(600, (t) => {
  if (t < 150) return 165; // 초반 과속 (일반 이탈)
  if (t < 335) return 157; // 안정 — 무음
  return 150; // 후반 리듬 저하
});
check('DEMO 이벤트 순서', types(demo.events), [
  'TOO_FAST',
  'TOO_SLOW',
  'TOO_SLOW',
  'TARGET_ADJUSTED',
]);
check('DEMO 하향 중심값 157 → 152', demo.state.target.center, 152);
check('DEMO 개입 횟수', demo.state.interventionCount, 3);
check('DEMO 안정 구간은 무음', demo.events.every((event) => event.t < 150 || event.t >= 335), true);

// 11. 개입 문구 — ENGINE.md §7 표
check('과속 1회차 문구', cueForEvent({ t: 100, type: 'TOO_FAST', payload: { cadence: 175 } }, { fastInterventionCount: 1, target: { center: 157, min: 153, max: 161 } })?.text,
  '지금 리듬이 조금 빠릅니다. 보폭을 줄이고 편하게 달려볼까요?');
check('과속 2회차 문구', cueForEvent({ t: 200, type: 'TOO_FAST', payload: { cadence: 175 } }, { fastInterventionCount: 2, target: { center: 157, min: 153, max: 161 } })?.text,
  '조금만 천천히 가도 괜찮아요.');
check('하향 안내는 중심값만 말한다', cueForEvent({ t: 440, type: 'TARGET_ADJUSTED', payload: { min: 148, max: 156, reason: 'no_recovery' } }, { fastInterventionCount: 0, target: { center: 152, min: 148, max: 156 } })?.text,
  '목표를 152로 낮췄어요');
check('하향 안내에 메트로놈은 붙지 않는다', cueForEvent({ t: 440, type: 'TARGET_ADJUSTED', payload: { min: 148, max: 156, reason: 'no_recovery' } }, { fastInterventionCount: 0, target: { center: 152, min: 148, max: 156 } })?.metronome, false);
check('리커버리 안내', cueForEvent({ t: 900, type: 'RECOVERY_MODE_ON', payload: { reason: 'downshift_exhausted' } }, { fastInterventionCount: 0, target: { center: 147, min: 143, max: 151 } })?.text,
  '지금은 회복이 우선이에요. 편하게 걸으셔도 괜찮아요.');
check('시작·종료는 음성 없음', [
  cueForEvent({ t: 0, type: 'RUN_START', payload: { min: 153, max: 161 } }, { fastInterventionCount: 0, target: { center: 157, min: 153, max: 161 } }),
  cueForEvent({ t: 1200, type: 'RUN_END', payload: { completed: true } }, { fastInterventionCount: 0, target: { center: 157, min: 153, max: 161 } }),
], [null, null]);


console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
if (failures > 0) process.exitCode = 1;
