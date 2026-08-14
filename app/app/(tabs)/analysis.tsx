import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/screen';
import { colors, spacing, typography } from '@/src/theme/tokens';

export default function AnalysisScreen() {
  return (
    <Screen>
      <Text style={styles.title}>분석</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>첫 러닝을 기다리고 있어요</Text>
        <Text style={styles.body}>러닝을 마치면 나의 리듬과 다음 행동을 확인할 수 있어요.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
