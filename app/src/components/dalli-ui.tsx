import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, pressFeedback, radius, spacing, typography } from '@/src/theme/tokens';

export function DalliLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      accessibilityLabel="달리"
      resizeMode="contain"
      source={require('@/assets/images/dalli-logo.png')}
      style={[styles.logo, compact && styles.logoCompact]}
    />
  );
}

export function AppHeader({ title, back = false, action }: { title?: string; back?: boolean; action?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable accessibilityLabel="뒤로" onPress={() => router.back()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Ionicons color={colors.text} name="chevron-back" size={22} />
        </Pressable>
      ) : <DalliLogo compact />}
      {title ? <Text style={styles.headerTitle}>{title}</Text> : <View />}
      <View style={styles.action}>{action}</View>
    </View>
  );
}

export function DalliCard({ children, dark = false, style }: { children: ReactNode; dark?: boolean; style?: ViewStyle }) {
  return <View style={[styles.card, dark && styles.cardDark, style]}>{children}</View>;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

const styles = StyleSheet.create({
  logo: { width: 84, height: 48 },
  logoCompact: { width: 64, height: 36 },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.text },
  action: { minWidth: 44, alignItems: 'flex-end' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  pressed: pressFeedback,
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  cardDark: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  sectionHeading: { ...typography.heading, color: colors.text },
});
