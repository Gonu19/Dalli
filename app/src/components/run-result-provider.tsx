import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

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
};

const RunResultContext = createContext<ContextValue | null>(null);

export function RunResultProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const value = useMemo(() => ({
    result,
    setResult,
    setReport: (report: RunReport) => setResult((current) => current ? { ...current, report } : current),
  }), [result]);

  return <RunResultContext.Provider value={value}>{children}</RunResultContext.Provider>;
}

export function useRunResult() {
  const value = useContext(RunResultContext);
  if (!value) throw new Error('useRunResult must be used inside RunResultProvider');
  return value;
}
