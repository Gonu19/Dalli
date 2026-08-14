import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const VOICE_KEY = 'dalli.voiceEnabled';
const METRONOME_KEY = 'dalli.metronomeEnabled';

type ContextValue = {
  voiceEnabled: boolean;
  metronomeEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
};

const PreferencesContext = createContext<ContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [voiceEnabled, setVoiceState] = useState(true);
  const [metronomeEnabled, setMetronomeState] = useState(false);

  useEffect(() => {
    void Promise.all([
      SecureStore.getItemAsync(VOICE_KEY),
      SecureStore.getItemAsync(METRONOME_KEY),
    ]).then(([voice, metronome]) => {
      if (voice !== null) setVoiceState(voice === 'true');
      if (metronome !== null) setMetronomeState(metronome === 'true');
    });
  }, []);

  const setVoiceEnabled = useCallback((enabled: boolean) => {
    setVoiceState(enabled);
    void SecureStore.setItemAsync(VOICE_KEY, String(enabled));
  }, []);

  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    setMetronomeState(enabled);
    void SecureStore.setItemAsync(METRONOME_KEY, String(enabled));
  }, []);

  const value = useMemo(() => ({
    voiceEnabled,
    metronomeEnabled,
    setVoiceEnabled,
    setMetronomeEnabled,
  }), [metronomeEnabled, setMetronomeEnabled, setVoiceEnabled, voiceEnabled]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}
