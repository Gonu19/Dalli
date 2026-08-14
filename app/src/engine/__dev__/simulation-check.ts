/**
 * `F1-11` 검증 — 시뮬레이션 시나리오 4종을 실제 스토어 경로로 관통시킨다.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/simulation-check.ts
 *
 * 소스만 `ReplaySource`일 뿐 판정·집계 경로는 실러닝과 같다.
 * 1초 간격 샘플이므로 5초 tick 스로틀도 여기서 함께 검증된다.
 */

import { ReplaySource } from '../sources/replay-source';
import { buildScenarioSamples, SCENARIOS } from '../sources/scenarios';
import type { ScenarioName } from '../sources/scenarios';
import type { RunEvent } from '../types';
import { useRunStore } from '../../store/runStore';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

/** 시뮬레이션과 같은 경로 — 다만 배속 대기 없이 동기로 끝까지 흘린다. */
function play(name: ScenarioName) {
  const scenario = SCENARIOS[name];
  const store = useRunStore.getState();
  store.reset();
  store.start({
    referenceCadence: 157,
    condition: 3,
    goal: { type: 'TIME', value: scenario.durationSec },
    clientRunId: `sim-${name}`,
    startedAt: '2026-08-14T09:00:00Z',
  });

  new ReplaySource(buildScenarioSamples(scenario), { speed: Infinity }).start((sample) =>
    useRunStore.getState().ingest(sample),
  );

  const state = useRunStore.getState();
  return { state, record: useRunStore.getState().finish(true, '2026-08-14T09:30:00Z') };
}

const types = (events: RunEvent[]) => events.map((event) => event.type);

// 1. 시연 시나리오 — DEMO.md 촬영 체크리스트 첫 항목
const demo = play('demo');
check('DEMO 이벤트 순서', types(demo.record?.events ?? []), [
  'RUN_START',
  'TOO_FAST',
  'TOO_SLOW',
  'TOO_SLOW',
  'TARGET_ADJUSTED',
  'RUN_END',
]);
check('DEMO 중심값 157 → 152', demo.record?.finalTargetMin, 148);
check('DEMO 하향은 5분 이후', (() => {
  const adjusted = demo.record?.events.find((e) => e.type === 'TARGET_ADJUSTED');
  return adjusted !== undefined && adjusted.t >= 300;
})(), true);
check('DEMO 리커버리는 진입하지 않는다', demo.state.recovery, false);

// 2. 5초 tick 스로틀 — 1초 소스여도 샘플은 5초 간격이다 (§4)
check('샘플 간격 5초 유지', (() => {
  const samples = demo.record?.samples ?? [];
  return samples.slice(1).every((sample, i) => sample.t - samples[i].t === 5);
})(), true);
check('600초 러닝의 샘플 수', demo.record?.samples.length, 120);

// 3. 무음 완주 — 개입이 한 번도 없어야 한다 (Silent by default)
const steady = play('steady');
check('완주 시나리오 무음', types(steady.record?.events ?? []), ['RUN_START', 'RUN_END']);
check('완주 시나리오 목표 유지', steady.record?.finalTargetMin, 153);
check('완주 시나리오 baseline 산출', steady.record?.measuredBaseline, 157);

// 4. 걷기 전환 — 60초 지속 시 하향
const walking = play('walking');
check('걷기 하향 사유', (() => {
  const event = walking.record?.events.find((e) => e.type === 'TARGET_ADJUSTED');
  return event?.type === 'TARGET_ADJUSTED' ? event.payload.reason : null;
})(), 'walking');

// 5. 리커버리 — 하향 2회 소진 후 침묵
const recovery = play('recovery');
check('리커버리 하향 2회', recovery.record?.downshiftCount, 2);
check('리커버리 진입', recovery.state.recovery, true);
check('리커버리 이후 개입 없음', (() => {
  const events = recovery.record?.events ?? [];
  const index = events.findIndex((event) => event.type === 'RECOVERY_MODE_ON');
  return types(events.slice(index + 1));
})(), ['RUN_END']);

console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
if (failures > 0) process.exitCode = 1;
