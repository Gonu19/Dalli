import type { RunReport } from './client';

/**
 * 리포트 문장 방어막.
 *
 * 서버가 규칙을 어긴 문장을 보내도 화면은 최소한을 지킨다. 실제로 운영에서
 * `verdict`에 `"completed"`가 그대로 나왔고, `next_goal_text`가 목표 리듬을
 * **범위로** 노출했다 (`PRODUCT.md` §8-2 · `ENGINE.md` §3 위반).
 *
 * 고쳐 쓸 수 있는 이유는 **숫자가 따로 오기 때문**이다. `next_target_min/max`와
 * `metrics`는 서버가 계산한 값이라, 문장이 깨져도 그 값으로 올바른 문장을 다시 만든다.
 * 없는 사실을 지어내지 않는다 — 서버가 준 숫자만 쓴다.
 *
 * ## 서버 검증이 들어와도 남긴다
 *
 * 이건 임시방편이 아니다. 외부 모델이 만든 문장을 그대로 화면에 태우는 이상,
 * 앱은 언제나 최소 방어를 해야 한다. 다만 **개발 빌드에서는 경고를 남겨**
 * 서버가 규칙을 어긴 사실 자체가 묻히지 않게 한다.
 */

/** 이 단어만 덩그러니 오면 문장이 아니라 필드값이 새어 나온 것이다. */
const LEAKED_VALUES = new Set(['completed', 'true', 'false', 'null', 'none', 'n/a', 'verdict', '-']);
/** 한국어 한 문장으로 보기 어려운 길이. */
const MIN_VERDICT_LENGTH = 6;
/**
 * `136에서 144`, `136~144`, `136 - 144` — 목표 리듬을 범위로 드러낸 표현.
 * **연결어 안의 공백까지 허용한다.** 실제로 모델이 `136에 서 144`처럼 띄어 썼다.
 */
const RANGE_PATTERN = /(\d{2,3})\s*(?:에\s*서|부\s*터|~|-|–|—)\s*(\d{2,3})/;
/** 리듬으로 볼 수 있는 값의 범위. `140과 24분`처럼 무관한 두 숫자를 범위로 오인하지 않는다. */
const CADENCE_MIN = 100;
const CADENCE_MAX = 220;
/** `548초`처럼 분으로 읽어야 할 값. */
const SECONDS_PATTERN = /(\d+)\s*초/g;
/** 이 아래는 `7분 35초`처럼 분과 함께 쓰는 초라 그대로 둔다. */
const SECONDS_TO_MINUTES_FROM = 60;

function warn(field: string, value: string): void {
  if (__DEV__) console.warn(`[report] 서버 문장이 규칙을 어겨 화면에서 고쳐 씁니다 — ${field}: ${value}`);
}

/** 한줄평. 필드값이 새어 나왔거나 문장이 아니면 서버 지표로 다시 쓴다. */
export function safeVerdict(report: RunReport): string {
  const verdict = report.verdict.trim();
  const leaked = LEAKED_VALUES.has(verdict.toLowerCase());
  if (!leaked && verdict.length >= MIN_VERDICT_LENGTH) return verdict;

  warn('verdict', verdict);
  const score = report.metrics.rhythmScore;
  return score === null
    ? '이번 러닝 기록을 정리했어요.'
    : `목표 리듬을 안정 구간 ${Math.round(score * 100)}%로 지킨 러닝이에요.`;
}

/**
 * 다음 목표. 범위가 드러나면 **중심값 한 개 문장**으로 갈아 쓴다.
 * 숫자는 서버가 준 `next_target_min/max`의 중심값이다 (`ENGINE.md` §3).
 */
export function safeNextGoalText(report: RunReport): string {
  const text = report.nextGoalText.trim();
  if (!exposesRange(text)) return text;

  warn('nextGoalText', text);
  const center = Math.round((report.nextTargetMin + report.nextTargetMax) / 2);
  return `다음 러닝은 리듬 ${center}에 맞춰 달려볼까요?`;
}

/** 두 숫자가 실제로 리듬 범위를 이루는지. 둘 다 리듬 값이고 앞이 작아야 범위로 본다. */
function exposesRange(text: string): boolean {
  const matched = RANGE_PATTERN.exec(text);
  if (matched === null) return false;
  const low = Number(matched[1]);
  const high = Number(matched[2]);
  return low >= CADENCE_MIN && high <= CADENCE_MAX && low < high;
}

/** 분석 근거. 60초 이상을 초로만 적은 값을 분으로 바꿔 읽히게 한다. */
export function safeEvidence(report: RunReport): string[] {
  return report.evidence.map((item) => item.replace(SECONDS_PATTERN, (match, digits: string) => {
    const seconds = Number(digits);
    if (!Number.isFinite(seconds) || seconds < SECONDS_TO_MINUTES_FROM) return match;
    warn('evidence', match);
    return `약 ${Math.round(seconds / 60)}분`;
  }));
}
