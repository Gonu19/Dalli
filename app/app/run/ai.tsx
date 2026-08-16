import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRunReport } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors } from '@/src/theme/tokens';

export default function AIReport() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result } = useRunResult();
  const fetched = useRunReport(token, params.runId || null);
  const report = result?.report ?? fetched.data;
  const verdict = report?.verdict ?? '초반 과속 없이 완벽한 리듬으로 완주한 러닝이에요!';
  const fi = Math.round((report?.metrics.fatigueIndex ?? 0.2) * 100);
  const scrollY = useRef(new Animated.Value(0)).current;

  return <FigmaScreen>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.verdict}><Text style={styles.orange}>AI 한줄평</Text><Text style={styles.verdictText}>“{verdict}”</Text></View>
      <View style={styles.fiTitle}><Text style={styles.fiLabel}>피로도 지수 (FI)</Text><Text style={styles.fiValue}>{fi} %</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, fi)}%` }]} /></View>
      <Text style={styles.fiCopy}>피로 누적이 적고 몸에 무리가 거의 없는 매우 안정적인 상태입니다</Text>
      <Card title="💡 인과 가설 분석" body={report?.hypothesis ?? '설정한 목표 케이던스를 안정적으로 유지하여 신체 피로 누적이 매우 적었습니다.'} />
      <Card orange title="♧ 다음 러닝 처방" body={report?.prescription ?? '현재 리듬이 아주 좋습니다! 다음 러닝에는 같은 케이던스로 시간을 2분 늘려보는 것을 추천합니다.'} />
      <View style={styles.next}><Text style={styles.nextTitle}>AI 추천 다음 목표</Text><Text style={styles.nextValue}>{report?.nextGoalText ?? '32분 완주'}</Text><Text style={styles.nextMeta}>목표 케이던스: {report ? Math.round((report.nextTargetMin + report.nextTargetMax) / 2) : 160} SPM</Text></View>
      <Pressable onPress={() => router.dismissTo('/')} style={({ pressed }) => [styles.home, pressed && styles.buttonPressed]}><Text style={styles.homeText}>홈으로 돌아가기</Text></Pressable>
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>AI 상세 리포트</Text>
  </FigmaScreen>;
}

function Card({ title, body, orange = false }: { title: string; body: string; orange?: boolean }) {
  return <View style={styles.card}><Text style={[styles.cardTitle, orange && { color: colors.primary }]}>{title}</Text><Text style={styles.cardBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  content: { minHeight: 890, paddingTop: 80, paddingHorizontal: 25, paddingBottom: 30 },
  header: { position: 'absolute', top: 23, alignSelf: 'center', zIndex: 10, color: colors.white, fontSize: 17, fontWeight: '700' },
  verdict: { height: 136, borderRadius: 30, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 21 },
  orange: { fontSize: 17, fontWeight: '700', color: colors.primary },
  verdictText: { fontSize: 20, fontWeight: '800', color: colors.white, marginTop: 15, lineHeight: 26 },
  fiTitle: { marginTop: 29, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 7 },
  fiLabel: { color: colors.white, fontSize: 17, fontWeight: '700' },
  fiValue: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  track: { height: 14, borderRadius: 7, backgroundColor: colors.border, marginHorizontal: 6, marginTop: 11, overflow: 'hidden' },
  fill: { height: 14, borderRadius: 7, backgroundColor: colors.primary },
  fiCopy: { color: colors.textMuted, fontSize: 12, marginTop: 14, paddingHorizontal: 7 },
  card: { minHeight: 116, borderRadius: 28, backgroundColor: colors.white, marginTop: 29, padding: 22 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  cardBody: { fontSize: 15, color: colors.ink, lineHeight: 21, marginTop: 10 },
  next: { height: 145, marginTop: 35, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 17 },
  nextTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  nextValue: { color: colors.white, fontSize: 28, fontWeight: '800', marginTop: 6 },
  nextMeta: { color: colors.white, fontSize: 12, marginTop: 7 },
  home: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 35 },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  homeText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
