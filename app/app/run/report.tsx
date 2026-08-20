import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { isOfflineError, type RunDetail } from '@/src/api/client';
import { useCreateReport, useProfile, useRunDetail } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { LineChart, type ChartPoint, type ChartSeries } from '@/src/components/line-chart';
import { toHoldSeries } from '@/src/components/rhythm-hold';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { chart, colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

export default function Report() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result, setReport } = useRunResult();
  const local = params.runId ? null : result;
  const runId = params.runId ?? local?.uploaded?.id ?? null;
  const detail = useRunDetail(token, params.runId ?? null);
  const profile = useProfile(token);
  const create = useCreateReport(token);
  const requested = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const analysisUnavailable = params.runId
      ? detail.data !== undefined && (!detail.data.isAnalyzable || detail.data.source !== 'APP')
      : local?.uploaded !== null && local?.uploaded !== undefined && !local.uploaded.isAnalyzable;
    if (!runId || local?.report || detail.data?.report || requested.current || (params.runId && !detail.data) || analysisUnavailable) return;
    requested.current = true;
    create.mutateAsync(runId)
      .then((report) => {
        if (!params.runId) setReport(report);
      })
      .catch(() => undefined);
  }, [create, detail.data, local?.report, local?.uploaded, params.runId, runId, setReport]);

  const record = local?.record;
  const report = local?.report ?? detail.data?.report ?? create.data;
  const measuredBaseline = !local?.simulated && record?.measuredBaseline !== null && record?.measuredBaseline !== undefined
    ? record?.measuredBaseline
    : null;
  const header = params.runId ? '상세보기' : '러닝 리포트';
  const hasRunData = Boolean(record || detail.data);
  const samples = params.runId ? detail.data?.samples ?? null : record?.samples ?? null;
  const rhythmScore = params.runId
    ? detail.data?.rhythmScore ?? report?.metrics.rhythmScore ?? null
    : local?.uploaded?.rhythmScore ?? null;
  const seconds = params.runId
    ? detail.data?.activeDurationSec ?? null
    : local?.uploaded?.activeDurationSec ?? local?.activeDurationSec ?? null;
  const cadence = params.runId ? detail.data?.avgCadence ?? null : record?.avgCadence ?? null;
  const pace = params.runId ? detail.data?.avgPaceSecPerKm ?? null : record?.avgPaceSecPerKm ?? null;
  const events = params.runId ? detail.data?.events ?? null : record?.events ?? null;
  const targetCadenceMin = params.runId ? detail.data?.targetCadenceMin ?? null : record?.targetCadenceMin ?? null;
  const targetCadenceMax = params.runId ? detail.data?.targetCadenceMax ?? null : record?.targetCadenceMax ?? null;

  return <FigmaScreen>
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>{header}</Text>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>오늘의 기본 러닝 결과</Text>
      {params.runId && detail.isLoading ? <StatusCard title="러닝 기록을 불러오는 중이에요" body="서버에 저장된 측정값을 확인하고 있어요." /> : null}
      {params.runId && detail.error ? <StatusCard actionLabel="다시 시도" onAction={() => void detail.refetch()} title={isOfflineError(detail.error) ? '오프라인 상태예요' : '러닝 기록을 불러오지 못했어요'} body="기록은 보존되어 있어요. 연결을 확인한 뒤 다시 시도해 주세요." /> : null}
      {detail.data?.analysisLimitation ? <View style={styles.limitation}><Text style={styles.limitationTitle}>분석 안내</Text><Text style={styles.limitationText}>{formatAnalysisLimitation(detail.data.analysisLimitation)}</Text></View> : null}
      {!params.runId && !report && local?.uploaded?.analysisLimitation ? <View style={styles.limitation}><Text style={styles.limitationTitle}>분석 안내</Text><Text style={styles.limitationText}>{formatAnalysisLimitation(local.uploaded.analysisLimitation)}</Text></View> : null}
      {measuredBaseline !== null ? <View style={styles.baselineCard}>
        <Text style={styles.baselineTitle}>나의 기준 리듬을 찾았어요</Text>
        <Text style={styles.baselineValue}>{measuredBaseline} <Text style={styles.baselineUnit}>spm</Text></Text>
        <Text style={styles.baselineCopy}>현재 설정 {profile.data?.baselineCadence ?? '—'} spm · 다음 러닝부터 자동 적용돼요.</Text>
      </View> : null}
      {hasRunData ? <View style={styles.grid}>
        <Metric label="실제 러닝 시간" value={seconds === null ? '—' : `${Math.round(seconds / 60)}`} unit={seconds === null ? undefined : '분'} />
        <Metric label="안정 구간" value={formatPercent(rhythmScore)} unit={rhythmScore === null ? undefined : '%'} />
        <Metric label="평균 리듬" value={cadence === null ? '—' : `${Math.round(cadence)}`} unit={cadence === null ? undefined : 'spm'} accent />
        <Metric label="평균 페이스" value={formatPace(pace)} />
      </View> : null}
      {hasRunData ? <SampleGraphs samples={samples} events={events} targetCadenceMin={targetCadenceMin} targetCadenceMax={targetCadenceMax} rhythmScore={rhythmScore} /> : null}
      {create.isPending ? <Text style={styles.reportState}>AI 리포트를 만들고 있어요...</Text> : null}
      {create.error ? <Pressable onPress={() => runId && create.mutate(runId)} style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}><Text style={styles.retryText}>{isOfflineError(create.error) ? '연결 후 AI 리포트 다시 만들기' : 'AI 리포트 다시 만들기'}</Text></Pressable> : null}
    </Animated.ScrollView>
    <ScrollHeaderScrim opaque scrollY={scrollY} />
    <View style={styles.floatingActions}>
      <Pressable
        disabled={!report}
        onPress={() => router.push({ pathname: '/run/ai', params: { runId: runId ?? '' } })}
        style={({ pressed }) => [styles.ai, !report && styles.disabledButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>AI 상세 리포트 보기</Text>
      </Pressable>
      <Pressable
        onPress={() => router.dismissTo('/')}
        style={({ pressed }) => [styles.home, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>홈으로 돌아가기</Text>
      </Pressable>
    </View>
  </FigmaScreen>;
}

function Metric({ label, value, unit, accent = false }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <View style={styles.metricRow}>
      <Text style={[styles.metricValue, accent && { color: colors.primary }]}>{value}</Text>
      {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
    </View>
  </View>;
}

function formatPace(value: number | null) {
  if (value === null) return '—';
  return `${Math.floor(value / 60)}’${String(Math.round(value % 60)).padStart(2, '0')}”`;
}

function formatPercent(value: number | null) {
  return value === null ? '—' : String(Math.round(value * 100));
}

function formatAnalysisLimitation(value: NonNullable<RunDetail['analysisLimitation']>) {
  if (value === 'MANUAL_RUN') return '직접 기록한 러닝은 분석하지 않아요.';
  if (value === 'TOO_SHORT') return '러닝 시간이 짧아 분석할 수 없어요.';
  return '센서 데이터가 충분하지 않아 일부 지표를 표시하지 않아요.';
}

function StatusCard({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.stateCard}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{body}</Text>{actionLabel && onAction ? <Pressable onPress={onAction} style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}><Text style={styles.retryText}>{actionLabel}</Text></Pressable> : null}</View>;
}

type SeriesId = 'cadence' | 'pace' | 'hold';

type RunSampleLike = { t: number; c: number; p?: number | null };

/** 이 화면이 그리는 시리즈는 `SERIES_META`에 있는 셋으로 고정된다. */
type ReportSeries = ChartSeries & { id: SeriesId };

/**
 * 버튼과 선의 순서·색·단위를 한 곳에서 정한다.
 *
 * 문구는 `PRODUCT.md` §8-1 매핑표를 따른다 — 디자인의 `케이던스 변화`·`목표 유지율`은
 * 각각 `리듬 변화`·`안정 구간 변화`로 적는다 (`ENGINE.md` §12).
 */
const SERIES_META: readonly { id: SeriesId; label: string; unit: string; color: string }[] = [
  { id: 'cadence', label: '리듬 변화', unit: 'spm', color: chart.cadence },
  { id: 'pace', label: '페이스 변화', unit: 'min/km', color: chart.pace },
  { id: 'hold', label: '안정 구간 변화', unit: '%', color: chart.hold },
];

/**
 * 리듬·페이스·안정 구간을 한 그래프에 겹쳐 보여준다.
 *
 * 안정 구간은 서버가 시계열로 주지 않아 `toHoldSeries`로 만든다 (`ENGINE.md` §12 규칙 준수).
 * 러닝 전체 값은 서버 `rhythmScore`를 그대로 가로 점선으로 겹친다.
 * 롤링 윈도우의 마지막 점은 "최근 1분"이고 서버 값은 "러닝 전체"라 서로 다른 수이므로,
 * 끝값을 서버 값에 맞추지 않고 둘 다 그린다.
 */
function SampleGraphs({ samples, events, targetCadenceMin, targetCadenceMax, rhythmScore }: {
  samples: readonly RunSampleLike[] | null | undefined;
  events: readonly { t: number; type: string; payload?: Record<string, unknown> | null }[] | null | undefined;
  targetCadenceMin: number | null;
  targetCadenceMax: number | null;
  rhythmScore: number | null;
}) {
  const series = useMemo(() => toSeries({ samples, events, targetCadenceMin, targetCadenceMax, rhythmScore }), [events, rhythmScore, samples, targetCadenceMax, targetCadenceMin]);
  const [hidden, setHidden] = useState<ReadonlySet<SeriesId>>(() => new Set<SeriesId>());

  const available = series.filter((item) => item.points.length >= 2);
  const shown = available.filter((item) => !hidden.has(item.id));

  const toggle = (id: SeriesId) => setHidden((previous) => {
    // 마지막 한 개까지 끄면 빈 카드가 남는다. 켜진 것이 하나뿐이면 그 버튼은 동작하지 않는다.
    // 켜진 개수는 렌더 시점의 `shown`이 아니라 `previous`에서 센다. 빠르게 연달아 누르면
    // 두 번째 호출이 낡은 `shown`을 보고 가드를 지나쳐 전부 꺼진다.
    const shownCount = available.filter((item) => !previous.has(item.id)).length;
    if (!previous.has(id) && shownCount <= 1) return previous;
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  if (available.length === 0) {
    return <View style={styles.dataNotice}><Text style={styles.dataNoticeTitle}>변화 그래프</Text><Text style={styles.dataNoticeText}>실제 샘플이 없어 그래프를 표시하지 않아요.</Text></View>;
  }

  return <View style={styles.graphCard}>
    <Text style={styles.graphTitle}>변화 그래프</Text>
    <LineChart series={shown} />
    <View style={styles.toggleRow}>
      {SERIES_META.map((meta) => {
        const enabled = available.some((item) => item.id === meta.id);
        const selected = enabled && shown.some((item) => item.id === meta.id);
        return <Pressable
          key={meta.id}
          accessibilityRole="button"
          accessibilityState={{ disabled: !enabled, selected }}
          disabled={!enabled}
          onPress={() => toggle(meta.id)}
          style={({ pressed }) => [styles.toggle, !enabled && styles.disabledButton, pressed && styles.buttonPressed]}
        >
          <View style={[styles.toggleDot, { backgroundColor: meta.color }, !selected && styles.toggleOff]} />
          <Text style={[styles.toggleText, !selected && styles.toggleOff]}>{meta.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function toSeries({ samples, events, targetCadenceMin, targetCadenceMax, rhythmScore }: {
  samples: readonly RunSampleLike[] | null | undefined;
  events: readonly { t: number; type: string; payload?: Record<string, unknown> | null }[] | null | undefined;
  targetCadenceMin: number | null;
  targetCadenceMax: number | null;
  rhythmScore: number | null;
}): ReportSeries[] {
  const points: Record<SeriesId, ChartPoint[]> = {
    cadence: toChartPoints(samples, (sample) => sample.c),
    pace: toChartPoints(samples, (sample) => sample.p),
    hold: toHoldSeries({ samples, events, targetCadenceMin, targetCadenceMax }),
  };

  return SERIES_META.map((meta) => ({
    ...meta,
    points: points[meta.id],
    // 페이스 눈금은 초가 아니라 `7’35”`로 읽는다. 디자인의 단위 표기도 min/km다.
    ...(meta.id === 'pace' ? { formatValue: formatPace } : {}),
    // 안정 구간은 0~100%가 이미 정해진 축이라 자기 값 범위로 정규화하지 않는다.
    ...(meta.id === 'hold' ? { domain: { min: 0, max: 100 } } : {}),
    // 서버가 낸 러닝 전체 값. 오프라인이라 아직 없으면 기준선을 그리지 않는다.
    ...(meta.id === 'hold' && rhythmScore !== null ? { reference: { value: rhythmScore * 100, label: `러닝 전체 ${Math.round(rhythmScore * 100)}%` } } : {}),
  }));
}

function toChartPoints(samples: readonly RunSampleLike[] | null | undefined, readValue: (sample: RunSampleLike) => number | null | undefined): ChartPoint[] {
  if (!samples) return [];
  return samples.flatMap((sample) => {
    const time = Number(sample.t);
    const value = readValue(sample);
    return Number.isFinite(time) && typeof value === 'number' && Number.isFinite(value) ? [{ t: time, value }] : [];
  });
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', color: colors.white, fontSize: 17, fontWeight: '700', zIndex: 10 },
  content: { paddingTop: 78 - navigationHeader.contentLift, paddingHorizontal: 27, paddingBottom: 176 },
  title: { color: colors.white, fontSize: 22, fontWeight: '800' },
  baselineCard: { borderRadius: 24, backgroundColor: colors.white, marginTop: 20, padding: 20 },
  baselineTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  baselineValue: { color: colors.primary, fontSize: 32, fontWeight: '800', marginTop: 8 },
  baselineUnit: { color: colors.inkMuted, fontSize: 14 },
  baselineCopy: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 22 },
  metric: { width: '47.5%', height: 94, borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 17 },
  metricLabel: { color: 'rgba(255,255,255,.68)', fontSize: 12 },
  metricRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 5, gap: 5 },
  metricValue: { color: colors.white, fontSize: 32, fontWeight: '700' },
  metricUnit: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  dataNotice: { minHeight: 112, borderRadius: 24, backgroundColor: colors.white, padding: 21, marginTop: 28 },
  dataNoticeTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  graphTitle: { fontSize: 16.445, fontWeight: '700', color: colors.ink },
  dataNoticeText: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  graphCard: { borderRadius: 30, backgroundColor: colors.white, padding: 21, marginTop: 28 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 17, rowGap: 10, marginTop: 17 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  toggleDot: { width: 10, height: 10, borderRadius: 5 },
  toggleText: { color: colors.black, fontSize: 10 },
  /** 꺼진 시리즈. 디자인에 없는 상태라 같은 자리에서 흐리게만 둔다. */
  toggleOff: { opacity: 0.32 },
  stateCard: { minHeight: 112, borderRadius: 24, backgroundColor: colors.white, padding: 21, marginTop: 20 },
  stateTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  stateText: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  limitation: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 17, marginTop: 20 },
  limitationTitle: { color: colors.white, fontSize: 14, fontWeight: '700' },
  limitationText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  reportState: { color: colors.textMuted, fontSize: 13, marginTop: 18, textAlign: 'center' },
  retry: { height: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  retryText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  floatingActions: { position: 'absolute', left: 27, right: 27, bottom: 24, gap: 12 },
  ai: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 8 },
  home: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, backgroundColor: 'rgba(28,26,26,.92)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 8 },
  buttonPressed: pressFeedback,
  disabledButton: { opacity: 0.45 },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
