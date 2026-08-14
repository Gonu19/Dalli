import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { UserProfile } from '@/src/api/client';
import { useProfile, useUpdateProfile } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { usePreferences } from '@/src/components/preferences-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const profile = useProfile(token);

  if (profile.isLoading) return <Screen><StatePanel loading title="설정을 불러오고 있어요" body="나의 기준 리듬과 정보를 확인하는 중이에요." /></Screen>;
  if (!profile.data || profile.error) return <Screen><StatePanel title="설정을 불러오지 못했어요" body="정보는 보존되어 있어요." actionLabel="다시 시도" onAction={() => void profile.refetch()} /></Screen>;

  return <SettingsForm profile={profile.data} token={token} onClose={() => router.back()} />;
}

function SettingsForm({ profile, token, onClose }: { profile: UserProfile; token: string | null; onClose: () => void }) {
  const update = useUpdateProfile(token);
  const { voiceEnabled, metronomeEnabled, setVoiceEnabled, setMetronomeEnabled } = usePreferences();
  const [height, setHeight] = useState(profile.heightCm?.toString() ?? '');
  const [weight, setWeight] = useState(profile.weightKg?.toString() ?? '');
  const [birthYear, setBirthYear] = useState(profile.birthYear?.toString() ?? '');
  const complete = profile.runningPurpose !== null
    && profile.experienceLevel !== null
    && profile.maxContinuousMin !== null
    && profile.weeklyGoalCount !== null
    && profile.baselineCadence !== null;

  const save = async () => {
    if (!complete) return;
    try {
      await update.mutateAsync({
        runningPurpose: profile.runningPurpose!,
        experienceLevel: profile.experienceLevel!,
        maxContinuousMin: profile.maxContinuousMin!,
        weeklyGoalCount: profile.weeklyGoalCount!,
        baselineCadence: profile.baselineCadence!,
        heightCm: parseOptional(height),
        weightKg: parseOptional(weight),
        birthYear: parseOptional(birthYear),
        gender: profile.gender ?? undefined,
      });
    } catch {
      // Mutation state renders an error while preserving the fields.
    }
  };

  return (
    <Screen footer={<PrimaryButton variant="text" onPress={onClose}>닫기</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.title}>설정</Text>
        <Text style={styles.body}>기준 리듬과 선택 정보를 확인하고 보완할 수 있어요.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>나의 기준 리듬</Text>
        <Text style={styles.cadence}>{profile.baselineCadence ?? '—'} <Text style={styles.unit}>spm</Text></Text>
        <Text style={styles.body}>첫 러닝의 실측 결과가 충분하면 이 값이 갱신돼요.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>신체 정보 · 선택</Text>
        <Text style={styles.body}>칼로리 추정에 사용해요. 비워 두어도 러닝 리듬에는 영향을 주지 않아요.</Text>
        <Field label="키 (cm)" value={height} onChange={setHeight} />
        <Field label="몸무게 (kg)" value={weight} onChange={setWeight} decimal />
        <Field label="출생연도" value={birthYear} onChange={setBirthYear} />
        {update.error ? <Text style={styles.error}>정보를 저장하지 못했어요. 입력 내용은 유지되어 있어요.</Text> : null}
        {update.isSuccess ? <Text style={styles.success}>정보를 저장했어요.</Text> : null}
        <PrimaryButton loading={update.isPending} onPress={() => void save()}>정보 저장</PrimaryButton>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>기본 안내 방식</Text>
        <Setting label="음성 안내" value={voiceEnabled} onChange={setVoiceEnabled} />
        <Setting label="메트로놈" value={metronomeEnabled} onChange={setMetronomeEnabled} />
        <Text style={styles.body}>안내 방식은 러닝 시작 전에도 바꿀 수 있어요.</Text>
      </View>
    </Screen>
  );
}

function Field({ label, value, onChange, decimal = false }: { label: string; value: string; onChange: (value: string) => void; decimal?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput keyboardType={decimal ? 'decimal-pad' : 'number-pad'} onChangeText={onChange} placeholder="입력 안 함" placeholderTextColor={colors.disabled} style={styles.input} value={value} /></View>;
}

function Setting({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.setting}><Text style={styles.label}>{label}</Text><Switch onValueChange={onChange} value={value} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={value ? colors.primary : colors.disabled} /></View>;
}

function parseOptional(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.textMuted },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionTitle: { ...typography.heading, color: colors.text },
  cadence: { ...typography.display, color: colors.primary },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  field: { gap: spacing.xs },
  label: { ...typography.bodyStrong, color: colors.text },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body },
  setting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  error: { ...typography.caption, color: colors.danger },
  success: { ...typography.caption, color: colors.primary },
});
