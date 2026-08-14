import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { authenticateDevice } from '@/src/api/client';

const ACCESS_TOKEN_KEY = 'dalli.accessToken';
const DEVICE_UUID_KEY = 'dalli.deviceUuid';
const ONBOARDED_KEY = 'dalli.onboarded';

type AuthContextValue = {
  token: string | null;
  onboarded: boolean;
  loading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  markOnboarded: () => Promise<void>;
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
      const [storedToken, storedOnboarded] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.getItemAsync(ONBOARDED_KEY),
      ]);

      if (storedToken) {
        setToken(storedToken);
        setOnboarded(storedOnboarded === 'true');
        return;
      }

      const deviceUuid = await getStableDeviceUuid();
      const auth = await authenticateDevice(deviceUuid);
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, auth.accessToken);
      setToken(auth.accessToken);
      setOnboarded(!auth.isNewUser && storedOnboarded === 'true');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '앱을 시작하지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const markOnboarded = useCallback(async () => {
    await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
    setOnboarded(true);
  }, []);

  const value = useMemo(
    () => ({ token, onboarded, loading, error, retry: bootstrap, markOnboarded }),
    [bootstrap, error, loading, markOnboarded, onboarded, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
