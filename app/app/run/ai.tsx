import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRunReport } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

export default function AIReport() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result } = useRunResult();
  const fetched = useRunReport(token, params.runId || null);
  const report = result?.report ?? fetched.data;
  const scrollY = useRef(new Animated.Value(0)).current;

  return <FigmaScreen>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {fetched.isLoading && !report ? <View style={styles.state}><Text style={styles.stateTitle}>리포트를 불러오는 중이에요</Text><Text style={styles.stateCopy}>분석 결과가 준비되면 바로 보여드릴게요.</Text></View> : null}
      {fetched.error && !report ? <View style={styles.state}><Text style={styles.stateTitle}>리포트를 불러오지 못했어요</Text><Text style={styles.stateCopy}>러닝 기록은 보존되어 있어요.</Text><Pressable onPress={() => void fetched.refetch()} style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}><Text style={styles.retryText}>다시 시도</Text></Pressable></View> : null}
      {report ? <>
        <View style={styles.verdict}><Text style={styles.orange}>{report.isFallback ? '기본 분석' : 'AI 한줄평'}</Text><Text style={styles.verdictText}>“{report.verdict}”</Text></View>
        {report.limitation ? <View style={styles.limitation}><Text style={styles.limitationTitle}>분석 안내</Text><Text style={styles.limitationText}>{report.limitation}</Text></View> : null}
        <View style={styles.fiTitle}><Text style={styles.fiLabel}>오늘의 부담</Text><Text style={styles.fiValue}>{fatigueLabel(report.metrics.fatigueIndex)}</Text></View>
        {report.metrics.fatigueIndex === null ? <Text style={styles.fiCopy}>분석할 데이터가 충분하지 않아 부담 정도를 표시하지 않아요.</Text> : null}
        <View style={styles.card}><Text style={styles.cardTitle}>분석 근거</Text>{report.evidence.slice(0,3).map((item)=><Text key={item} style={styles.evidence}>• {item}</Text>)}</View>
        {report.hypothesis ? <Card title="가능한 원인" body={report.hypothesis} /> : null}
        {report.prescription ? <Card orange title="다음 러닝 제안" body={report.prescription} /> : null}
        {report.recoveryNote ? <Card title="회복 안내" body={report.recoveryNote} /> : null}
        <View style={styles.next}><Text style={styles.nextTitle}>다음 목표</Text><Text style={styles.nextValue}>{report.nextGoalText}</Text><Text style={styles.nextMeta}>오늘의 리듬 {Math.round((report.nextTargetMin + report.nextTargetMax) / 2)} spm</Text></View>
      </> : null}
      <Pressable onPress={() => router.dismissTo('/')} style={({ pressed }) => [styles.home, pressed && styles.buttonPressed]}><Text style={styles.homeText}>홈으로 돌아가기</Text></Pressable>
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>AI 상세 리포트</Text>
  </FigmaScreen>;
}

function fatigueLabel(value: number | null) {
  if (value === null) return '—';
  if (value < 0.35) return '여유로움';
  if (value < 0.6) return '보통';
  return '부담됨';
}

function Card({ title, body, orange = false }: { title: string; body: string; orange?: boolean }) {
  return <View style={styles.card}><Text style={[styles.cardTitle, orange && { color: colors.primary }]}>{title}</Text><Text style={styles.cardBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  content: { minHeight: 890, paddingTop: 80 - navigationHeader.contentLift, paddingHorizontal: 25, paddingBottom: 30 },
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', zIndex: 10, color: colors.white, fontSize: 17, fontWeight: '700' },
  verdict: { height: 136, borderRadius: 30, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 21 },
  orange: { fontSize: 17, fontWeight: '700', color: colors.primary },
  verdictText: { fontSize: 20, fontWeight: '800', color: colors.white, marginTop: 15, lineHeight: 26 },
  state: { minHeight: 180, borderRadius: 28, backgroundColor: colors.white, padding: 24, justifyContent: 'center' },
  stateTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  stateCopy: { color: colors.inkMuted, fontSize: 13, marginTop: 9 },
  retry: { height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  retryText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  limitation: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 17, marginTop: 20 },
  limitationTitle: { color: colors.white, fontSize: 14, fontWeight: '700' },
  limitationText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  fiTitle: { marginTop: 29, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 7 },
  fiLabel: { color: colors.white, fontSize: 17, fontWeight: '700' },
  fiValue: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  fiCopy: { color: colors.textMuted, fontSize: 12, marginTop: 14, paddingHorizontal: 7 },
  card: { minHeight: 116, borderRadius: 28, backgroundColor: colors.white, marginTop: 29, padding: 22 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  cardBody: { fontSize: 15, color: colors.ink, lineHeight: 21, marginTop: 10 },
  evidence: { fontSize: 14, color: colors.ink, lineHeight: 20, marginTop: 8 },
  next: { height: 145, marginTop: 35, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 17 },
  nextTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  nextValue: { color: colors.white, fontSize: 28, fontWeight: '800', marginTop: 6 },
  nextMeta: { color: colors.white, fontSize: 12, marginTop: 7 },
  home: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 35 },
  buttonPressed: pressFeedback,
  homeText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
