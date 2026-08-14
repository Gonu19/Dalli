import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/screen';
import { colors, spacing, typography } from '@/src/theme/tokens';

export default function RecordScreen() {
  return (
    <Screen>
      <Text style={styles.title}>기록</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>아직 기록된 러닝이 없어요</Text>
        <Text style={styles.body}>첫 러닝을 시작하면 이곳에서 완료한 날을 볼 수 있어요.</Text>
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
