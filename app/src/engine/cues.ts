/**
 * 개입 문구 (`ENGINE.md` §7·§9, `PRODUCT.md` 톤).
 *
 * 순수 TS다 — 문구가 무엇인지는 엔진이 정하고, 어떻게 소리 내는지는 `native/`가 한다.
 * 음성은 **3초 이내 한 문장**이다. 길어지면 달리는 사람이 못 듣는다.
 */

import type { RunEvent, TargetRange } from './types';

export type Cue = {
  /** 음성으로 읽을 한 문장. */
  text: string;
  /** 메트로놈을 함께 울릴지 — 리듬을 되찾는 개입에만 붙인다. */
  metronome: boolean;
};

/**
 * `TOO_FAST`는 회차별로 문구가 다르고 2회 뒤에는 세션 내내 침묵한다.
 * 판정이 이미 2회로 막고 있으므로 여기서는 문구만 고른다.
 */
const FAST_LINES = [
  '지금 리듬이 조금 빠릅니다. 보폭을 줄이고 편하게 달려볼까요?',
  '조금만 천천히 가도 괜찮아요.',
];

const SLOW_LINE = '리듬이 조금 처지고 있어요. 지금 속도를 유지해 볼까요?';

/** 리커버리 안내는 세션에 한 번뿐이다. 실패로 들리지 않게 쓴다 (`ENGINE.md` §9). */
const RECOVERY_LINE = '지금은 회복이 우선이에요. 편하게 걸으셔도 괜찮아요.';

/**
 * 이벤트를 음성 문구로 옮긴다. 소리 낼 것이 없으면 `null`.
 *
 * `fastInterventionCount`는 이 이벤트를 포함한 누계다 (1회차면 1).
 */
export function cueForEvent(
  event: RunEvent,
  context: { fastInterventionCount: number; target: TargetRange },
): Cue | null {
  switch (event.type) {
    case 'TOO_FAST': {
      const line = FAST_LINES[Math.min(context.fastInterventionCount, FAST_LINES.length) - 1];
      return line === undefined ? null : { text: line, metronome: true };
    }
    case 'TOO_SLOW':
      return { text: SLOW_LINE, metronome: true };
    case 'TARGET_ADJUSTED':
      // 중심값 하나만 말한다. 범위 숫자는 화면에도 음성에도 노출하지 않는다 (§3).
      return { text: `목표를 ${(event.payload.min + event.payload.max) / 2}로 낮췄어요`, metronome: false };
    case 'RECOVERY_MODE_ON':
      return { text: RECOVERY_LINE, metronome: false };
    default:
      // RUN_START·PAUSE·RESUME·RUN_END는 화면이 알리고 음성은 쓰지 않는다.
      return null;
  }
}
