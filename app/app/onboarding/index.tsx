import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ChoiceCard } from '@/src/components/choice-card';
import { useOnboarding, type ExperienceLevel, type RunningPurpose } from '@/src/components/onboarding-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { colors, spacing, typography } from '@/src/theme/tokens';

const purposes: { value: RunningPurpose; label: string }[] = [
  { value: 'COMPLETE', label: '멈추지 않고 완주하기' },
  { value: 'HABIT', label: '꾸준한 습관 만들기' },
  { value: 'WEIGHT', label: '체중 관리하기' },
  { value: 'FITNESS', label: '기초 체력 기르기' },
  { value: 'PERFORMANCE', label: '나의 기록 개선하기' },
];

const experiences: { value: ExperienceLevel; label: string }[] = [
  { value: 0, label: '처음 시작해요' },
  { value: 1, label: '가끔 달려요' },
  { value: 2, label: '규칙적으로 달려요' },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useOnboarding();
  const complete = draft.purpose !== undefined
    && draft.experienceLevel !== undefined
    && draft.maxContinuousMin !== undefined
    && draft.weeklyGoalCount !== undefined;

  return (
    <Screen
      footer={<PrimaryButton disabled={!complete} onPress={() => router.push('/onboarding/body')}>다음</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.step}>1 / 3</Text>
        <Text style={styles.title}>어떤 러닝을 시작하고 싶나요?</Text>
        <Text style={styles.description}>지금의 경험과 목표에 맞춰 첫 리듬을 준비할게요.</Text>
      </View>

      <Section title="러닝 목적">
        {purposes.map((item) => (
          <ChoiceCard
            key={item.value}
            label={item.label}
            selected={draft.purpose === item.value}
            onPress={() => updateDraft({ purpose: item.value })}
          />
        ))}
      </Section>

      <Section title="러닝 경험">
        {experiences.map((item) => (
          <ChoiceCard
            key={item.value}
            label={item.label}
            selected={draft.experienceLevel === item.value}
            onPress={() => updateDraft({ experienceLevel: item.value })}
          />
        ))}
      </Section>

      <Section title="쉬지 않고 달릴 수 있는 시간">
        <View style={styles.row}>
          {[5, 10, 20, 30].map((minutes) => (
            <View key={minutes} style={styles.flex}>
              <ChoiceCard
                label={`${minutes}분${minutes === 30 ? '+' : ''}`}
                selected={draft.maxContinuousMin === minutes}
                onPress={() => updateDraft({ maxContinuousMin: minutes })}
              />
            </View>
          ))}
        </View>
      </Section>

      <Section title="일주일에 몇 번 달리고 싶나요?">
        <View style={styles.row}>
          {[1, 2, 3, 4].map((count) => (
            <View key={count} style={styles.flex}>
              <ChoiceCard
                label={`${count}회`}
                selected={draft.weeklyGoalCount === count}
                onPress={() => updateDraft({ weeklyGoalCount: count })}
              />
            </View>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  step: { ...typography.caption, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { minWidth: 72, flex: 1 },
});
