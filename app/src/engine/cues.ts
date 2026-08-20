/**
 * 개입 문구 (`ENGINE.md` §7·§9, `PRODUCT.md` 톤).
 *
 * 순수 TS다 — 문구가 무엇인지는 엔진이 정하고, 어떻게 소리 내는지는 `native/`가 한다.
 * 음성은 **3초 이내 한 문장**이다. 길어지면 달리는 사람이 못 듣는다.
 */

import { SLOW_JUDGE_START_SEC } from './constants';
import type { RunEvent, TargetRange } from './types';

export type Cue = {
  /** 음성으로 읽을 한 문장. */
  text: string;
  /** 메트로놈을 함께 울릴지 — 리듬을 되찾는 개입에만 붙인다. */
  metronome: boolean;
  /**
   * 진동의 성격. 음성·메트로놈과 나란한 세 번째 채널이다.
   *
   * `impact`는 리듬을 고치라는 신호, `warning`은 상태가 바뀌었다는 알림이다.
   * 어떤 세기로 울릴지는 `native/`가 정한다 — 여기서는 무엇을 알릴지만 고른다.
   */
  haptic: 'impact' | 'warning';
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

/**
 * 5분 이전 저속 안내 (§5·§7).
 *
 * 같은 이탈이라도 초반에는 **재촉하지 않는다.** 아직 몸을 푸는 중일 수 있어서,
 * "처지고 있다"는 판단 대신 메트로놈으로 목표 리듬만 들려준다.
 */
const EARLY_SLOW_LINE = '목표 리듬을 들려드릴게요.';

/** 리커버리 안내는 세션에 한 번뿐이다. 실패로 들리지 않게 쓴다 (`ENGINE.md` §9). */
const RECOVERY_LINE = '지금은 회복이 우선이에요. 편하게 걸으셔도 괜찮아요.';

/**
 * 이벤트를 음성 문구로 옮긴다. 소리 낼 것이 없으면 `null`.
 *
 * `fastInterventionCount`는 이 이벤트를 포함한 누계다 (1회차면 1).
 */
export function cueForEvent(
  event: RunEvent,
  context: {
    fastInterventionCount: number;
    target: TargetRange;
    /** pause를 뺀 경과 초. 저속 문구가 초반·이후로 갈린다 (§5). */
    elapsedSec: number;
  },
): Cue | null {
  switch (event.type) {
    case 'TOO_FAST': {
      const line = FAST_LINES[Math.min(context.fastInterventionCount, FAST_LINES.length) - 1];
      return line === undefined ? null : { text: line, metronome: true, haptic: 'impact' };
    }
    case 'TOO_SLOW':
      return {
        text: context.elapsedSec < SLOW_JUDGE_START_SEC ? EARLY_SLOW_LINE : SLOW_LINE,
        metronome: true,
        haptic: 'impact',
      };
    case 'TARGET_ADJUSTED':
      // 중심값 하나만 말한다. 범위 숫자는 화면에도 음성에도 노출하지 않는다 (§3).
      return { text: `목표를 ${(event.payload.min + event.payload.max) / 2}로 낮췄어요`, metronome: false, haptic: 'impact' };
    case 'RECOVERY_MODE_ON':
      return { text: RECOVERY_LINE, metronome: false, haptic: 'warning' };
    default:
      // RUN_START·PAUSE·RESUME·RUN_END는 화면이 알리고 음성은 쓰지 않는다.
      return null;
  }
}
