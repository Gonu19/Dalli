import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCompleteOnboarding } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { useOnboarding } from '@/src/components/onboarding-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { computeInitialTargetCadence } from '@/src/engine/target';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function CadenceScreen() {
  const router = useRouter();
  const { token, confirmOnboarded } = useAuth();
  const { draft, updateDraft } = useOnboarding();
  const initialCadence = draft.experienceLevel === undefined || draft.purpose === undefined
    ? draft.baselineCadence
    : computeInitialTargetCadence(draft.experienceLevel, draft.purpose);
  const [cadence, setCadence] = useState(initialCadence);
  const completeOnboarding = useCompleteOnboarding(token);
  const minCadence = initialCadence - 5;
  const maxCadence = initialCadence + 5;

  const finish = async () => {
    if (draft.purpose === undefined || draft.experienceLevel === undefined || draft.maxContinuousMin === undefined || draft.weeklyGoalCount === undefined) {
      router.replace('/onboarding');
      return;
    }

    try {
      const profile = await completeOnboarding.mutateAsync({
        runningPurpose: draft.purpose,
        experienceLevel: draft.experienceLevel,
        maxContinuousMin: draft.maxContinuousMin,
        weeklyGoalCount: draft.weeklyGoalCount,
        baselineCadence: cadence,
        heightCm: draft.heightCm,
        weightKg: draft.weightKg,
        birthYear: draft.birthYear,
        gender: draft.gender,
      });
      confirmOnboarded(profile.onboarded);
      updateDraft({ baselineCadence: cadence });
      router.replace('/');
    } catch {
      // Mutation state renders the recoverable error while preserving the draft.
    }
  };

  return (
    <Screen footer={(
      <PrimaryButton loading={completeOnboarding.isPending} onPress={() => void finish()}>
        달리 시작하기
      </PrimaryButton>
    )}>
      <View style={styles.header}>
        <Text style={styles.step}>3 / 3</Text>
        <Text style={styles.title}>첫 러닝의 리듬을 준비했어요</Text>
        <Text style={styles.description}>첫 러닝에서 실제 리듬을 측정해 나의 기준 리듬을 확정합니다.</Text>
      </View>

      <View style={styles.cadenceCard}>
        <Text style={styles.cardLabel}>나의 시작 리듬</Text>
        <View style={styles.adjustRow}>
          <AdjustButton label="−" disabled={cadence <= minCadence} onPress={() => setCadence((value) => value - 1)} />
          <View style={styles.valueGroup}>
            <Text style={styles.value}>{cadence}</Text>
            <Text style={styles.unit}>spm</Text>
          </View>
          <AdjustButton label="+" disabled={cadence >= maxCadence} onPress={() => setCadence((value) => value + 1)} />
        </View>
        <Text style={styles.hint}>지금은 ±5까지 조절할 수 있어요.</Text>
      </View>

      <View style={styles.note}>
        <Text style={styles.noteTitle}>숫자를 정확히 맞출 필요는 없어요</Text>
        <Text style={styles.noteBody}>달리는 리듬이 달라지면 필요한 순간에만 짧게 안내할게요.</Text>
      </View>

      {completeOnboarding.error ? (
        <Text style={styles.error}>정보를 저장하지 못했어요. 입력 내용은 그대로 유지되어 있어요.</Text>
      ) : null}
    </Screen>
  );
}

function AdjustButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.adjustButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.adjustLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  step: { ...typography.caption, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.textMuted },
  cadenceCard: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  cardLabel: { ...typography.bodyStrong, color: colors.textMuted },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  adjustButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  adjustLabel: { ...typography.title, color: colors.primary },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  valueGroup: { alignItems: 'center' },
  value: { fontSize: 64, lineHeight: 72, fontWeight: '700', color: colors.text },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  note: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  noteTitle: { ...typography.bodyStrong, color: colors.primary },
  noteBody: { ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.danger },
});
