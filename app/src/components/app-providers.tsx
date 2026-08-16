import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './auth-provider';
import { OnboardingProvider } from './onboarding-provider';
import { PreferencesProvider } from './preferences-provider';
import { RunResultProvider } from './run-result-provider';
import { RunUploadSync } from './run-upload-sync';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000 },
      mutations: { retry: 0 },
    },
  }));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RunUploadSync />
            <OnboardingProvider>
              <PreferencesProvider>
                <RunResultProvider>{children}</RunResultProvider>
              </PreferencesProvider>
            </OnboardingProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
