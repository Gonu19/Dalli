import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCreateReport, useRunDetail } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors } from '@/src/theme/tokens';

export default function Report() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result, setReport } = useRunResult();
  const local = params.runId ? null : result;
  const runId = params.runId ?? local?.uploaded?.id ?? null;
  const detail = useRunDetail(token, params.runId ?? null);
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
  const seconds = record?.durationSec ?? detail.data?.durationSec ?? 1800;
  const cadence = record?.avgCadence ?? detail.data?.avgCadence ?? 160;
  const pace = detail.data?.avgPaceSecPerKm ?? 455;
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
      <View style={styles.grid}>
        <Metric label="실제 러닝 시간" value={`${Math.round(seconds / 60)}`} unit="분" />
        <Metric label="목표 유지 비율" value="100" unit="%" />
        <Metric label="평균 케이던스" value={`${cadence ?? 160}`} unit="SPM" accent />
        <Metric label="평균 페이스" value={formatPace(pace)} />
      </View>
      <View style={styles.chart}>
        <Text style={styles.chartTitle}>변화 그래프</Text>
        <View style={styles.plot}>
          <View style={styles.yAxis} />
          <View style={styles.xAxis} />
          <Polyline color={colors.primary} points={[62, 62, 42, 79, 60, 50, 38, 48, 60]} />
          <Polyline color="#2196F3" points={[45, 45, 25, 70, 48, 31, 45, 57, 39]} />
          <Polyline color="#20DD2B" points={[125, 96, 104, 70, 70, 83, 55, 55, 25]} />
          <Text style={styles.axisText}>0        10        15        20        30       분</Text>
        </View>
        <View style={styles.legend}>
          <Legend color={colors.primary} label="케이던스 변화" />
          <Legend color="#2196F3" label="페이스 변화" />
          <Legend color="#20DD2B" label="목표 유지율" />
        </View>
      </View>
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
    <View style={styles.floatingActions}>
      <Pressable
        onPress={() => router.push({ pathname: '/run/ai', params: { runId: runId ?? '' } })}
        style={({ pressed }) => [styles.ai, pressed && styles.buttonPressed]}
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

function Polyline({ color, points }: { color: string; points: number[] }) {
  return <View style={StyleSheet.absoluteFill}>
    {points.slice(0, -1).map((point, index) => {
      const next = points[index + 1];
      const dx = 25;
      const dy = next - point;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return <View key={index} style={{ position: 'absolute', left: 22 + index * 25, top: 20 + point, width: length, height: 2, backgroundColor: color, transform: [{ rotate: `${angle}deg` }], transformOrigin: 'left center' }} />;
    })}
  </View>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendText}>{label}</Text>
  </View>;
}

function formatPace(value: number | null) {
  if (!value) return '—';
  return `${Math.floor(value / 60)}’${String(Math.round(value % 60)).padStart(2, '0')}”`;
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 23, alignSelf: 'center', color: colors.white, fontSize: 17, fontWeight: '700', zIndex: 10 },
  content: { paddingTop: 78, paddingHorizontal: 27, paddingBottom: 176 },
  title: { color: colors.white, fontSize: 22, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 22 },
  metric: { width: '47.5%', height: 94, borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 17 },
  metricLabel: { color: 'rgba(255,255,255,.68)', fontSize: 12 },
  metricRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 5, gap: 5 },
  metricValue: { color: colors.white, fontSize: 32, fontWeight: '700' },
  metricUnit: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  chart: { height: 307, borderRadius: 30, backgroundColor: colors.white, padding: 21, marginTop: 28 },
  chartTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  plot: { position: 'absolute', left: 21, right: 20, top: 62, height: 204, borderRadius: 30, backgroundColor: 'rgba(221,224,225,.3)', overflow: 'hidden' },
  yAxis: { position: 'absolute', left: 22, top: 18, bottom: 28, width: 1.5, backgroundColor: colors.ink },
  xAxis: { position: 'absolute', left: 22, right: 25, bottom: 28, height: 1.5, backgroundColor: colors.ink },
  axisText: { position: 'absolute', left: 19, right: 10, bottom: 8, fontSize: 11, color: colors.ink },
  legend: { position: 'absolute', left: 24, right: 10, bottom: 9, flexDirection: 'row', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: colors.ink },
  floatingActions: { position: 'absolute', left: 27, right: 27, bottom: 24, gap: 12 },
  ai: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 8 },
  home: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, backgroundColor: 'rgba(28,26,26,.92)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 8 },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
