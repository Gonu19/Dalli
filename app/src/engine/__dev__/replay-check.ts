/**
 * `F1-02` 완료 조건 검증 — 센서 없이 Node에서 배열 재생만으로 엔진 입력이 도는지 확인한다.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/replay-check.ts
 *
 * 맥도 실기기도 필요 없다. 통과하면 `ReplaySource`로 판정을 검증할 준비가 된 것이다.
 *
 * 판정(`judge`)은 `F1-05`에서 붙는다. 여기서는 소스·목표 계산·baseline 산출까지만 검증한다.
 */

import { ONBOARDING_SKIP_DEFAULTS, SAMPLE_INTERVAL_SEC } from '../constants';
import { ReplaySource } from '../sources/replay-source';
import {
  clampAdjustedTarget,
  computeInitialTargetCadence,
  computeMeasuredBaseline,
  computeTargetRange,
  targetCenter,
} from '../target';
import type { CadenceSample } from '../types';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${mark}] ${label}${detail}`);
}

/** 5초 tick 기준 샘플 배열. `spmAt`이 구간별 케이던스를 만든다. */
function buildSamples(durationSec: number, spmAt: (t: number) => number): CadenceSample[] {
  const samples: CadenceSample[] = [];
  for (let t = 0; t <= durationSec; t += SAMPLE_INTERVAL_SEC) {
    samples.push({ elapsedSec: t, cadence: spmAt(t) });
  }
  return samples;
}

// 1. 초기 목표값 — ENGINE.md §2 규칙표
check('초기 목표값 (입문 × 완주)', computeInitialTargetCadence(0, 'COMPLETE'), 140);
check('초기 목표값 (입문 × 습관)', computeInitialTargetCadence(0, 'HABIT'), 150);
check('초기 목표값 (꾸준 × 기록)', computeInitialTargetCadence(2, 'PERFORMANCE'), 168);
check(
  '전 조합이 150~168 안에 든다',
  ([0, 1, 2] as const).every((level) =>
    (['COMPLETE', 'HABIT', 'WEIGHT', 'FITNESS', 'PERFORMANCE'] as const).every((purpose) => {
      const value = computeInitialTargetCadence(level, purpose);
      return value >= 150 && value <= 168;
    }),
  ),
  true,
);

check(
  '온보딩 건너뛰기 기본값의 초기 목표값',
  computeInitialTargetCadence(
    ONBOARDING_SKIP_DEFAULTS.experienceLevel,
    ONBOARDING_SKIP_DEFAULTS.runningPurpose,
  ),
  152,
);

// 1-2. 조절 화면 상·하한 — ENGINE.md §2
check('추천값 기준 +10까지', clampAdjustedTarget(200, 152), 162);
check('추천값 기준 −10까지', clampAdjustedTarget(100, 152), 142);
check('절대 하한 130이 우선', clampAdjustedTarget(120, 135), 130);
check('절대 상한 185가 우선', clampAdjustedTarget(200, 182), 185);
check('걷기 상단(120)은 목표가 될 수 없다', clampAdjustedTarget(120, 132) >= 130, true);

// 2. 목표 범위 — ENGINE.md §3
check('목표 범위 (보통)', computeTargetRange(157, 3), { center: 157, min: 153, max: 161 });
check('목표 범위 (피곤함 −3)', computeTargetRange(157, 1), { center: 154, min: 150, max: 158 });
check('목표 범위 (가벼움 +2)', computeTargetRange(157, 5), { center: 159, min: 155, max: 163 });
check('center 하한 클램프 130', computeTargetRange(128, 1), { center: 130, min: 126, max: 134 });
check('center 상한 클램프 185', computeTargetRange(190, 5), { center: 185, min: 181, max: 189 });
check('min/max에서 center 복원', targetCenter(153, 161), 157);

// 3. 실측 baseline — ENGINE.md §2. 러닝 종료 후에만 산출한다.
const steady = buildSamples(1200, (t) => (t < 90 ? 140 : 156));
check('baseline 확정 (90~270초 중앙값)', computeMeasuredBaseline(steady, 1200), 156);
check('6분 미만이면 미확정', computeMeasuredBaseline(steady, 300), null);
check(
  '정지 샘플 제외 후 30개 미만이면 미확정',
  computeMeasuredBaseline(
    buildSamples(1200, (t) => (t >= 90 && t <= 270 ? 40 : 156)),
    1200,
  ),
  null,
);

// 4. ReplaySource — 동기 배속(Infinity)
const source = new ReplaySource(steady, { speed: Infinity });
const received: CadenceSample[] = [];
source.start((sample) => received.push(sample));
check('동기 재생 샘플 수', received.length, steady.length);
check('elapsedSec 단조 증가', received.every((s, i) => i === 0 || s.elapsedSec > received[i - 1].elapsedSec), true);
check('입력 순서가 어긋나도 정렬', (() => {
  const shuffled = new ReplaySource([steady[4], steady[1], steady[9]], { speed: Infinity });
  const out: number[] = [];
  shuffled.start((s) => out.push(s.elapsedSec));
  return out;
})(), [steady[1].elapsedSec, steady[4].elapsedSec, steady[9].elapsedSec]);

// 5. ReplaySource — 배속 재생과 stop()
const timed = buildSamples(60, () => 158);
const startedAt = Date.now();
const seen: number[] = [];
const timedSource = new ReplaySource(timed, {
  speed: 120, // 60초 분량을 0.5초에
  onEnd: () => {
    const wallSec = (Date.now() - startedAt) / 1000;
    check('배속 재생 완주', seen.length, timed.length);
    check('마지막 elapsedSec 유지', seen[seen.length - 1], 60);
    check('wall-clock은 배속만큼 짧다 (< 2초)', wallSec < 2, true);

    // stop() 이후에는 콜백이 오지 않아야 한다.
    let afterStop = 0;
    const stopping = new ReplaySource(timed, { speed: 20 });
    stopping.start(() => {
      afterStop += 1;
      stopping.stop();
    });
    setTimeout(() => {
      check('stop() 후 콜백 중단', afterStop, 1);
      console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
      if (failures > 0) process.exitCode = 1;
    }, 200);
  },
});
timedSource.start((sample) => seen.push(sample.elapsedSec));
