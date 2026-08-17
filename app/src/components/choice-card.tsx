import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, pressFeedback, radius, spacing, typography } from '@/src/theme/tokens';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function ChoiceCard({ label, selected, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.dot} /> : null}</View>
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  selected: { borderColor: 'rgba(255,122,89,0.28)', backgroundColor: colors.primarySoft },
  pressed: pressFeedback,
  label: { ...typography.bodyStrong, color: colors.text },
  selectedLabel: { color: colors.primary },
  radio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  radioSelected: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary },
});
