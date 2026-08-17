import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCreateReport, useProfile, useRunDetail, useRuns, useUpdateProfile } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
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
  const runs = useRuns(token);
  const updateProfile = useUpdateProfile(token);
  const create = useCreateReport(token);
  const requested = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!runId || local?.report || detail.data?.report || requested.current || (params.runId && !detail.data)) return;
    requested.current = true;
    create.mutateAsync(runId)
      .then((report) => {
        if (!params.runId) setReport(report);
      })
      .catch(() => undefined);
  }, [create, detail.data, local?.report, params.runId, runId, setReport]);

  const record = local?.record;
  const seconds = record?.durationSec ?? detail.data?.durationSec ?? null;
  const cadence = record?.avgCadence ?? detail.data?.avgCadence ?? null;
  const pace = record?.avgPaceSecPerKm ?? detail.data?.avgPaceSecPerKm ?? null;
  const rhythmScore = local?.uploaded?.rhythmScore ?? detail.data?.rhythmScore ?? null;
  const report = local?.report ?? detail.data?.report ?? create.data;
  const measuredBaseline = !local?.simulated && record?.measuredBaseline !== null
    && runs.data?.filter((run) => run.source === 'APP').length === 1
    ? record?.measuredBaseline
    : null;
  const shouldConfirmBaseline = measuredBaseline !== null
    && profile.data?.baselineCadence !== measuredBaseline;
  const header = params.runId ? '상세보기' : '러닝 리포트';

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
      {shouldConfirmBaseline ? <View style={styles.baselineCard}>
        <Text style={styles.baselineTitle}>나의 기준 리듬을 찾았어요</Text>
        <Text style={styles.baselineValue}>{measuredBaseline} <Text style={styles.baselineUnit}>spm</Text></Text>
        <Text style={styles.baselineCopy}>현재 설정 {profile.data?.baselineCadence ?? '—'} spm · 확인한 뒤 다음 러닝부터 적용해요.</Text>
        <Pressable
          disabled={updateProfile.isPending}
          onPress={() => updateProfile.mutate({ baselineCadence: measuredBaseline })}
          style={({ pressed }) => [styles.confirmBaseline, (pressed || updateProfile.isPending) && styles.buttonPressed]}
        >
          <Text style={styles.confirmBaselineText}>{updateProfile.isPending ? '저장 중...' : '이 리듬으로 확정하기'}</Text>
        </Pressable>
        {updateProfile.error ? <Text style={styles.inlineError}>저장하지 못했어요. 다시 눌러 주세요.</Text> : null}
      </View> : null}
      <View style={styles.grid}>
        <Metric label="실제 러닝 시간" value={seconds === null ? '—' : `${Math.round(seconds / 60)}`} unit={seconds === null ? undefined : '분'} />
        <Metric label="안정 구간" value={formatPercent(rhythmScore)} unit={rhythmScore === null ? undefined : '%'} />
        <Metric label="평균 리듬" value={cadence === null ? '—' : `${Math.round(cadence)}`} unit={cadence === null ? undefined : 'spm'} accent />
        <Metric label="평균 페이스" value={formatPace(pace)} />
      </View>
      <View style={styles.dataNotice}><Text style={styles.dataNoticeTitle}>변화 그래프</Text><Text style={styles.dataNoticeText}>실제 샘플 그래프는 준비 중이에요. 측정되지 않은 값은 표시하지 않아요.</Text></View>
      {create.isPending ? <Text style={styles.reportState}>AI 리포트를 만들고 있어요...</Text> : null}
      {create.error ? <Pressable onPress={() => runId && create.mutate(runId)} style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}><Text style={styles.retryText}>AI 리포트 다시 만들기</Text></Pressable> : null}
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
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
  if (!value) return '—';
  return `${Math.floor(value / 60)}’${String(Math.round(value % 60)).padStart(2, '0')}”`;
}

function formatPercent(value: number | null) {
  return value === null ? '—' : String(Math.round(value * 100));
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
  confirmBaseline: { height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  confirmBaselineText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  inlineError: { color: colors.danger, fontSize: 12, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 22 },
  metric: { width: '47.5%', height: 94, borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 17 },
  metricLabel: { color: 'rgba(255,255,255,.68)', fontSize: 12 },
  metricRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 5, gap: 5 },
  metricValue: { color: colors.white, fontSize: 32, fontWeight: '700' },
  metricUnit: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  dataNotice: { minHeight: 112, borderRadius: 24, backgroundColor: colors.white, padding: 21, marginTop: 28 },
  dataNoticeTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  dataNoticeText: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
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
