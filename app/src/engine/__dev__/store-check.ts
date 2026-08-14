/**
 * `F1-07` 검증 — `runStore` 세션 상태와 일시정지·재개.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/store-check.ts
 *
 * 핵심은 시계가 둘이라는 것이다. 이벤트·샘플은 전체 시간축, 판정은 pause를 뺀 시간축을 쓴다.
 */

import { SAMPLE_INTERVAL_SEC } from '../constants';
import { ReplaySource } from '../sources/replay-source';
import type { CadenceSample, RunEvent } from '../types';
import { useRunStore } from '../../store/runStore';
import type { StartOptions } from '../../store/runStore';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

const baseOptions: StartOptions = {
  referenceCadence: 157,
  condition: 3,
  goal: { type: 'TIME', value: 1200 },
  clientRunId: 'fixed-client-run-id',
  startedAt: '2026-08-14T09:00:00Z',
};

/** 5초 간격 배열을 만들어 스토어에 흘려보낸다. `onTick`으로 중간에 pause/resume을 건다. */
function drive(
  durationSec: number,
  spmAt: (t: number) => number,
  onTick?: (t: number) => void,
  options: Partial<StartOptions> = {},
) {
  const samples: CadenceSample[] = [];
  for (let t = 0; t <= durationSec; t += SAMPLE_INTERVAL_SEC) {
    samples.push({ elapsedSec: t, cadence: spmAt(t) });
  }

  const store = useRunStore.getState();
  store.reset();
  useRunStore.getState().start({ ...baseOptions, ...options });

  new ReplaySource(samples, { speed: Infinity }).start((sample) => {
    useRunStore.getState().ingest(sample);
    onTick?.(sample.elapsedSec);
  });

  return useRunStore.getState();
}

const types = (events: RunEvent[]) => events.map((event) => event.type);

// 1. 시작 — RUN_START는 목표 범위를 payload로 갖는다 (`CONTRACT.md`)
const started = drive(60, () => 157);
check('시작 시 RUNNING', started.runState, 'RUNNING');
check('RUN_START payload', started.events[0], {
  t: 0,
  type: 'RUN_START',
  payload: { min: 153, max: 161 },
});
check('컨디션 반영 목표', started.target, { center: 157, min: 153, max: 161 });

// 2. samples는 5초 간격, 전체 시간축 위에 찍힌다
check('샘플 간격 5초', (() => {
  const gaps = started.samples.slice(1).map((s, i) => s.t - started.samples[i].t);
  return gaps.every((gap) => gap === SAMPLE_INTERVAL_SEC);
})(), true);
check('샘플 값은 윈도우 중앙값', started.samples[started.samples.length - 1].c, 157);

// 3. 일시정지 — 타이머·지표·샘플링 정지 (§6)
let pausedSnapshot = { activeSec: 0, sampleCount: 0 };
const paused = drive(600, () => 157, (t) => {
  const store = useRunStore.getState();
  if (t === 100) {
    store.pause();
    pausedSnapshot = { activeSec: store.activeSec, sampleCount: store.samples.length };
  }
  if (t === 400) store.resume();
});
check('PAUSE·RESUME 이벤트 시각', paused.events.filter((e) => e.type === 'PAUSE' || e.type === 'RESUME'), [
  { t: 100, type: 'PAUSE', payload: {} },
  { t: 400, type: 'RESUME', payload: {} },
]);
check('pause 구간에 쌓인 샘플 없음', (() => {
  const inGap = paused.samples.filter((s) => s.t > 100 && s.t < 400);
  return inGap.length;
})(), 0);
check('pause 시점 activeSec', pausedSnapshot.activeSec, 100);
check('재개 후 activeSec는 pause만큼 뒤처진다', paused.activeSec, paused.totalSec - 300);

// 4. 판정 시계는 pause를 뺀다 — 300초를 쉬어도 워밍업이 지나가지 않는다
const held = drive(900, () => 175, (t) => {
  const store = useRunStore.getState();
  if (t === 50) store.pause();
  if (t === 350) store.resume();
});
check('워밍업은 활동 시간 기준', held.events.find((e) => e.type === 'TOO_FAST')?.t, 400);
check('이벤트는 전체 시간축에 찍힌다', (() => {
  const event = held.events.find((e) => e.type === 'TOO_FAST');
  return event !== undefined && event.t === 400 && held.activeSec === held.totalSec - 300;
})(), true);

// 5. 센서 공백 → UNAVAILABLE (품질 미달)
const blind = drive(300, () => 157);
useRunStore.getState().ingest({ elapsedSec: 400, cadence: 157 }); // 100초 공백
check('공백 직후 판정 보류', useRunStore.getState().verdict, 'UNAVAILABLE');
check('UNAVAILABLE이면 cadence 미노출', useRunStore.getState().cadence, null);
check('직전까지는 정상 판정이었다', blind.verdict, 'IN_RANGE');

// 6. 종료 — 업로드 재료가 CONTRACT 필드를 채운다
drive(1200, (t) => (t < 400 ? 157 : 150));
const record = useRunStore.getState().finish(true, '2026-08-14T09:20:30Z');
check('RUN_END 이벤트', record?.events[record.events.length - 1], {
  t: 1200,
  type: 'RUN_END',
  payload: { completed: true },
});
check('종료 후 IDLE', useRunStore.getState().runState, 'IDLE');
check('duration_sec는 전체 시간', record?.durationSec, 1200);
check('멱등키·시작 시각 유지', [record?.clientRunId, record?.startedAt], [
  'fixed-client-run-id',
  '2026-08-14T09:00:00Z',
]);
check('최초 목표는 그대로 남는다', [record?.targetCadenceMin, record?.targetCadenceMax], [153, 161]);
check('하향된 최종 목표가 따로 기록된다', [record?.finalTargetMin, record?.finalTargetMax], [148, 156]);
check('개입·하향 횟수', [record?.interventionCount, record?.downshiftCount], [2, 1]);
check('이벤트 순서', types(record?.events ?? []), [
  'RUN_START',
  'TOO_SLOW',
  'TOO_SLOW',
  'TARGET_ADJUSTED',
  'RUN_END',
]);
check('실측 baseline 산출', record?.measuredBaseline, 157);
check('평균 케이던스', record?.avgCadence, 152);
check('GPS 없으면 거리·페이스 null', [record?.distanceM, record?.avgPaceSecPerKm], [null, null]);

console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
if (failures > 0) process.exitCode = 1;
