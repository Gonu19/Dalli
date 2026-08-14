/** 엔진 공용 수치 유틸. 순수 함수만 둔다. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * 중앙값. 평균이 아니라 중앙값을 쓰는 이유는 튀는 값에 덜 흔들리기 때문이다
 * (`ENGINE.md` §12). 짝수 개면 가운데 두 값의 평균.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
