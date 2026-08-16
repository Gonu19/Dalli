import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { createRun } from '../api/client';
import {
  flushQueue,
  hasPendingRuns,
  subscribeQueue,
} from '../store/upload-queue';
import { useAuth } from './auth-provider';

const RETRY_INTERVAL_MS = 15_000;

export function RunUploadSync() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const pending = useSyncExternalStore(subscribeQueue, hasPendingRuns, () => false);
  const activeFlush = useRef<Promise<void> | null>(null);

  const sync = useCallback(() => {
    if (!token || activeFlush.current || !hasPendingRuns()) return;

    activeFlush.current = (async () => {
      const result = await flushQueue((record) => createRun(token, record));
      if (result.uploaded > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['runs'] }),
          queryClient.invalidateQueries({ queryKey: ['stats'] }),
          queryClient.invalidateQueries({ queryKey: ['calendar'] }),
        ]);
      }
    })().finally(() => {
      activeFlush.current = null;
    });
  }, [queryClient, token]);

  // 재실행 후 인증이 복원되면 남은 항목을 즉시 시도한다.
  useEffect(() => {
    sync();
  }, [sync]);

  // 터널만 재시작된 경우는 기기 네트워크 상태가 바뀌지 않으므로,
  // 큐가 남아 있고 앱이 활성 상태일 때만 제한적으로 재시도한다.
  useEffect(() => {
    if (!pending || !token) return;

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') sync();
    }, RETRY_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pending, sync, token]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => subscription.remove();
  }, [sync]);

  return null;
}
