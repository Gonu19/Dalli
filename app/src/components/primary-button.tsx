import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/theme/tokens';

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
      onPress={onPress}
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
  secondary: { backgroundColor: colors.primarySoft },
  text: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
  label: typography.button,
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.primary },
  textLabel: { color: colors.textMuted },
});
