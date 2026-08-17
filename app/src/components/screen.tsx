import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme/tokens';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  includeBottomSafeArea?: boolean;
};

export function Screen({ children, footer, scroll = true, padded = true, includeBottomSafeArea = true }: Props) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, !padded && styles.unpadded]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, !padded && styles.unpadded]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={includeBottomSafeArea ? ['top', 'bottom'] : ['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, Platform.OS === 'web' && styles.webFrame]}>
        {content}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  webFrame: { width: '100%', maxWidth: 402, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 27, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
  unpadded: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, gap: 0 },
  footer: { paddingHorizontal: 27, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.background },
});
