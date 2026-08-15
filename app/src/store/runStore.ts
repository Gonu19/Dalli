/**
 * 러닝 세션 상태 (`ENGINE.md` §6). UI FE가 `engine/types.ts`와 함께 읽는 접점이다.
 *
 * 소스에서 온 샘플을 20초 윈도우에 넣고, 판정을 돌리고, 업로드용 `samples`/`events`를 쌓는다.
 * 엔진은 순수 TS이므로 이 파일도 `react-native`를 import하지 않는다.
 *
 * ## 시계가 둘이다
 * - `totalSec` — 소스가 준 경과 초 그대로. `samples`·`events`의 `t`와 `duration_sec`에 쓴다.
 *   서버가 `PAUSE`~`RESUME` 구간을 빼서 `active_duration_sec`를 계산하려면
 *   이벤트가 **전체 시간축** 위에 찍혀 있어야 한다 (`CONTRACT.md` 유효 러닝).
 * - `activeSec` — pause 구간을 뺀 시간. **판정에는 이쪽만 넣는다.**
 *   5분 쉬었다고 워밍업이 끝나거나 쿨다운이 지나가면 안 된다.
 */

import { create } from 'zustand';

import { SAMPLE_INTERVAL_SEC, TICK_SEC } from '../engine/constants';
import { createJudgeState, judge } from '../engine/judge';
import type { JudgeState } from '../engine/judge';
import { computeMeasuredBaseline, computeTargetRange } from '../engine/target';
import type {
  CadenceSample,
  ConditionValue,
  JudgeVerdict,
  RunEvent,
  RunSample,
  RunState,
  TargetRange,
} from '../engine/types';
import { CadenceWindow } from '../engine/window';

export type RunGoal = {
  type: 'TIME' | 'DISTANCE';
  /** 초 또는 미터 (`CONTRACT.md` `goal_value`). */
  value: number;
};

export type StartOptions = {
  /** 1회차는 온보딩 초기 목표값, 2회차부터 실측 baseline (`ENGINE.md` §2). */
  referenceCadence: number;
  condition: ConditionValue;
  goal: RunGoal;
  planId?: string | null;
  clientRunId?: string;
  startedAt?: string;
};

/** 종료 시점의 업로드 재료. `snake_case` 변환은 `api/client.ts` 한 곳에서 한다. */
export type RunRecord = {
  clientRunId: string;
  source: 'APP';
  planId: string | null;
  startedAt: string;
  endedAt: string;
  goalType: RunGoal['type'];
  goalValue: number;
  condition: ConditionValue;
  targetCadenceMin: number;
  targetCadenceMax: number;
  finalTargetMin: number;
  finalTargetMax: number;
  durationSec: number;
  distanceM: number | null;
  avgCadence: number | null;
  avgPaceSecPerKm: number | null;
  completed: boolean;
  interventionCount: number;
  downshiftCount: number;
  samples: RunSample[];
  events: RunEvent[];
  /** 러닝 종료 후 산출한 실측 baseline. `null`이면 확정하지 않는다 (`ENGINE.md` §2). */
  measuredBaseline: number | null;
};

/**
 * 러닝 도중 주기적으로 디스크에 남기는 상태 (`F1-10` 세션 복구).
 * 앱이 죽어도 여기까지는 살아남는다.
 */
export type RunSnapshot = {
  clientRunId: string;
  planId: string | null;
  startedAt: string;
  goal: RunGoal;
  condition: ConditionValue;
  initialTarget: TargetRange;
  finalTarget: TargetRange;
  totalSec: number;
  distanceM: number | null;
  paceSecPerKm: number | null;
  avgCadence: number | null;
  interventionCount: number;
  downshiftCount: number;
  samples: RunSample[];
  events: RunEvent[];
};

type RunStore = {
  runState: RunState;
  verdict: JudgeVerdict;
  /** 화면에 노출하는 현재 리듬. 품질 미달이면 `null`. */
  cadence: number | null;
  /** 화면·음성에는 `center` 하나만 쓴다. 범위 숫자는 노출 금지 (`ENGINE.md` §3). */
  target: TargetRange;
  totalSec: number;
  activeSec: number;
  distanceM: number | null;
  paceSecPerKm: number | null;
  interventionCount: number;
  downshiftCount: number;
  recovery: boolean;
  samples: RunSample[];
  events: RunEvent[];

  start: (options: StartOptions) => void;
  /** `CadenceSource.start`의 콜백에 그대로 연결한다. */
  ingest: (sample: CadenceSample) => void;
  pause: () => void;
  resume: () => void;
  finish: (completed: boolean, endedAt?: string) => RunRecord | null;
  /** 진행 중인 러닝의 현재 상태. 러닝 중이 아니면 `null`. */
  snapshot: () => RunSnapshot | null;
  reset: () => void;
};

/** 판정·집계에만 쓰는 내부 상태. 화면이 구독할 이유가 없어 스토어 밖에 둔다. */
type Session = {
  judgeState: JudgeState;
  window: CadenceWindow;
  initialTarget: TargetRange;
  condition: ConditionValue;
  goal: RunGoal;
  planId: string | null;
  clientRunId: string;
  startedAt: string;
  /** pause 누계와 진입 시각 — `activeSec` 계산용. */
  pausedTotalSec: number;
  pausedAtSec: number | null;
  lastSourceSec: number;
  lastSampleSec: number | null;
  lastJudgeSec: number | null;
  cadenceSum: number;
  cadenceCount: number;
};

let session: Session | null = null;

function newClientRunId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid;
  // 구형 런타임 폴백. 서버 멱등키로만 쓰이므로 충돌만 없으면 된다.
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const idleState = {
  runState: 'IDLE' as RunState,
  verdict: 'IN_RANGE' as JudgeVerdict,
  cadence: null,
  target: { center: 0, min: 0, max: 0 },
  totalSec: 0,
  activeSec: 0,
  distanceM: null,
  paceSecPerKm: null,
  interventionCount: 0,
  downshiftCount: 0,
  recovery: false,
  samples: [] as RunSample[],
  events: [] as RunEvent[],
};

export const useRunStore = create<RunStore>((set, get) => ({
  ...idleState,

  start: (options) => {
    const target = computeTargetRange(options.referenceCadence, options.condition);

    session = {
      judgeState: createJudgeState(target),
      window: new CadenceWindow(),
      initialTarget: target,
      condition: options.condition,
      goal: options.goal,
      planId: options.planId ?? null,
      clientRunId: options.clientRunId ?? newClientRunId(),
      startedAt: options.startedAt ?? new Date().toISOString(),
      pausedTotalSec: 0,
      pausedAtSec: null,
      lastSourceSec: 0,
      lastSampleSec: null,
      lastJudgeSec: null,
      cadenceSum: 0,
      cadenceCount: 0,
    };

    set({
      ...idleState,
      runState: 'RUNNING',
      target,
      events: [{ t: 0, type: 'RUN_START', payload: { min: target.min, max: target.max } }],
    });
  },

  ingest: (sample) => {
    const current = session;
    if (current === null) return;

    // pause 중에도 소스는 계속 돈다. 시각만 받아두고 판정·샘플링은 하지 않는다.
    current.lastSourceSec = sample.elapsedSec;
    if (get().runState !== 'RUNNING') return;

    const totalSec = sample.elapsedSec;
    const activeSec = totalSec - current.pausedTotalSec;

    current.window.push(activeSec, sample.cadence);
    const cadence = current.window.value(activeSec);
    const previous = get();

    // 센서는 1초마다 오지만 판정은 5초 tick이다 (`ENGINE.md` §4).
    // 화면에 보이는 숫자는 매 샘플 갱신하고, 판정만 주기를 지킨다.
    const shouldJudge =
      current.lastJudgeSec === null || activeSec - current.lastJudgeSec >= TICK_SEC;
    if (!shouldJudge) {
      set({ totalSec, activeSec, cadence });
      return;
    }
    current.lastJudgeSec = activeSec;

    const result = judge(current.judgeState, { elapsedSec: activeSec, cadence, ...goalProgress(current, sample) });
    current.judgeState = result.state;

    const events = [...previous.events, ...result.events.map((event) => ({ ...event, t: totalSec }))];

    // samples는 5초 간격 (`ENGINE.md` §1). 소스 tick이 1초여도 저장 주기는 5초다.
    let samples = previous.samples;
    if (
      cadence !== null &&
      (current.lastSampleSec === null || activeSec - current.lastSampleSec >= SAMPLE_INTERVAL_SEC)
    ) {
      current.lastSampleSec = activeSec;
      current.cadenceSum += cadence;
      current.cadenceCount += 1;
      samples = [
        ...samples,
        { t: totalSec, c: Math.round(cadence), p: sample.pace ?? null, d: sample.dist ?? null },
      ];
    }

    set({
      totalSec,
      activeSec,
      cadence,
      verdict: result.state.verdict,
      target: result.state.target,
      interventionCount: result.state.interventionCount,
      downshiftCount: result.state.downshiftCount,
      recovery: result.state.recovery,
      distanceM: sample.dist ?? previous.distanceM,
      paceSecPerKm: sample.pace ?? previous.paceSecPerKm,
      samples,
      events,
    });
  },

  pause: () => {
    const current = session;
    if (current === null || get().runState !== 'RUNNING') return;

    current.pausedAtSec = current.lastSourceSec;
    set((previous) => ({
      runState: 'PAUSED',
      events: [...previous.events, { t: current.lastSourceSec, type: 'PAUSE', payload: {} }],
    }));
  },

  resume: () => {
    const current = session;
    if (current === null || get().runState !== 'PAUSED') return;

    if (current.pausedAtSec !== null) {
      current.pausedTotalSec += current.lastSourceSec - current.pausedAtSec;
      current.pausedAtSec = null;
    }
    set((previous) => ({
      runState: 'RUNNING',
      events: [...previous.events, { t: current.lastSourceSec, type: 'RESUME', payload: {} }],
    }));
  },

  finish: (completed, endedAt) => {
    const current = session;
    if (current === null) return null;

    const previous = get();
    const totalSec = current.lastSourceSec;
    const events: RunEvent[] = [
      ...previous.events,
      { t: totalSec, type: 'RUN_END', payload: { completed } },
    ];

    const record = buildRecord(snapshotOf(current, previous, totalSec), completed, events, endedAt);

    session = null;
    set({ ...idleState, runState: 'IDLE', target: previous.target, events });
    return record;
  },

  snapshot: () => {
    const current = session;
    if (current === null) return null;
    return snapshotOf(current, get(), current.lastSourceSec);
  },

  reset: () => {
    session = null;
    set({ ...idleState });
  },
}));

function snapshotOf(current: Session, state: RunStore, totalSec: number): RunSnapshot {
  return {
    clientRunId: current.clientRunId,
    planId: current.planId,
    startedAt: current.startedAt,
    goal: current.goal,
    condition: current.condition,
    initialTarget: current.initialTarget,
    finalTarget: state.target,
    totalSec,
    distanceM: state.distanceM,
    paceSecPerKm: state.paceSecPerKm,
    avgCadence:
      current.cadenceCount > 0 ? Math.round(current.cadenceSum / current.cadenceCount) : null,
    interventionCount: state.interventionCount,
    downshiftCount: state.downshiftCount,
    samples: state.samples,
    events: state.events,
  };
}

/**
 * 스냅샷을 업로드 재료로 바꾼다.
 *
 * 정상 종료와 **비정상 종료 복구가 같은 코드를 탄다.** 복구 경로만 따로 조립하면
 * 필드가 조용히 어긋나고, 그건 실제로 데이터를 잃었을 때에야 드러난다.
 */
export function buildRecord(
  snapshot: RunSnapshot,
  completed: boolean,
  events?: RunEvent[],
  endedAt?: string,
): RunRecord {
  const finalEvents = events ?? [
    ...snapshot.events,
    { t: snapshot.totalSec, type: 'RUN_END' as const, payload: { completed } },
  ];

  return {
    clientRunId: snapshot.clientRunId,
    source: 'APP',
    planId: snapshot.planId,
    startedAt: snapshot.startedAt,
    endedAt: endedAt ?? new Date().toISOString(),
    goalType: snapshot.goal.type,
    goalValue: snapshot.goal.value,
    condition: snapshot.condition,
    targetCadenceMin: snapshot.initialTarget.min,
    targetCadenceMax: snapshot.initialTarget.max,
    finalTargetMin: snapshot.finalTarget.min,
    finalTargetMax: snapshot.finalTarget.max,
    durationSec: Math.round(snapshot.totalSec),
    distanceM: snapshot.distanceM,
    avgCadence: snapshot.avgCadence,
    avgPaceSecPerKm: snapshot.paceSecPerKm,
    completed,
    interventionCount: snapshot.interventionCount,
    downshiftCount: snapshot.downshiftCount,
    samples: snapshot.samples,
    events: finalEvents,
    // 실측 baseline은 러닝 중이 아니라 종료 후에 산출한다 (`ENGINE.md` §2).
    measuredBaseline: computeMeasuredBaseline(
      snapshot.samples.map<CadenceSample>((sample) => ({
        elapsedSec: sample.t,
        cadence: sample.c,
      })),
      snapshot.totalSec,
    ),
  };
}

/** 목표 진행률 — 90% 이후 `TOO_FAST`가 멈춘다 (`ENGINE.md` §10 막판 스퍼트 허용). */
function goalProgress(current: Session, sample: CadenceSample): { goalProgress: number } {
  if (current.goal.type === 'DISTANCE') {
    const distance = sample.dist ?? 0;
    return { goalProgress: current.goal.value > 0 ? distance / current.goal.value : 0 };
  }
  const activeSec = sample.elapsedSec - current.pausedTotalSec;
  return { goalProgress: current.goal.value > 0 ? activeSec / current.goal.value : 0 };
}
