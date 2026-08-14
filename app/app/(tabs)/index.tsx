import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>오늘의 달리</Text>
        <Text style={styles.title}>오늘의 리듬을 시작해 볼까요?</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>오늘의 리듬</Text>
        <Text style={styles.cadence}>157 <Text style={styles.unit}>spm</Text></Text>
        <Text style={styles.description}>범위 안에서는 조용히, 필요한 순간에만 안내해요.</Text>
      </View>
      <PrimaryButton onPress={() => {}}>러닝 준비하기</PrimaryButton>
      {__DEV__ ? (
        <PrimaryButton variant="secondary" onPress={() => router.push('/spike')}>실기기 스파이크 열기</PrimaryButton>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  eyebrow: { ...typography.bodyStrong, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  label: { ...typography.bodyStrong, color: colors.textMuted },
  cadence: { ...typography.display, color: colors.text },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  description: { ...typography.body, color: colors.textMuted },
});
