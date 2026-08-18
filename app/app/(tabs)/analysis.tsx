import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { isOfflineError, type RunListItem } from '@/src/api/client';
import { useDeleteRun, useRuns } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaLogo } from '@/src/components/figma-ui';
import { Screen } from '@/src/components/screen';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors, compactPressFeedback, navigationHeader, pressFeedback } from '@/src/theme/tokens';

export default function Analysis() {
  const router = useRouter();
  const { token } = useAuth();
  const runs = useRuns(token);
  const remove = useDeleteRun(token);
  const scrollY = useRef(new Animated.Value(0)).current;
  const appRuns = runs.data?.filter((run) => run.source === 'APP') ?? [];

  const confirm = (run: RunListItem) => Alert.alert(
    '이 러닝을 삭제할까요?',
    '캘린더와 누적 활동일에서도 함께 사라져요.',
    [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => void remove.mutateAsync(run.id) },
    ],
  );

  const openDetail = (run: RunListItem) => {
    if (run.source !== 'APP') {
      Alert.alert('상세 분석을 지원하지 않는 기록이에요', '직접 추가한 기록은 러닝 시간만 확인할 수 있어요.');
      return;
    }
    router.push({ pathname: '/run/report', params: { runId: run.id } });
  };

  return <Screen includeBottomSafeArea={false} padded={false} scroll={false}>
    <View style={styles.frame}>
      <FigmaLogo left={24} />
      <Pressable onPress={() => router.push('/settings')} style={({ pressed }) => [styles.settings, pressed && styles.iconPressed]}>
        <Ionicons color={colors.white} name="settings-outline" size={26} />
      </Pressable>
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.section}>나의 총 러닝 분석</Text>
        {runs.isLoading
          ? <View style={styles.emptySummary}><Text style={styles.emptyText}>러닝 기록을 불러오는 중이에요</Text></View>
          : runs.error
            ? <Pressable onPress={() => void runs.refetch()} style={({ pressed }) => [styles.emptySummary, pressed && styles.buttonPressed]}><Text style={styles.emptyText}>{isOfflineError(runs.error) ? '오프라인 상태예요 · 다시 시도' : '기록을 불러오지 못했어요 · 다시 시도'}</Text></Pressable>
          : runs.data?.length === 0
          ? <View style={styles.emptySummary}><Text style={styles.emptyText}>아직 러닝 기록이 없어요</Text></View>
          : <View style={styles.summary}>
              <Summary value={String(appRuns.filter((run) => run.completed).length)} label="앱 완주 횟수" accent />
              <Summary value={String(appRuns.length)} label="앱 측정 러닝" />
              <Summary value={String(runs.data?.filter((run) => run.source === 'MANUAL').length ?? 0)} label="수기 기록" />
            </View>}
        <Text style={[styles.section, { marginTop: 28 }]}>러닝 분석</Text>
        {runs.data?.length === 0
          ? <View style={styles.empty}>
              <FigmaLogo top={83} left={119} />
              <Text style={styles.emptyLine}>첫 러닝을 완료하면 분석이 생겨요!</Text>
              <Text style={styles.emptyLine2}>달리와 함께 달려볼까요?</Text>
              <Pressable onPress={() => router.push('/')} style={({ pressed }) => [styles.prepare, pressed && styles.buttonPressed]}>
                <Text style={styles.prepareText}>러닝 준비하기</Text>
              </Pressable>
            </View>
          : runs.data?.map((run) => <Pressable
              key={run.id}
              onLongPress={() => confirm(run)}
              onPress={() => openDetail(run)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <Text style={styles.date}>{run.startedAt.slice(0, 10)}</Text>
              <Text style={styles.day}>{formatDay(run.startedAt)} 러닝</Text>
              <View style={[styles.sourceBadge, run.source === 'MANUAL' && styles.manualBadge]}>
                <Text style={styles.sourceBadgeText}>{run.source === 'MANUAL' ? '수기 기록' : '앱 측정'}</Text>
              </View>
              <Pressable
                accessibilityLabel="러닝 상세보기"
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  openDetail(run);
                }}
                style={({ pressed }) => [styles.detail, pressed && styles.detailPressed]}
              >
                <Text style={styles.detailText}>상세보기</Text>
              </Pressable>
              <View style={styles.line} />
              <View style={styles.metrics}>
                <Metric value={run.distanceM === null ? '—' : (run.distanceM / 1000).toFixed(2)} label="KM" />
                <Metric value={run.rhythmScore === null ? '—' : `${Math.round(run.rhythmScore * 100)}%`} label="안정 구간" />
                <Metric value={formatTime(run.durationSec)} label="시간" />
              </View>
            </Pressable>)}
      </Animated.ScrollView>
      <ScrollHeaderScrim scrollY={scrollY} />
    </View>
  </Screen>;
}

function Summary({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <View style={styles.summaryItem}>
    <Text style={[styles.summaryValue, accent && { color: colors.primary }]}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(new Date(value));
}

function formatTime(value: number) {
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  frame: { flex: 1, position: 'relative' },
  settings: { position: 'absolute', right: 25, top: navigationHeader.actionTop, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  iconPressed: compactPressFeedback,
  content: { paddingTop: 102 - navigationHeader.contentLift, paddingHorizontal: 27, paddingBottom: 40 },
  section: { color: colors.white, fontSize: 17, fontWeight: '700', marginLeft: 10 },
  summary: { height: 86, borderRadius: 20, backgroundColor: colors.white, marginTop: 15, flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: colors.ink },
  summaryLabel: { fontSize: 12, color: '#747474', marginTop: 6 },
  emptySummary: { height: 86, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', marginTop: 15, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#9A9A9A', fontSize: 15 },
  empty: { height: 439, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', marginTop: 15, position: 'relative' },
  emptyLine: { position: 'absolute', top: 176, alignSelf: 'center', color: '#9A9A9A', fontSize: 15 },
  emptyLine2: { position: 'absolute', top: 212, alignSelf: 'center', color: '#9A9A9A', fontSize: 15 },
  prepare: { position: 'absolute', left: 37, right: 39, top: 264, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,122,89,.85)', alignItems: 'center', justifyContent: 'center' },
  prepareText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  buttonPressed: pressFeedback,
  card: { height: 136, borderRadius: 20, backgroundColor: colors.white, marginTop: 13, padding: 26, position: 'relative' },
  cardPressed: pressFeedback,
  date: { fontSize: 13, fontWeight: '700', color: colors.ink },
  day: { fontSize: 13, color: '#747474', marginTop: 6 },
  sourceBadge: { position: 'absolute', right: 132, top: 20, height: 24, paddingHorizontal: 9, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  manualBadge: { backgroundColor: '#E9E9E9' },
  sourceBadgeText: { fontSize: 11, fontWeight: '700', color: colors.inkMuted },
  detail: { position: 'absolute', right: 26, top: 16, width: 93, height: 36, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  detailPressed: compactPressFeedback,
  detailText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  line: { position: 'absolute', left: 26, right: 26, top: 65, height: 1, backgroundColor: colors.border },
  metrics: { position: 'absolute', left: 26, right: 20, top: 77, flexDirection: 'row' },
  metric: { flex: 1 },
  metricValue: { fontSize: 17, fontWeight: '700', color: colors.ink },
  metricLabel: { fontSize: 13, color: '#747474', marginTop: 4 },
});
