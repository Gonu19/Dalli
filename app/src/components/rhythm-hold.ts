/**
 * 안정 구간(목표 리듬 범위 안에 있던 시간의 비율) 시계열.
 *
 * 판정 규칙은 `ENGINE.md` §12 Rhythm Score를 그대로 따른다.
 * - 목표 하향(`TARGET_ADJUSTED`) 이후 구간은 **그 시점의 새 범위**로 잰다.
 *   처음 목표로 전 구간을 재면 목표를 낮춰 잘 따라간 러닝이 실패로 보인다.
 * - **사용자가 누른 `PAUSE`~`RESUME` 구간만** 분모에서 뺀다. 신호대기처럼 그냥 멈춘 구간은 포함한다.
 *
 * 서버가 주는 `rhythm_score`는 러닝 전체의 단일 값이라 구간별 기복이 보이지 않는다.
 * 여기서는 같은 규칙으로 롤링 윈도우 비율을 만들어 "언제 흐트러졌는지"를 그린다.
 * 러닝 전체 값이 필요하면 서버 값을 쓴다. 이 함수로 대체하지 않는다.
 */

/** 롤링 윈도우 길이. 이보다 짧은 구간은 표본이 적어 0%·100%로만 튄다. */
export const HOLD_WINDOW_SEC = 60;

export type HoldPoint = { t: number; value: number };

/** 로컬 러닝(`RunRecord`)과 서버 상세(`RunDetail`)의 이벤트를 함께 받는 최소 형태. */
type TimedEvent = { t: number; type: string; payload?: Record<string, unknown> | null };

type TimedSample = { t: number; c: number };

type Range = { min: number; max: number };

type Interval = { start: number; end: number };

/** 두 샘플 사이의 한 구간. `inRange`는 그 구간을 끝맺은 샘플의 리듬으로 판정한다. */
type Segment = { start: number; end: number; weight: number; inRange: boolean };

export function toHoldSeries({
  samples,
  events,
  targetCadenceMin,
  targetCadenceMax,
  windowSec = HOLD_WINDOW_SEC,
}: {
  samples: readonly { t: number; c: number }[] | null | undefined;
  events: readonly TimedEvent[] | null | undefined;
  targetCadenceMin: number | null | undefined;
  targetCadenceMax: number | null | undefined;
  windowSec?: number;
}): HoldPoint[] {
  const initial = toRange(targetCadenceMin, targetCadenceMax);
  const points = toTimedSamples(samples);
  if (!initial || points.length < 2 || windowSec <= 0) return [];

  const segments = toSegments(points, initial, toAdjustments(events), toPauses(events));
  if (segments.length === 0) return [];

  return toRollingRatios(segments, windowSec);
}

/** 목표 범위. 최솟값이 최댓값보다 큰 값은 판정에 쓸 수 없어 버린다. */
function toRange(min: number | null | undefined, max: number | null | undefined): Range | null {
  return isFiniteNumber(min) && isFiniteNumber(max) && min <= max ? { min, max } : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimedSamples(samples: readonly { t: number; c: number }[] | null | undefined): TimedSample[] {
  if (!samples) return [];
  return samples
    .flatMap((sample) => (isFiniteNumber(sample.t) && isFiniteNumber(sample.c) ? [{ t: sample.t, c: sample.c }] : []))
    .sort((left, right) => left.t - right.t);
}

/** `TARGET_ADJUSTED` 이벤트에서 시각별 새 목표 범위를 뽑는다. 형태가 어긋난 payload는 무시한다. */
function toAdjustments(events: readonly TimedEvent[] | null | undefined): (Range & { t: number })[] {
  if (!events) return [];
  return events
    .flatMap((event) => {
      if (event.type !== 'TARGET_ADJUSTED' || !isFiniteNumber(event.t)) return [];
      const range = toRange(readNumber(event.payload, 'min'), readNumber(event.payload, 'max'));
      return range ? [{ t: event.t, ...range }] : [];
    })
    .sort((left, right) => left.t - right.t);
}

function readNumber(payload: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = payload?.[key];
  return isFiniteNumber(value) ? value : null;
}

/**
 * 사용자 pause 구간. `RESUME` 없이 러닝이 끝났으면 열린 채로 두고,
 * 이후 모든 구간을 분모에서 빼는 것으로 처리한다.
 */
function toPauses(events: readonly TimedEvent[] | null | undefined): Interval[] {
  if (!events) return [];
  const ordered = events.filter((event) => isFiniteNumber(event.t)).sort((left, right) => left.t - right.t);
  const pauses: Interval[] = [];
  let openedAt: number | null = null;

  for (const event of ordered) {
    if (event.type === 'PAUSE' && openedAt === null) openedAt = event.t;
    if (event.type === 'RESUME' && openedAt !== null) {
      if (event.t > openedAt) pauses.push({ start: openedAt, end: event.t });
      openedAt = null;
    }
  }
  return openedAt === null ? pauses : [...pauses, { start: openedAt, end: Number.POSITIVE_INFINITY }];
}

function toSegments(
  samples: readonly TimedSample[],
  initial: Range,
  adjustments: readonly (Range & { t: number })[],
  pauses: readonly Interval[],
): Segment[] {
  const segments: Segment[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const start = samples[index - 1].t;
    const end = samples[index].t;
    if (end <= start) continue;

    const middle = (start + end) / 2;
    if (pauses.some((pause) => middle >= pause.start && middle < pause.end)) continue;

    const range = rangeAt(middle, initial, adjustments);
    const cadence = samples[index].c;
    segments.push({ start, end, weight: end - start, inRange: cadence >= range.min && cadence <= range.max });
  }
  return segments;
}

/** 해당 시각에 유효한 목표 범위 = 그 시각 이전의 마지막 하향, 없으면 시작 목표. */
function rangeAt(time: number, initial: Range, adjustments: readonly (Range & { t: number })[]): Range {
  let current = initial;
  for (const adjustment of adjustments) {
    if (adjustment.t > time) break;
    current = { min: adjustment.min, max: adjustment.max };
  }
  return current;
}

/**
 * 각 구간 끝에서 직전 `windowSec` 동안의 비율을 낸다.
 * 윈도우가 다 차기 전에는 표본이 모자라 0%·100%로만 튀므로 그리지 않는다.
 */
function toRollingRatios(segments: readonly Segment[], windowSec: number): HoldPoint[] {
  const origin = segments[0].start;
  const ratios: HoldPoint[] = [];
  let first = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const now = segments[index].end;
    if (now - origin < windowSec) continue;

    const from = now - windowSec;
    while (first < index && segments[first].end <= from) first += 1;

    let held = 0;
    let total = 0;
    for (let cursor = first; cursor <= index; cursor += 1) {
      const segment = segments[cursor];
      const overlap = Math.min(segment.end, now) - Math.max(segment.start, from);
      if (overlap <= 0) continue;
      total += overlap;
      if (segment.inRange) held += overlap;
    }

    if (total > 0) ratios.push({ t: now, value: (held / total) * 100 });
  }
  return ratios;
}
