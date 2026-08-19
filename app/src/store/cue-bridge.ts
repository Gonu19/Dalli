/**
 * 판정 이벤트 → 개입 오디오 연결 (`ENGINE.md` §7).
 *
 * 러닝 화면에서 한 번 붙여두면 실러닝과 시뮬레이션 **양쪽 모두** 소리가 난다.
 * 판정은 이벤트만 내고 소리를 모른다. 그 사이를 잇는 곳이 여기다.
 *
 * `native/`를 import하므로 Node 검증 스크립트는 이 파일을 거치지 않는다.
 */

import { cueForEvent } from '../engine/cues';
import { playCue, stopCues } from '../native/cue-player';
import { useRunStore } from './runStore';

let detach: (() => void) | null = null;

/**
 * 이벤트 구독을 시작한다. 이미 붙어 있으면 그대로 둔다.
 * 반환값을 화면 정리 시점에 호출하면 음성·메트로놈이 멈춘다.
 */
export function attachCues(): () => void {
  if (detach !== null) return detach;

  let lastCount = useRunStore.getState().events.length;

  const unsubscribe = useRunStore.subscribe((state) => {
    if (state.events.length <= lastCount) {
      // finish·reset으로 이벤트가 줄어든 경우까지 따라간다.
      lastCount = state.events.length;
      return;
    }

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
      if (cue !== null) void playCue(cue, state.target.center);
    }
  });

  detach = () => {
    unsubscribe();
    stopCues();
    detach = null;
  };
  return detach;
}

export { configureCues } from '../native/cue-player';
