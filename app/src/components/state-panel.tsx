import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/theme/tokens';

import { PrimaryButton } from './primary-button';

type Props = {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
};

export function StatePanel({ title, body, actionLabel, onAction, loading = false }: Props) {
  return (
    <View style={styles.panel}>
      {loading ? <ActivityIndicator color={colors.primary} size="large" /> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <PrimaryButton loading={loading} variant="secondary" onPress={onAction} style={styles.action}>
          {actionLabel}
        </PrimaryButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: spacing.sm },
});
