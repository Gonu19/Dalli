import { Stack, useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { AppProviders } from '@/src/components/app-providers';
import { useAuth } from '@/src/components/auth-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { createRun } from '@/src/api/client';
import { recoverInterruptedRun } from '@/src/store/session-recovery';
import { flushQueue, hasPendingRuns } from '@/src/store/upload-queue';
import { colors, spacing, typography } from '@/src/theme/tokens';

void SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { loading, error, onboarded, retry, token } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { preview } = useGlobalSearchParams<{ preview?: string }>();
  const previewOnboarding = __DEV__ && preview === 'onboarding';
  const recovered = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web' && !recovered.current) {
      recoverInterruptedRun();
      recovered.current = true;
    }
    if (Platform.OS !== 'web' && token && hasPendingRuns()) {
      void flushQueue((record) => createRun(token, record));
    }
  }, [token]);

  useEffect(() => {
    if (loading) return;
    void SplashScreen.hideAsync();
  }, [loading]);

  useEffect(() => {
    if (loading || error || !token) return;

    const inOnboarding = segments[0] === 'onboarding';
    if (previewOnboarding && !inOnboarding) {
      router.replace('/onboarding');
      return;
    }
    if (!onboarded && !inOnboarding) router.replace('/onboarding');
    if (onboarded && inOnboarding && !previewOnboarding) router.replace('/');
  }, [error, loading, onboarded, previewOnboarding, router, segments, token]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.message}>오늘의 리듬을 준비하고 있어요.</Text>
      </View>
    );
  }

  if (error || !token) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>서버에 연결하지 못했어요</Text>
        <Text style={styles.message}>{error ?? '인증 정보를 확인해 주세요.'}</Text>
        <PrimaryButton onPress={() => void retry()} style={styles.button}>다시 시도</PrimaryButton>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ animation: 'slide_from_left' }} />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="run/active" options={{ gestureEnabled: false }} />
        <Stack.Screen name="run/finish" options={{ gestureEnabled: false }} />
        <Stack.Screen name="run/report" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="spike" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <AppNavigator />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  message: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: spacing.sm },
});
