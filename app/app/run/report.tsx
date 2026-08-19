import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { isOfflineError, type RunDetail } from '@/src/api/client';
import { useCreateReport, useProfile, useRunDetail } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

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
      {hasRunData ? <SampleGraphs samples={samples} /> : null}
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

type ChartPoint = { key: string; value: number };

function SampleGraphs({ samples }: { samples: readonly { t: number; c: number; p?: number | null }[] | null | undefined }) {
  const cadence = toChartPoints(samples, (sample) => sample.c);
  const pace = toChartPoints(samples, (sample) => sample.p);
  if (!samples || samples.length === 0 || (cadence.length === 0 && pace.length === 0)) {
    return <View style={styles.dataNotice}><Text style={styles.dataNoticeTitle}>변화 그래프</Text><Text style={styles.dataNoticeText}>실제 샘플이 없어 그래프를 표시하지 않아요.</Text></View>;
  }
  return <View style={styles.graphCard}>
    <Text style={styles.dataNoticeTitle}>변화 그래프</Text>
    {cadence.length ? <SampleChart points={cadence} title="리듬" unit="spm" /> : <Text style={styles.dataNoticeText}>리듬 샘플이 없어 표시하지 않아요.</Text>}
    {pace.length ? <SampleChart points={pace} title="페이스" unit="초/km" /> : <Text style={styles.dataNoticeText}>페이스 샘플이 없어 표시하지 않아요.</Text>}
  </View>;
}

function toChartPoints<T extends { t: number }>(samples: readonly T[] | null | undefined, readValue: (sample: T) => number | null | undefined): ChartPoint[] {
  if (!samples) return [];
  return samples.flatMap((sample, index) => {
    const time = Number(sample.t);
    const value = readValue(sample);
    return Number.isFinite(time) && typeof value === 'number' && Number.isFinite(value)
      ? [{ key: `${time}-${index}`, value }]
      : [];
  });
}

function SampleChart({ points, title, unit }: { points: ChartPoint[]; title: string; unit: string }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return <View style={styles.chartBlock}><View style={styles.chartHeader}><Text style={styles.chartTitle}>{title}</Text><Text style={styles.chartUnit}>{unit}</Text></View><View style={styles.chart}><View style={styles.chartZero} />{points.map((point) => <View key={point.key} style={[styles.chartBar, { height: `${range === 0 ? 50 : 12 + ((point.value - min) / range) * 88}%` }]} />)}</View></View>;
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
  dataNoticeText: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  graphCard: { borderRadius: 24, backgroundColor: colors.white, padding: 21, marginTop: 28 },
  chartBlock: { marginTop: 18 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  chartUnit: { color: colors.inkMuted, fontSize: 12 },
  chart: { height: 96, marginTop: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 2, overflow: 'hidden', position: 'relative' },
  chartZero: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.border },
  chartBar: { flex: 1, minWidth: 1, maxWidth: 5, borderRadius: 2, backgroundColor: colors.primary },
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
