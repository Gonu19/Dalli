/**
 * 판정 상태머신 (`ENGINE.md` §5~§9).
 *
 * 순수 함수다. 상태를 바꾸지 않고 새 상태를 돌려준다 — 같은 입력이면 언제나 같은 결과이므로
 * `ReplaySource` 배속 재생과 실센서가 완전히 같은 경로를 탄다.
 *
 * **시간은 tick의 `elapsedSec`뿐이다.** `Date.now()`/`setTimeout`을 쓰지 않는다 (§6).
 */

import {
  COOLDOWN_SEC,
  DEVIATION_SEC,
  DOWNSHIFT_FAIL_NORMAL,
  DOWNSHIFT_FAIL_SEVERE,
  DOWNSHIFT_FLOOR,
  DOWNSHIFT_INTERVAL_SEC,
  DOWNSHIFT_MEDIAN_MIN_SAMPLES,
  FAST_MUTE_PROGRESS,
  IDLE_CADENCE_THRESHOLD,
  MAX_DOWNSHIFT,
  MAX_DOWNSHIFT_STEP,
  MAX_FAST_INTERVENTION,
  RECOVERY_HALF_WIDTH,
  RESTABILIZE_SEC,
  SEVERE_DEVIATION_SEC,
  SEVERE_THRESHOLD,
  SLOW_JUDGE_START_SEC,
  TARGET_HALF_WIDTH,
  WALK_CADENCE_MAX,
  WALK_SEC,
  WARMUP_SEC,
} from './constants';
import { median } from './math';
import type {
  CadenceZone,
  DeviationDirection,
  JudgePhase,
  JudgeVerdict,
  RunEvent,
  TargetAdjustedReason,
  TargetRange,
} from './types';

/** 5초 tick마다 엔진에 들어오는 입력. `cadence`는 20초 윈도우 중앙값이다. */
export type JudgeTick = {
  elapsedSec: number;
  /** 센서 품질 미달·미수신이면 `null`. 판정을 멈추고 `UNAVAILABLE`을 노출한다. */
  cadence: number | null;
  /** 목표 대비 진행률 0~1. 90% 이후 `TOO_FAST`가 멈춘다 (§10 막판 스퍼트 허용). */
  goalProgress?: number;
};

export type JudgeState = {
  phase: JudgePhase;
  verdict: JudgeVerdict;
  target: TargetRange;

  /** 진행 중인 이탈. 회복(±3)하거나 개입하면 비워진다. */
  deviation: {
    direction: DeviationDirection;
    startedSec: number;
    severe: boolean;
  } | null;

  cooldownStartedSec: number | null;
  /** 걷기 구간이 시작된 시각. 60초 지속되면 즉시 하향 (§8). */
  walkStartedSec: number | null;

  /** `TOO_SLOW` 방향 실패 횟수. 하향 실행 시 0으로 돌아간다. `TOO_FAST`는 세지 않는다 (§8). */
  slowFailCount: number;
  /** 급격 이탈로 인한 실패였는지 — 1회로 하향 트리거. */
  lastFailSevere: boolean;

  fastInterventionCount: number;
  interventionCount: number;
  downshiftCount: number;
  lastDownshiftSec: number | null;

  /** 진입하면 세션 종료까지 유지된다. 해제 없음 (§9). */
  recovery: boolean;

  /** 하향폭 계산용 최근 60초 버퍼 (§8). */
  recent: { t: number; c: number }[];
};

export type JudgeResult = {
  state: JudgeState;
  /** 이번 tick에 발생한 이벤트. `runStore`가 그대로 `events[]`에 넣고 오디오를 태운다. */
  events: RunEvent[];
};

export function createJudgeState(target: TargetRange): JudgeState {
  return {
    phase: 'WARMUP',
    verdict: 'IN_RANGE',
    target,
    deviation: null,
    cooldownStartedSec: null,
    walkStartedSec: null,
    slowFailCount: 0,
    lastFailSevere: false,
    fastInterventionCount: 0,
    interventionCount: 0,
    downshiftCount: 0,
    lastDownshiftSec: null,
    recovery: false,
    recent: [],
  };
}

/** 윈도우 cadence의 구간 (§4). 정지 임계값이 50인 이유는 걷기가 100~120이기 때문이다. */
export function cadenceZone(cadence: number): CadenceZone {
  if (cadence < IDLE_CADENCE_THRESHOLD) return 'IDLE';
  if (cadence <= WALK_CADENCE_MAX) return 'WALK';
  return 'RUN';
}

export function judge(previous: JudgeState, tick: JudgeTick): JudgeResult {
  const state: JudgeState = { ...previous, recent: previous.recent };
  const events: RunEvent[] = [];
  const { elapsedSec, cadence } = tick;

  // 센서가 죽으면 판정을 멈춘다. 카운터는 그대로 두고 숫자만 UNAVAILABLE로 노출한다.
  if (cadence === null) {
    return { state: { ...state, verdict: 'UNAVAILABLE' }, events };
  }

  state.recent = [...previous.recent, { t: elapsedSec, c: cadence }].filter(
    (sample) => elapsedSec - sample.t <= WALK_SEC,
  );

  const zone = cadenceZone(cadence);

  // 워밍업 90초: tick은 돌지만 판정 결과를 쓰지 않는다. 구간 자체를 노출하지 않으므로 색도 IN_RANGE.
  if (elapsedSec < WARMUP_SEC) {
    return { state: { ...state, phase: 'WARMUP', verdict: 'IN_RANGE' }, events };
  }
  if (state.phase === 'WARMUP') state.phase = 'IN_RANGE';

  // 리커버리는 해제가 없다. 측정·샘플링은 계속하되 개입·하향이 전부 멈춘다 (§9).
  if (state.recovery) {
    return { state: { ...state, phase: 'RECOVERY', verdict: 'IN_RANGE' }, events };
  }

  // 걷기 60초는 이탈과 별개로 즉시 하향을 트리거한다 (§8).
  state.walkStartedSec =
    zone === 'WALK' ? (previous.walkStartedSec ?? elapsedSec) : null;
  if (
    state.walkStartedSec !== null &&
    elapsedSec - state.walkStartedSec >= WALK_SEC &&
    canDownshift(state, elapsedSec)
  ) {
    return applyDownshiftOrRecovery(state, elapsedSec, 'walking', events);
  }

  // 정지·걷기 구간은 이탈 판정을 하지 않는다. 정지는 이탈 카운터를 리셋하지도 않는다 (§4).
  if (zone !== 'RUN') {
    return { state: { ...state, verdict: 'IN_RANGE' }, events };
  }

  // 하향 직후 30초는 새 범위에 적응할 시간을 준다 (§8 안정화).
  if (
    state.lastDownshiftSec !== null &&
    elapsedSec - state.lastDownshiftSec < RESTABILIZE_SEC
  ) {
    return { state: { ...state, phase: 'IN_RANGE', verdict: 'IN_RANGE' }, events };
  }

  const diff = cadence - state.target.center;
  const inRecoveryBand = Math.abs(diff) <= RECOVERY_HALF_WIDTH;
  const outsideTarget = Math.abs(diff) > TARGET_HALF_WIDTH;
  const direction: DeviationDirection = diff > 0 ? 'FAST' : 'SLOW';

  // 쿨다운 60초: 무음 + 판정 보류. 종료 시점의 성공·실패는 ±4가 아니라 ±3으로 잰다 (§1).
  if (state.phase === 'COOLDOWN' && state.cooldownStartedSec !== null) {
    if (elapsedSec - state.cooldownStartedSec < COOLDOWN_SEC) {
      return { state, events };
    }
    return resolveCooldown(state, elapsedSec, inRecoveryBand, direction, events);
  }

  if (state.phase === 'INTERVENED') {
    state.phase = 'COOLDOWN';
    return { state, events };
  }

  // 이탈 시작·해제
  if (state.deviation === null) {
    if (!outsideTarget) {
      return { state: { ...state, phase: 'IN_RANGE', verdict: 'IN_RANGE' }, events };
    }
    state.deviation = {
      direction,
      startedSec: elapsedSec,
      severe: Math.abs(diff) > SEVERE_THRESHOLD,
    };
    state.phase = 'DEVIATING';
  } else if (inRecoveryBand) {
    // 회복 기준은 언제나 ±3. 진입(±4 초과)과 기준이 다른 히스테리시스다.
    state.deviation = null;
    state.phase = 'IN_RANGE';
    return { state: { ...state, verdict: 'IN_RANGE' }, events };
  } else if (state.deviation.direction !== direction) {
    // 반대 방향으로 넘어갔으면 새 이탈로 다시 센다.
    state.deviation = {
      direction,
      startedSec: elapsedSec,
      severe: Math.abs(diff) > SEVERE_THRESHOLD,
    };
  } else if (Math.abs(diff) > SEVERE_THRESHOLD) {
    // 일반 이탈이 급격으로 악화되면 10초 기준으로 앞당긴다.
    state.deviation = { ...state.deviation, severe: true };
  }

  const deviation = state.deviation;
  const heldSec = elapsedSec - deviation.startedSec;
  const requiredSec = deviation.severe ? SEVERE_DEVIATION_SEC : DEVIATION_SEC;
  const verdict: JudgeVerdict = deviation.direction === 'FAST' ? 'TOO_FAST' : 'TOO_SLOW';

  if (heldSec >= requiredSec && canIntervene(state, deviation.direction, tick)) {
    state.phase = 'INTERVENED';
    state.verdict = verdict;
    state.cooldownStartedSec = elapsedSec;
    state.interventionCount += 1;
    if (deviation.direction === 'FAST') state.fastInterventionCount += 1;
    events.push({
      t: elapsedSec,
      type: deviation.direction === 'FAST' ? 'TOO_FAST' : 'TOO_SLOW',
      payload: { cadence },
    });
    return { state, events };
  }

  return { state: { ...state, verdict }, events };
}

/**
 * 개입 가능 여부 (§5 판정 타임라인).
 * `TOO_SLOW`를 5분 이전에 켜지 않는 이유는 몸 푸는 사용자를 재촉하지 않기 위해서다.
 */
function canIntervene(
  state: JudgeState,
  direction: DeviationDirection,
  tick: JudgeTick,
): boolean {
  if (direction === 'SLOW') return tick.elapsedSec >= SLOW_JUDGE_START_SEC;
  if (state.fastInterventionCount >= MAX_FAST_INTERVENTION) return false;
  return (tick.goalProgress ?? 0) < FAST_MUTE_PROGRESS;
}

/** 쿨다운 종료 판정. 성공이면 IN_RANGE, 실패면 방향에 따라 갈린다 (§6·§8). */
function resolveCooldown(
  state: JudgeState,
  elapsedSec: number,
  inRecoveryBand: boolean,
  direction: DeviationDirection,
  events: RunEvent[],
): JudgeResult {
  state.cooldownStartedSec = null;

  if (inRecoveryBand) {
    state.phase = 'IN_RANGE';
    state.verdict = 'IN_RANGE';
    state.deviation = null;
    return { state, events };
  }

  state.phase = 'FAILED';
  const severe = state.deviation?.severe ?? false;

  // 실패는 `TOO_SLOW` 방향만 센다. 과속에 하향을 걸면 격차가 벌어지는 악순환이 된다 (§7).
  if (direction === 'SLOW') {
    state.slowFailCount += 1;
    state.lastFailSevere = severe;

    const required = severe ? DOWNSHIFT_FAIL_SEVERE : DOWNSHIFT_FAIL_NORMAL;
    if (state.slowFailCount >= required && canDownshift(state, elapsedSec)) {
      return applyDownshiftOrRecovery(
        state,
        elapsedSec,
        severe ? 'severe' : 'no_recovery',
        events,
      );
    }
  }

  // 트리거 미만이면 다시 이탈 구간으로 돌아가 20초(급격 10초)를 새로 센다.
  state.deviation = { direction, startedSec: elapsedSec, severe };
  state.phase = 'DEVIATING';
  state.verdict = direction === 'FAST' ? 'TOO_FAST' : 'TOO_SLOW';
  return { state, events };
}

/**
 * 하향 가능 시점인지 — 5분 이전에는 하향이 없고(§5), 하향 간격은 5분이다(§8).
 * 횟수 소진은 리커버리로 가는 경로이므로 여기서 막지 않는다.
 */
function canDownshift(state: JudgeState, elapsedSec: number): boolean {
  if (elapsedSec < SLOW_JUDGE_START_SEC) return false;
  if (state.lastDownshiftSec === null) return true;
  return elapsedSec - state.lastDownshiftSec >= DOWNSHIFT_INTERVAL_SEC;
}

/**
 * 하향 실행. 2회를 다 썼으면 하향 대신 리커버리로 간다 (§8·§9).
 * 하한 130에 닿은 경우도 횟수와 무관하게 즉시 리커버리다.
 */
function applyDownshiftOrRecovery(
  state: JudgeState,
  elapsedSec: number,
  reason: TargetAdjustedReason,
  events: RunEvent[],
): JudgeResult {
  if (state.downshiftCount >= MAX_DOWNSHIFT) {
    return enterRecovery(state, elapsedSec, 'downshift_exhausted', events);
  }

  const target = nextTarget(state);
  state.target = target;
  state.downshiftCount += 1;
  state.lastDownshiftSec = elapsedSec;
  state.slowFailCount = 0;
  state.lastFailSevere = false;
  state.deviation = null;
  state.walkStartedSec = null;
  state.cooldownStartedSec = null;
  state.phase = 'DOWNSHIFT';
  state.verdict = 'IN_RANGE';
  events.push({
    t: elapsedSec,
    type: 'TARGET_ADJUSTED',
    payload: { min: target.min, max: target.max, reason },
  });

  if (target.center <= DOWNSHIFT_FLOOR) {
    return enterRecovery(state, elapsedSec, 'floor_reached', events);
  }
  return { state, events };
}

/**
 * 하향폭 계산 (§8).
 * 걷기·정지 샘플을 median에서 빼는 것이 핵심이다 — 걷다 뛰다 반복하는 사용자의 중앙값이
 * 걷기 쪽으로 끌려가면 "걷는 것이 목표 달성"이 되어 판정이 무너진다.
 */
function nextTarget(state: JudgeState): TargetRange {
  const runSamples = state.recent
    .filter((sample) => sample.c > WALK_CADENCE_MAX)
    .map((sample) => sample.c);

  const currentCenter = state.target.center;
  const candidate =
    runSamples.length >= DOWNSHIFT_MEDIAN_MIN_SAMPLES
      ? (median(runSamples) ?? currentCenter - MAX_DOWNSHIFT_STEP)
      : currentCenter - MAX_DOWNSHIFT_STEP;

  // 한 번에 최대 −5. median이 아무리 낮아도 165 → 132처럼 무너지지 않는다.
  const stepped = Math.min(
    Math.max(Math.round(candidate), currentCenter - MAX_DOWNSHIFT_STEP),
    currentCenter,
  );
  const center = Math.max(stepped, DOWNSHIFT_FLOOR);

  return { center, min: center - TARGET_HALF_WIDTH, max: center + TARGET_HALF_WIDTH };
}

function enterRecovery(
  state: JudgeState,
  elapsedSec: number,
  reason: 'downshift_exhausted' | 'floor_reached',
  events: RunEvent[],
): JudgeResult {
  state.recovery = true;
  state.phase = 'RECOVERY';
  state.verdict = 'IN_RANGE';
  state.deviation = null;
  state.walkStartedSec = null;
  state.cooldownStartedSec = null;
  events.push({ t: elapsedSec, type: 'RECOVERY_MODE_ON', payload: { reason } });
  return { state, events };
}
