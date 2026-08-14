import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useProfile, useStats } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { ChoiceCard } from '@/src/components/choice-card';
import { usePreferences } from '@/src/components/preferences-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { CONDITION_VALUE } from '@/src/engine/constants';
import type { ConditionLevel } from '@/src/engine/types';
import { useRunStore, type RunGoal } from '@/src/store/runStore';
import { useSimulationStore } from '@/src/store/simulation';
import { colors, radius, shadows, spacing, typography } from '@/src/theme/tokens';

const conditions: { level: ConditionLevel; label: string }[] = [
  { level: 'LIGHT', label: '가벼움' },
  { level: 'NORMAL', label: '보통' },
  { level: 'TIRED', label: '피곤함' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const profile = useProfile(token);
  const stats = useStats(token);
  const startRun = useRunStore((state) => state.start);
  const startSimulation = useSimulationStore((state) => state.start);
  const [goalType, setGoalType] = useState<RunGoal['type']>('TIME');
  const [goalValue, setGoalValue] = useState(20 * 60);
  const [condition, setCondition] = useState<ConditionLevel>('NORMAL');
  const { voiceEnabled, metronomeEnabled, setVoiceEnabled, setMetronomeEnabled } = usePreferences();

  if (profile.isLoading) {
    return <Screen><StatePanel loading title="오늘의 러닝을 준비하고 있어요" body="나의 기준 리듬을 불러오는 중이에요." /></Screen>;
  }

  if (profile.error || !profile.data?.baselineCadence) {
    return (
      <Screen>
        <StatePanel
          title="러닝 준비 정보를 불러오지 못했어요"
          body="입력 내용은 보존되어 있어요. 연결을 확인하고 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  const referenceCadence = profile.data.baselineCadence;
  const begin = () => {
    startRun({
      referenceCadence,
      condition: CONDITION_VALUE[condition],
      goal: { type: goalType, value: goalValue },
    });
    router.push('/run/active');
  };

  const simulate = () => {
    startSimulation({ referenceCadence, condition: CONDITION_VALUE[condition], speed: 10 });
    router.push('/run/active');
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>오늘의 달리</Text>
        <Text style={styles.title}>오늘의 리듬을 시작해 볼까요?</Text>
      </View>

      <View style={styles.rhythmCard}>
        <Text style={styles.label}>나의 기준 리듬</Text>
        <Text style={styles.cadence}>{referenceCadence} <Text style={styles.unit}>spm</Text></Text>
        <Text style={styles.description}>러닝을 시작하면 컨디션을 반영한 오늘의 리듬을 안내해요.</Text>
      </View>

      <Section title="오늘의 목표">
        <View style={styles.row}>
          <View style={styles.flex}><ChoiceCard label="시간" selected={goalType === 'TIME'} onPress={() => { setGoalType('TIME'); setGoalValue(20 * 60); }} /></View>
          <View style={styles.flex}><ChoiceCard label="거리" selected={goalType === 'DISTANCE'} onPress={() => { setGoalType('DISTANCE'); setGoalValue(3000); }} /></View>
        </View>
        <View style={styles.row}>
          {(goalType === 'TIME' ? [10, 20, 30] : [1, 3, 5]).map((value) => {
            const stored = goalType === 'TIME' ? value * 60 : value * 1000;
            return (
              <View key={value} style={styles.flex}>
                <ChoiceCard
                  label={`${value}${goalType === 'TIME' ? '분' : 'km'}`}
                  selected={goalValue === stored}
                  onPress={() => setGoalValue(stored)}
                />
              </View>
            );
          })}
        </View>
      </Section>

      <Section title="오늘의 컨디션">
        <View style={styles.row}>
          {conditions.map((item) => (
            <View key={item.level} style={styles.flex}>
              <ChoiceCard label={item.label} selected={condition === item.level} onPress={() => setCondition(item.level)} />
            </View>
          ))}
        </View>
      </Section>

      <Section title="안내 방식">
        <SettingRow label="음성 안내" value={voiceEnabled} onChange={setVoiceEnabled} />
        <SettingRow label="메트로놈" value={metronomeEnabled} onChange={setMetronomeEnabled} />
        {!voiceEnabled && !metronomeEnabled ? <Text style={styles.hint}>필요한 순간에는 햅틱으로 한 번 알려드려요.</Text> : null}
      </Section>

      <PrimaryButton onPress={begin}>러닝 시작</PrimaryButton>
      {__DEV__ ? <PrimaryButton variant="secondary" onPress={simulate}>시연 모드 · 10배속</PrimaryButton> : null}

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>나의 러닝 루틴</Text>
        {stats.isLoading ? <Text style={styles.description}>기록을 불러오는 중이에요.</Text> : (
          <View style={styles.row}>
            <SummaryValue label="누적 활동일" value={`${stats.data?.totalRunDays ?? 0}일`} />
            <SummaryValue label="이번 주" value={`${stats.data?.thisWeekCount ?? 0}회`} />
          </View>
        )}
      </View>

      {__DEV__ ? <PrimaryButton variant="text" onPress={() => router.push('/spike')}>실기기 스파이크 열기</PrimaryButton> : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function SettingRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch onValueChange={onChange} value={value} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={value ? colors.primary : colors.disabled} />
    </View>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.flex}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.hint}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  eyebrow: { ...typography.bodyStrong, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  rhythmCard: { ...shadows.card, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  label: { ...typography.bodyStrong, color: colors.textMuted },
  cadence: { ...typography.display, color: colors.text },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  description: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  settingLabel: { ...typography.bodyStrong, color: colors.text },
  hint: { ...typography.caption, color: colors.textMuted },
  summary: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  summaryTitle: { ...typography.bodyStrong, color: colors.text },
  summaryValue: { ...typography.heading, color: colors.primary },
});
