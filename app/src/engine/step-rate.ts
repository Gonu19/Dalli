/**
 * 누적 걸음 → SPM (`ENGINE.md` §4).
 *
 * iOS는 걸음을 **묶어서** 올려보낸다. 3초 조용하다가 한 번에 5걸음이 들어오는 식이라
 * 1초 차분으로 SPM을 만들면 `0, 0, 300, 0, 0, 240 …`처럼 튀고, 그 값을 20초 중앙값에
 * 넣으면 절반 이상이 0이라 **중앙값이 0으로 내려앉는다.** 걷고 있는데 화면이 0을 가리킨다.
 *
 * 그래서 최근 구간의 **누적 증가분**을 구간 길이로 나눈다. 배치로 들어와도 구간 합은
 * 같으므로 값이 안정적이다. 순수 함수라 센서 없이 검증한다.
 */

export type StepPoint = { atMs: number; steps: number };

/**
 * 이력에 점을 추가하고 구간 밖을 버린다.
 *
 * 구간을 덮는 **가장 오래된 점 하나는 남긴다.** 그걸 버리면 분모가 짧아져
 * 방금 들어온 배치가 그대로 순간값으로 튀어나온다.
 */
export function updateStepHistory(
  history: readonly StepPoint[],
  point: StepPoint,
  windowSec: number,
): StepPoint[] {
  const next = [...history, point];
  const cutoff = point.atMs - windowSec * 1000;

  while (next.length > 2 && next[1].atMs <= cutoff) {
    next.shift();
  }
  return next;
}

/** 이력의 처음과 끝으로 SPM을 낸다. 점이 하나뿐이거나 시간이 안 흘렀으면 0. */
export function rollingCadenceSpm(history: readonly StepPoint[]): number {
  if (history.length < 2) return 0;

  const oldest = history[0];
  const latest = history[history.length - 1];
  const spanSec = (latest.atMs - oldest.atMs) / 1000;
  if (spanSec <= 0) return 0;

  return (Math.max(0, latest.steps - oldest.steps) / spanSec) * 60;
}
