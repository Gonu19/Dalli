import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useProfile, useRuns } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaLogo } from '@/src/components/figma-ui';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import type { ConditionLevel } from '@/src/engine/types';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

const conditions: { level: ConditionLevel; label: string }[] = [
  { level: 'TIRED', label: '나쁨' },
  { level: 'NORMAL', label: '보통' },
  { level: 'LIGHT', label: '좋음' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const profile = useProfile(token);
  const runs = useRuns(token);
  const [condition, setCondition] = useState<ConditionLevel>('NORMAL');

  if (profile.isLoading) return <Screen includeBottomSafeArea={false}><StatePanel loading title="오늘의 러닝을 준비하고 있어요" body="케이던스를 불러오는 중이에요." /></Screen>;
  if (profile.error || !profile.data?.baselineCadence) return <Screen includeBottomSafeArea={false}><StatePanel title="러닝 준비 정보를 불러오지 못했어요" body="입력 내용은 보존되어 있어요." actionLabel="다시 시도" onAction={() => void profile.refetch()} /></Screen>;

  const cadence = profile.data.baselineCadence;
  const latest = runs.data?.[0];
  return <Screen includeBottomSafeArea={false} padded={false} scroll={false}>
    <View style={styles.frame}>
      <FigmaLogo left={31} />
      <Pressable accessibilityLabel="설정" onPress={() => router.push('/settings')} style={({ pressed }) => [styles.settings, pressed && styles.iconPressed]}>
        <Ionicons color={colors.white} name="settings-outline" size={26} />
      </Pressable>
      <Text style={styles.conditionTitle}>오늘의 컨디션</Text>
      <Text style={styles.conditionCopy}>컨디션에 맞춰 케이던스 목표 범위가 자동 조절됩니다.</Text>
      <View style={styles.conditions}>
        {conditions.map((item) => <Pressable key={item.level} onPress={() => setCondition(item.level)} style={({ pressed }) => [styles.condition, condition === item.level && styles.conditionOn, pressed && styles.buttonPressed]}>
          <View style={[styles.radio, condition === item.level && styles.radioOn]}>{condition === item.level ? <View style={styles.dot} /> : null}</View>
          <Text style={styles.conditionText}>{item.label}</Text>
        </Pressable>)}
      </View>
      <View style={styles.goal}>
        <Text style={styles.goalLabel}>오늘의 목표</Text>
        <Text style={styles.goalValue}><Text style={styles.accent}>60</Text>분 완주</Text>
        <Text style={styles.goalCadence}>목표 케이던스:  <Text style={styles.bold}>{cadence} SPM</Text></Text>
        <Text style={styles.quote}>“무리하게 속도를 내지 않아도 괜찮아요. 리듬을 유지해 보세요.”</Text>
      </View>
      <Pressable onPress={() => router.push({ pathname: '/run/prepare', params: { condition, cadence: String(cadence) } })} style={({ pressed }) => [styles.prepare, pressed && styles.buttonPressed]}>
        <Text style={styles.prepareText}>러닝 준비하기</Text>
      </Pressable>
      <View style={styles.report}>
        <Text style={styles.reportTitle}>최근 러닝 리포트</Text>
        <Text style={styles.reportDate}>{latest?.startedAt.slice(0, 10) ?? '첫 러닝을 기다리고 있어요'}</Text>
        <Text style={styles.reportValue}>{latest ? `${Math.round(latest.durationSec / 60)}분 ${latest.completed?'완주':'기록'}` : '러닝을 시작해 볼까요?'}</Text>
        <Text style={styles.reportCadence}>{latest?.avgCadence == null ? '—' : `${Math.round(latest.avgCadence)} spm`}</Text>
        <Text style={styles.reportMeta}>{latest?.rhythmScore == null ? '안정 구간 —' : `안정 구간 ${Math.round(latest.rhythmScore*100)}%`}</Text>
        <Pressable onPress={() => latest ? router.push({ pathname: '/run/report', params: { runId: latest.id } }) : router.push('/analysis')} style={({ pressed }) => [styles.detail, pressed && styles.buttonPressed]}>
          <Text style={styles.detailText}>상세 보기</Text>
        </Pressable>
      </View>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, position: 'relative' },
  settings: { position: 'absolute', right: 26, top: navigationHeader.actionTop, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconPressed: pressFeedback,
  conditionTitle: { position: 'absolute', left: 27, top: 112 - navigationHeader.contentLift, color: colors.white, fontSize: 17, fontWeight: '700' },
  conditionCopy: { position: 'absolute', left: 27, top: 139 - navigationHeader.contentLift, color: colors.white, fontSize: 13 },
  conditions: { position: 'absolute', left: 27, right: 28, top: 170 - navigationHeader.contentLift, flexDirection: 'row', gap: 14 },
  condition: { flex: 1, height: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  conditionOn: { borderColor: colors.primary },
  buttonPressed: pressFeedback,
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,.5)', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  conditionText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  goal: { position: 'absolute', left: 27, right: 28, top: 241 - navigationHeader.contentLift, height: 164, borderRadius: 28, backgroundColor: colors.white, padding: 22 },
  goalLabel: { fontSize: 17, fontWeight: '700', color: colors.ink },
  goalValue: { fontSize: 30, fontWeight: '800', color: colors.ink, marginTop: 14 },
  accent: { color: colors.primary },
  goalCadence: { fontSize: 13, color: colors.ink, marginTop: 5 },
  bold: { fontWeight: '800' },
  quote: { fontSize: 12, color: 'rgba(0,0,0,.58)', marginTop: 13 },
  prepare: { position: 'absolute', left: 27, right: 28, top: 430 - navigationHeader.contentLift, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  prepareText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  report: { position: 'absolute', left: 27, right: 28, top: 517 - navigationHeader.contentLift, height: 153, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(221,224,225,.3)', padding: 21 },
  reportTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  reportDate: { color: colors.white, fontSize: 13, marginTop: 5 },
  reportValue: { color: colors.white, fontSize: 28, fontWeight: '800', marginTop: 5 },
  reportCadence: { position: 'absolute', right: 19, top: 77, color: colors.white, fontSize: 17, fontWeight: '700' },
  reportMeta: { color: colors.white, fontSize: 12, marginTop: 5 },
  detail: { position: 'absolute', right: 15, top: 13, width: 84, height: 32, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(221,224,225,.3)', alignItems: 'center', justifyContent: 'center' },
  detailText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
