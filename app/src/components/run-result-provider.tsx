import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { RunCreated, RunReport } from '@/src/api/client';
import type { RunRecord } from '@/src/store/runStore';

type RunResult = {
  record: RunRecord;
  uploaded: RunCreated | null;
  report: RunReport | null;
  simulated: boolean;
};

type ContextValue = {
  result: RunResult | null;
  setResult: (result: RunResult | null) => void;
  setReport: (report: RunReport) => void;
  photoUri: string | null;
  setPhotoUri: (uri: string | null) => void;
};

const RunResultContext = createContext<ContextValue | null>(null);

export function RunResultProvider({ children }: { children: ReactNode }) {
  const [result, setResultState] = useState<RunResult | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const setResult = useCallback((next: RunResult | null) => {
    setResultState(next);
    setPhotoUri(null);
  }, []);
  const value = useMemo(() => ({
    result,
    setResult,
    setReport: (report: RunReport) => setResultState((current) => current ? { ...current, report } : current),
    photoUri,
    setPhotoUri,
  }), [photoUri, result, setResult]);

  return <RunResultContext.Provider value={value}>{children}</RunResultContext.Provider>;
}

export function useRunResult() {
  const value = useContext(RunResultContext);
  if (!value) throw new Error('useRunResult must be used inside RunResultProvider');
  return value;
}
