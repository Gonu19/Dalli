import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, authenticateDevice, getUserProfile } from '@/src/api/client';

const ACCESS_TOKEN_KEY = 'dalli.accessToken';
const DEVICE_UUID_KEY = 'dalli.deviceUuid';
const LEGACY_ONBOARDED_KEY = 'dalli.onboarded';
const LEGACY_PURPOSE_KEY = 'dalli.runningPurpose';

type AuthContextValue = {
  token: string | null;
  onboarded: boolean;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  confirmOnboarded: (serverConfirmed: boolean) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function makeLocalUuid() {
  return `dalli-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function getStableDeviceUuid() {
  const stored = await SecureStore.getItemAsync(DEVICE_UUID_KEY);
  if (stored) return stored;

  const iosId = await Application.getIosIdForVendorAsync().catch(() => null);
  const deviceUuid = iosId ?? makeLocalUuid();
  await SecureStore.setItemAsync(DEVICE_UUID_KEY, deviceUuid);
  return deviceUuid;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let activeToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);

      if (activeToken) {
        try {
          const profile = await getUserProfile(activeToken);
          setToken(activeToken);
          setOnboarded(profile.onboarded);
          return;
        } catch (caught) {
          if (!(caught instanceof ApiError) || caught.status !== 401) throw caught;
          await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
          activeToken = null;
        }
      }

      const deviceUuid = await getStableDeviceUuid();
      const auth = await authenticateDevice(deviceUuid);
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, auth.accessToken);
      const profile = await getUserProfile(auth.accessToken);
      setToken(auth.accessToken);
      setOnboarded(profile.onboarded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '앱을 시작하지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    void Promise.all([
      SecureStore.deleteItemAsync(LEGACY_ONBOARDED_KEY),
      SecureStore.deleteItemAsync(LEGACY_PURPOSE_KEY),
    ]);
  }, []);

  const confirmOnboarded = useCallback((serverConfirmed: boolean) => {
    if (!serverConfirmed) throw new Error('서버에서 온보딩 완료를 확인하지 못했어요.');
    setOnboarded(true);
  }, []);

  const value = useMemo(
    () => ({ token, onboarded, loading, error, retry: bootstrap, confirmOnboarded }),
    [bootstrap, confirmOnboarded, error, loading, onboarded, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
