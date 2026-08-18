/**
 * 누적 걸음 → SPM 검증 (`ENGINE.md` §4).
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/step-rate-check.ts
 *
 * iOS가 걸음을 묶어 보내는 상황을 재현한다. 실기기 없이 확인할 수 있어야
 * "걷는데 0이 뜬다"는 문제가 다시 돌아오지 않는다.
 */

import { WINDOW_SEC } from '../constants';
import { median } from '../math';
import { rollingCadenceSpm, updateStepHistory } from '../step-rate';
import type { StepPoint } from '../step-rate';

const ROLLING_WINDOW_SEC = 8;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

/** 분당 `spm`으로 걷되 iOS처럼 `batchSec`마다 몰아서 올려보내는 누적 걸음. */
function batchedSteps(seconds: number, spm: number, batchSec: number): number[] {
  const perSec = spm / 60;
  const out: number[] = [];
  let reported = 0;
  for (let t = 1; t <= seconds; t += 1) {
    if (t % batchSec === 0) reported = Math.floor(perSec * t);
    out.push(reported);
  }
  return out;
}

const walking = batchedSteps(60, 110, 4); // 110spm으로 60초, 4초마다 배치

// 1. 1초 차분 방식이 어떻게 무너지는지 — 이것이 실기기에서 본 증상이다
const perTickValues: number[] = [];
let previous = 0;
for (const steps of walking) {
  perTickValues.push((steps - previous) * 60);
  previous = steps;
}
check('1초 차분은 절반 이상이 0', perTickValues.filter((value) => value === 0).length > 30, true);
check('1초 차분의 20초 중앙값은 0', median(perTickValues.slice(-WINDOW_SEC)), 0);

// 2. 롤링 비율은 실제 값에 붙는다
let history: StepPoint[] = [{ atMs: 0, steps: 0 }];
const rolling: number[] = [];
walking.forEach((steps, index) => {
  history = updateStepHistory(history, { atMs: (index + 1) * 1000, steps }, ROLLING_WINDOW_SEC);
  rolling.push(rollingCadenceSpm(history));
});

const settled = rolling.slice(20);
check('롤링 값은 0이 되지 않는다', settled.every((value) => value > 80), true);
check('롤링 값이 실제 110spm 근처', settled.every((value) => Math.abs(value - 110) <= 20), true);
check('20초 중앙값도 살아 있다', Math.abs((median(rolling.slice(-WINDOW_SEC)) ?? 0) - 110) <= 15, true);

// 3. 구간을 덮는 점 하나는 남긴다 — 분모가 짧아지면 배치가 그대로 튄다
{
  let kept: StepPoint[] = [{ atMs: 0, steps: 0 }];
  for (let t = 1; t <= 30; t += 1) {
    kept = updateStepHistory(kept, { atMs: t * 1000, steps: t * 2 }, ROLLING_WINDOW_SEC);
  }
  check('구간 밖 점은 하나만 남는다', kept[0].atMs <= 30_000 - ROLLING_WINDOW_SEC * 1000, true);
  check('일정 속도면 값이 정확하다', Math.round(rollingCadenceSpm(kept)), 120);
}

// 4. 경계
check('점이 하나면 0', rollingCadenceSpm([{ atMs: 0, steps: 0 }]), 0);
check('시간이 안 흘렀으면 0', rollingCadenceSpm([{ atMs: 5, steps: 0 }, { atMs: 5, steps: 9 }]), 0);
check('멈춰 있으면 0', rollingCadenceSpm([{ atMs: 0, steps: 40 }, { atMs: 8000, steps: 40 }]), 0);

console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
if (failures > 0) process.exitCode = 1;
