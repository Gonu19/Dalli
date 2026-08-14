/**
 * 시뮬레이션용 케이던스 시나리오 (`ROADMAP.md` `F1-11`).
 *
 * 실기기·야외·서버 없이 판정 전체를 재현한다. 시연 촬영도 여기서 나온다 (`DEMO.md`).
 * 순수 데이터라 Node에서도 그대로 돌아간다.
 */

import { SENSOR_TICK_SEC } from '../constants';
import type { CadenceSample } from '../types';

export type ScenarioName = 'demo' | 'steady' | 'walking' | 'recovery';

export type Scenario = {
  name: ScenarioName;
  label: string;
  description: string;
  durationSec: number;
  /** 경과 초 → 순간 SPM. 소스가 1초 간격으로 이 값을 흘려보낸다. */
  spmAt: (t: number) => number;
};

/**
 * 결정적 흔들림. 사람이 정확히 157로 달리지 않으므로 평평한 값은 화면이 가짜처럼 보인다.
 * 진폭 ±3이라 중앙값은 그대로고 판정도 흔들리지 않는다 (회복 밴드가 ±3).
 */
function jitter(t: number): number {
  return Math.round(3 * Math.sin(t / 6));
}

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  demo: {
    name: 'demo',
    label: '시연 시나리오',
    description: '초반 과속 → 안정 → 후반 저하 → 회복 실패 2회 → 목표 하향',
    durationSec: 600,
    // DEMO.md 대본 그대로. TOO_FAST는 하향으로 이어지지 않으므로 저하 구간이 따로 있다.
    spmAt: (t) => {
      if (t < 150) return 165 + jitter(t); // 초반 과속
      if (t < 335) return 157 + jitter(t); // 안정 — 무음 구간
      return 150 + jitter(t); // 후반 리듬 저하
    },
  },

  steady: {
    name: 'steady',
    label: '무음 완주',
    description: '범위 안을 유지해 개입이 한 번도 없는 러닝',
    durationSec: 1200,
    spmAt: (t) => 157 + jitter(t),
  },

  walking: {
    name: 'walking',
    label: '걷기 전환',
    description: '5분 이후 걷기로 떨어져 60초 만에 목표가 내려가는 경우',
    durationSec: 900,
    spmAt: (t) => (t < 300 ? 157 + jitter(t) : 110 + jitter(t)),
  },

  recovery: {
    name: 'recovery',
    label: '리커버리 진입',
    description: '하향 2회를 모두 쓰고 리커버리로 들어가 조용해지는 경우',
    durationSec: 2400,
    spmAt: (t) => 140 + jitter(t),
  },
};

/** 시나리오를 1초 간격 샘플 배열로 펼친다. `ReplaySource`에 그대로 넣는다. */
export function buildScenarioSamples(scenario: Scenario): CadenceSample[] {
  const samples: CadenceSample[] = [];
  for (let t = 0; t <= scenario.durationSec; t += SENSOR_TICK_SEC) {
    samples.push({ elapsedSec: t, cadence: scenario.spmAt(t) });
  }
  return samples;
}
