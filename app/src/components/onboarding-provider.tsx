import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import type { RunningPurpose } from '@/src/api/client';

export type { RunningPurpose } from '@/src/api/client';
export type ExperienceLevel = 0 | 1 | 2;
export type Gender = 'M' | 'F' | 'O';

export type OnboardingDraft = {
  purpose?: RunningPurpose;
  experienceChoice?: number;
  experienceLevel?: ExperienceLevel;
  maxContinuousMin?: number;
  weeklyGoalCount?: number;
  heightCm?: number;
  weightKg?: number;
  birthYear?: number;
  birthMonth?: number;
  birthDay?: number;
  gender?: Gender;
  reasonChoice?: RunningPurpose;
  baselineCadence: number;
};

type ContextValue = {
  draft: OnboardingDraft;
  updateDraft: (next: Partial<OnboardingDraft>) => void;
};

const OnboardingContext = createContext<ContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<OnboardingDraft>({ baselineCadence: 157 });

  const value = useMemo<ContextValue>(
    () => ({
      draft,
      updateDraft: (next) => setDraft((current) => ({ ...current, ...next })),
    }),
    [draft],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return value;
}
