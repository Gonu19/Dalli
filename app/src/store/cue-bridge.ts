/**
 * 판정 이벤트 → 개입 오디오 연결 (`ENGINE.md` §7).
 *
 * 러닝 화면에서 한 번 붙여두면 실러닝과 시뮬레이션 **양쪽 모두** 소리가 난다.
 * 판정은 이벤트만 내고 소리를 모른다. 그 사이를 잇는 곳이 여기다.
 *
 * `native/`를 import하므로 Node 검증 스크립트는 이 파일을 거치지 않는다.
 */

import { METRONOME_SEC, PACE_REMINDER_SEC } from '../engine/constants';
import { cueForEvent } from '../engine/cues';
import { playCue, playPaceReminder, stopCues } from '../native/cue-player';
import { useRunStore } from './runStore';

let detach: (() => void) | null = null;

/**
 * 화면이 붙기 전에 이미 들어와 있는 `RUN_START`까지 새 이벤트로 볼 시간(초).
 *
 * `startTrackedRun()`이 `RUN_START`를 넣고 나서 러닝 화면으로 넘어가므로, 붙는 시점에는
 * 이미 배열에 있다. 이 창 안에서만 처음부터 훑어 시작 안내가 빠지지 않게 한다.
 * 러닝 도중 화면을 다시 열었을 때는 다시 안내하지 않는다.
 */
const ATTACH_GRACE_SEC = 5;

/**
 * 이벤트 구독을 시작한다. 이미 붙어 있으면 그대로 둔다.
 * 반환값을 화면 정리 시점에 호출하면 음성·메트로놈이 멈춘다.
 */
export function attachCues(): () => void {
  if (detach !== null) return detach;

  const initial = useRunStore.getState();
  let lastCount = initial.activeSec < ATTACH_GRACE_SEC ? 0 : initial.events.length;
  /** 마지막 개입 시각. 이 값으로 주기 안내를 건너뛸지 정한다. */
  let lastCueSec = -PACE_REMINDER_SEC;
  let nextReminderSec = PACE_REMINDER_SEC;

  const unsubscribe = useRunStore.subscribe((state) => {
    if (state.events.length < lastCount) {
      // finish·reset으로 이벤트가 줄어든 경우까지 따라간다.
      lastCount = state.events.length;
      lastCueSec = -PACE_REMINDER_SEC;
      nextReminderSec = PACE_REMINDER_SEC;
      return;
    }

    if (state.events.length > lastCount) {
      const fresh = state.events.slice(lastCount);
      lastCount = state.events.length;

      // 개입 문구는 과속 회차에 따라 달라진다 (§7 표).
      const fastCount = state.events.filter((event) => event.type === 'TOO_FAST').length;

      for (const event of fresh) {
        const cue = cueForEvent(event, {
          fastInterventionCount: fastCount,
          target: state.target,
          // 판정과 같은 시간축(pause 제외)을 쓴다. 이벤트의 `t`는 전체 시간축이라 쓰지 않는다.
          elapsedSec: state.activeSec,
        });
        if (cue === null) continue;
        lastCueSec = state.activeSec;
        void playCue(cue, state.target.center);
      }
    }

    // 기준 리듬 주기 안내. pause 중에는 `activeSec`이 멈추므로 저절로 미뤄진다.
    if (state.activeSec < nextReminderSec) return;
    const windowStart = nextReminderSec - PACE_REMINDER_SEC;
    nextReminderSec += PACE_REMINDER_SEC;
    // 이번 주기에 개입이 있었으면 건너뛴다 (§7 쿨다운). 지적 직후에 또 울리지 않는다.
    // 경계는 열어 둔다 — 판정 tick이 5초라 개입이 60초 정확히 걸리는 일이 잦은데,
    // 닫아 두면 그 한 번이 두 주기를 연달아 죽인다.
    if (lastCueSec > windowStart) return;
    void playPaceReminder(state.target.center, METRONOME_SEC);
  });

  detach = () => {
    unsubscribe();
    stopCues();
    detach = null;
  };
  return detach;
}

export { configureCues } from '../native/cue-player';
