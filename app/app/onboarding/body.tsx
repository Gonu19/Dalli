import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoiceCard } from '@/src/components/choice-card';
import { useOnboarding, type Gender } from '@/src/components/onboarding-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function BodyInfoScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useOnboarding();
  const [height, setHeight] = useState(draft.heightCm?.toString() ?? '');
  const [weight, setWeight] = useState(draft.weightKg?.toString() ?? '');
  const [birthYear, setBirthYear] = useState(draft.birthYear?.toString() ?? '');
  const [gender, setGender] = useState<Gender | undefined>(draft.gender);

  const error = useMemo(() => {
    const heightValue = parseOptionalNumber(height);
    const weightValue = parseOptionalNumber(weight);
    const yearValue = parseOptionalNumber(birthYear);
    if (height && (!heightValue || heightValue < 100 || heightValue > 250)) return '키는 100~250cm로 입력해 주세요.';
    if (weight && (!weightValue || weightValue < 25 || weightValue > 300)) return '몸무게는 25~300kg으로 입력해 주세요.';
    if (birthYear && (!yearValue || !Number.isInteger(yearValue) || yearValue < 1900 || yearValue > 2018)) return '출생연도를 확인해 주세요.';
    return null;
  }, [birthYear, height, weight]);

  const continueNext = () => {
    updateDraft({
      heightCm: parseOptionalNumber(height),
      weightKg: parseOptionalNumber(weight),
      birthYear: parseOptionalNumber(birthYear),
      gender,
    });
    router.push('/onboarding/cadence');
  };

  return (
    <Screen footer={(
      <View style={styles.footerButtons}>
        <PrimaryButton variant="text" onPress={() => router.push('/onboarding/cadence')}>건너뛰기</PrimaryButton>
        <PrimaryButton disabled={Boolean(error)} onPress={continueNext}>다음</PrimaryButton>
      </View>
    )}>
      <View style={styles.header}>
        <Text style={styles.step}>2 / 3</Text>
        <Text style={styles.title}>신체 정보를 알려주세요</Text>
        <Text style={styles.description}>칼로리 추정에 사용해요. 지금 건너뛰어도 되고, 나중에 설정에서 입력할 수 있어요.</Text>
      </View>

      <View style={styles.twoColumns}>
        <Field label="키 (cm)" value={height} onChangeText={setHeight} placeholder="165" />
        <Field label="몸무게 (kg)" value={weight} onChangeText={setWeight} placeholder="62.5" decimal />
      </View>
      <Field label="출생연도" value={birthYear} onChangeText={setBirthYear} placeholder="2004" />

      <View style={styles.section}>
        <Text style={styles.label}>성별</Text>
        <View style={styles.twoColumns}>
          {([
            ['F', '여성'],
            ['M', '남성'],
            ['O', '기타·응답 안 함'],
          ] as const).map(([value, label]) => (
            <View key={value} style={styles.choice}>
              <ChoiceCard label={label} selected={gender === value} onPress={() => setGender(value)} />
            </View>
          ))}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  decimal = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  decimal?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  step: { ...typography.caption, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.sm },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { flex: 1, minWidth: 140, gap: spacing.sm },
  label: { ...typography.bodyStrong, color: colors.text },
  input: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...typography.body,
    color: colors.text,
  },
  choice: { flex: 1, minWidth: 140 },
  error: { ...typography.caption, color: colors.danger },
  footerButtons: { gap: spacing.sm },
});
