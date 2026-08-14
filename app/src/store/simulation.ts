/**
 * 시뮬레이션 모드 (`ROADMAP.md` `F1-11`).
 *
 * 실센서 대신 `ReplaySource`를 `runStore`에 물린다. 화면·판정·오디오는 실러닝과
 * **완전히 같은 경로**를 탄다 — 소스만 바뀐다. 컷 리스트에서 "절대 자르지 않는 것"에 들어 있고,
 * 시연 촬영과 서버 없는 데모가 여기에 걸려 있다.
 *
 * 시뮬레이션 결과는 서버에 올리지 않는다. `useSimulationStore`의 `active`로 구분한다.
 */

import { create } from 'zustand';

import { buildScenarioSamples, SCENARIOS } from '../engine/sources/scenarios';
import type { ScenarioName } from '../engine/sources/scenarios';
import { ReplaySource } from '../engine/sources/replay-source';
import type { ConditionValue } from '../engine/types';
import { useRunStore } from './runStore';

export type SimulationOptions = {
  scenario?: ScenarioName;
  /** 재생 배속. 시연 촬영은 1배속으로 남긴다 (`DEMO.md` — 빨리감기하면 음성이 안 들린다). */
  speed?: number;
  referenceCadence?: number;
  condition?: ConditionValue;
};

type SimulationStore = {
  active: boolean;
  scenario: ScenarioName | null;
  speed: number;
  start: (options?: SimulationOptions) => void;
  stop: () => void;
};

let source: ReplaySource | null = null;

export const useSimulationStore = create<SimulationStore>((set) => ({
  active: false,
  scenario: null,
  speed: 1,

  start: (options = {}) => {
    const name = options.scenario ?? 'demo';
    const scenario = SCENARIOS[name];
    const speed = options.speed ?? 1;

    source?.stop();
    useRunStore.getState().reset();
    useRunStore.getState().start({
      referenceCadence: options.referenceCadence ?? 157,
      condition: options.condition ?? 3,
      goal: { type: 'TIME', value: scenario.durationSec },
    });

    source = new ReplaySource(buildScenarioSamples(scenario), { speed });
    source.start((sample) => useRunStore.getState().ingest(sample));

    set({ active: true, scenario: name, speed });
  },

  stop: () => {
    source?.stop();
    source = null;
    set({ active: false, scenario: null });
  },
}));

export { SCENARIOS } from '../engine/sources/scenarios';
export type { Scenario, ScenarioName } from '../engine/sources/scenarios';
