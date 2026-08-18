import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, pressFeedback, radius, spacing, typography } from '@/src/theme/tokens';
import { triggerButtonHaptic } from './haptics';

type Props = {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'text';
  style?: ViewStyle;
};

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={() => {
        triggerButtonHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.primary} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  text: { backgroundColor: 'transparent' },
  pressed: pressFeedback,
  disabled: { opacity: 0.45 },
  label: typography.button,
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.text },
  textLabel: { color: colors.textMuted },
});
