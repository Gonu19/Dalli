import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { chart, colors } from '@/src/theme/tokens';

export type ChartPoint = { t: number; value: number };

export type ChartSeries = {
  id: string;
  label: string;
  unit: string;
  color: string;
  points: readonly ChartPoint[];
  /** 백분율처럼 축이 이미 정해진 시리즈. 없으면 자기 최솟값~최댓값으로 정규화한다. */
  domain?: { min: number; max: number };
  /** 같은 색 가로 점선으로 겹쳐 그릴 기준값 (예: 러닝 전체 안정 구간). */
  reference?: { value: number; label: string };
  /** 눈금 숫자를 읽을 수 있게 바꾼다 (예: 페이스 455초 → `7'35"`). */
  formatValue?: (value: number) => string;
};

/** 그래프 판 안에서 축이 놓이는 자리 (`해커톤-박자단속반` 98:1155 기준). */
const AXIS_LEFT = 22.5;
const AXIS_BOTTOM = 175.5;
const PLOT_TOP = 18;
/** 오른쪽 끝에 `분`을 적을 자리. */
const UNIT_GAP = 32;
const TICK_FONT_SIZE = 9;
const TICK_BASELINE = 187;
const DOT_RADIUS = 2.5;
const STROKE_WIDTH = 2;
const TICK_COUNT = 5;
/**
 * 꼭짓점 개수. 디자인(98:1155)은 30분 러닝을 여덟 마디쯤으로 꺾어 그린다.
 *
 * 1초 샘플을 그대로 이으면 잔떨림이 털처럼 뭉쳐 꺾은선으로 읽히지 않는다.
 * 구간 평균으로 이만큼만 남겨서 흐름이 한눈에 보이게 한다.
 */
const MAX_VERTICES = 16;

/**
 * 여러 시리즈를 한 판에 겹쳐 그리는 꺾은선 그래프 (`해커톤-박자단속반` 98:1153).
 *
 * 시간축(x)은 시리즈끼리 공유하고, 값축(y)은 시리즈마다 따로 정규화한다.
 * 리듬(spm)·페이스(초/km)·안정 구간(%)은 단위가 서로 달라 축을 공유할 수 없다.
 * 그래서 **한 개만 켰을 때만** 값 눈금과 면 채우기를 보여준다. 여러 개가 겹친 상태에서
 * 눈금을 그리면 어느 선의 눈금인지 알 수 없다 — 디자인의 두 상태가 그대로 이 규칙이다.
 */
export function LineChart({ series }: { series: readonly ChartSeries[] }) {
  const [width, setWidth] = useState(0);
  const filtered = series.filter((item) => item.points.length >= 2);
  const drawable = filtered.map((item) => ({ ...item, points: downsample(item.points, MAX_VERTICES) }));
  const solo = drawable.length === 1 ? drawable[0] : null;

  // 시간축은 줄이기 전 원본으로 잡는다. 구간 평균의 마지막 꼭짓점을 끝으로 삼으면
  // 30분 러닝이 28분으로 보인다.
  const times = filtered.flatMap((item) => item.points.map((point) => point.t));
  const timeMin = times.length ? Math.min(...times) : 0;
  const timeSpan = times.length ? Math.max(...times) - timeMin : 0;
  // 값 눈금은 축 왼쪽에 적는다. `8’00”`처럼 긴 눈금이 잘리지 않도록 축을 그만큼 민다.
  const soloTicks = solo ? valueTicks(domainOf(solo)).map((tick) => (solo.formatValue ?? String)(tick)) : [];
  const axisLeft = Math.max(AXIS_LEFT, ...soloTicks.map((label) => label.length * TICK_FONT_SIZE * 0.62 + 8));
  const axisRight = Math.max(axisLeft + 1, width - UNIT_GAP);

  const toX = (time: number) => (timeSpan === 0 ? (axisLeft + axisRight) / 2 : axisLeft + ((time - timeMin) / timeSpan) * (axisRight - axisLeft));
  const toY = (value: number, domain: { min: number; max: number }) => {
    const span = domain.max - domain.min;
    const ratio = span === 0 ? 0.5 : (value - domain.min) / span;
    return AXIS_BOTTOM - ratio * (AXIS_BOTTOM - PLOT_TOP);
  };

  return <View style={styles.surface} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 ? <Svg width={width} height={chart.height}>
      {solo ? <Polygon
        points={`${toX(solo.points[0].t)},${AXIS_BOTTOM} ${solo.points.map((point) => `${toX(point.t)},${toY(point.value, domainOf(solo))}`).join(' ')} ${toX(solo.points[solo.points.length - 1].t)},${AXIS_BOTTOM}`}
        fill={solo.color}
        fillOpacity={chart.fillOpacity}
      /> : null}

      <Line x1={axisLeft} y1={PLOT_TOP} x2={axisLeft} y2={AXIS_BOTTOM} stroke={colors.ink} strokeWidth={1} />
      <Line x1={axisLeft} y1={AXIS_BOTTOM} x2={axisRight} y2={AXIS_BOTTOM} stroke={colors.ink} strokeWidth={1} />

      {drawable.flatMap((item) => {
        if (!item.reference) return [];
        const y = toY(item.reference.value, domainOf(item));
        // 라벨이 판 위로 잘리지 않게 선 바로 위, 최소 높이까지만 올린다.
        const labelY = Math.max(PLOT_TOP + TICK_FONT_SIZE, y - 5);
        return [
          <Line key={`${item.id}-reference`} x1={axisLeft} y1={y} x2={axisRight} y2={y} stroke={item.color} strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />,
          <SvgText key={`${item.id}-reference-label`} x={axisRight} y={labelY} fill={colors.inkMuted} fontSize={TICK_FONT_SIZE} textAnchor="end">{item.reference.label}</SvgText>,
        ];
      })}

      {drawable.map((item) => <Polyline
        key={item.id}
        points={item.points.map((point) => `${toX(point.t)},${toY(point.value, domainOf(item))}`).join(' ')}
        fill="none"
        stroke={item.color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />)}

      {drawable.flatMap((item) => item.points.map((point) => <Circle
        key={`${item.id}-${point.t}`}
        cx={toX(point.t)}
        cy={toY(point.value, domainOf(item))}
        r={DOT_RADIUS}
        fill={item.color}
      />))}

      {minuteTicks(timeMin, timeMin + timeSpan).map((tick) => <SvgText
        key={`x-${tick}`}
        x={toX(timeMin + tick * 60)}
        y={TICK_BASELINE}
        fill={colors.ink}
        fontSize={TICK_FONT_SIZE}
        textAnchor="middle"
      >{String(tick)}</SvgText>)}
      <SvgText x={axisRight + 12} y={TICK_BASELINE} fill={colors.ink} fontSize={TICK_FONT_SIZE}>분</SvgText>

      {solo ? valueTicks(domainOf(solo)).map((tick) => <SvgText
        key={`y-${tick}`}
        x={axisLeft - 4}
        y={toY(tick, domainOf(solo)) + TICK_FONT_SIZE / 3}
        fill={colors.ink}
        fontSize={TICK_FONT_SIZE}
        textAnchor="end"
      >{(solo.formatValue ?? String)(tick)}</SvgText>) : null}
      {solo ? <SvgText x={axisLeft + 3} y={PLOT_TOP - 5} fill={colors.inkMuted} fontSize={TICK_FONT_SIZE}>{solo.unit}</SvgText> : null}
    </Svg> : null}
  </View>;
}

/** 고정 축을 준 시리즈는 그대로 쓰고, 나머지는 자기 값 범위로 정규화한다. */
function domainOf(series: { points: readonly ChartPoint[]; domain?: { min: number; max: number } }): { min: number; max: number } {
  if (series.domain) return series.domain;
  const values = series.points.map((point) => point.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * 점이 너무 많으면 구간 평균으로 줄인다.
 * 값을 버리지 않고 평균으로 접어서, 줄인 뒤에도 흐름과 눈금이 서로 어긋나지 않게 한다.
 */
function downsample(points: readonly ChartPoint[], limit: number): ChartPoint[] {
  if (points.length <= limit) return [...points];
  const size = points.length / limit;
  const folded: ChartPoint[] = [];
  for (let index = 0; index < limit; index += 1) {
    const bucket = points.slice(Math.floor(index * size), Math.max(Math.floor((index + 1) * size), Math.floor(index * size) + 1));
    const sum = bucket.reduce((total, point) => ({ t: total.t + point.t, value: total.value + point.value }), { t: 0, value: 0 });
    folded.push({ t: sum.t / bucket.length, value: sum.value / bucket.length });
  }
  return folded;
}

/** x축은 분 단위로 읽는다. 시작과 끝을 포함해 고르게 나눈 뒤 같은 숫자는 접는다. */
function minuteTicks(from: number, to: number): number[] {
  const total = Math.max(0, (to - from) / 60);
  const raw = Array.from({ length: TICK_COUNT }, (_, index) => Math.round((total * index) / (TICK_COUNT - 1)));
  return [...new Set(raw)];
}

function valueTicks(domain: { min: number; max: number }): number[] {
  if (domain.max === domain.min) return [domain.min];
  const raw = Array.from({ length: TICK_COUNT }, (_, index) => domain.min + ((domain.max - domain.min) * index) / (TICK_COUNT - 1));
  return [...new Set(raw.map((value) => Math.round(value)))];
}

const styles = StyleSheet.create({
  surface: { height: chart.height, marginTop: 14, borderRadius: chart.surfaceRadius, backgroundColor: chart.surface, overflow: 'hidden' },
});
