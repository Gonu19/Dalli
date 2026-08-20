import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { configureCues } from '../native/cue-player';

const VOICE_KEY = 'dalli.voiceEnabled';
const METRONOME_KEY = 'dalli.metronomeEnabled';
const HAPTICS_KEY = 'dalli.hapticsEnabled';

type ContextValue = {
  voiceEnabled: boolean;
  metronomeEnabled: boolean;
  hapticsEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

const PreferencesContext = createContext<ContextValue | null>(null);

async function getPreference(key: string) {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setPreference(key: string, value: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [voiceEnabled, setVoiceState] = useState(true);
  const [metronomeEnabled, setMetronomeState] = useState(false);
  const [hapticsEnabled, setHapticsState] = useState(false);

  useEffect(() => {
    void Promise.all([
      getPreference(VOICE_KEY),
      getPreference(METRONOME_KEY),
      getPreference(HAPTICS_KEY),
    ]).then(([voice, metronome, haptics]) => {
      if (voice !== null) setVoiceState(voice === 'true');
      if (metronome !== null) setMetronomeState(metronome === 'true');
      if (haptics !== null) setHapticsState(haptics === 'true');
    });
  }, []);

  const setVoiceEnabled = useCallback((enabled: boolean) => {
    setVoiceState(enabled);
    void setPreference(VOICE_KEY, String(enabled));
  }, []);

  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    setMetronomeState(enabled);
    void setPreference(METRONOME_KEY, String(enabled));
  }, []);

  const setHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsState(enabled);
    void setPreference(HAPTICS_KEY, String(enabled));
  }, []);

  useEffect(() => {
    configureCues({ voice: voiceEnabled, metronome: metronomeEnabled, haptics: hapticsEnabled });
  }, [hapticsEnabled, metronomeEnabled, voiceEnabled]);

  const value = useMemo(() => ({
    voiceEnabled,
    metronomeEnabled,
    hapticsEnabled,
    setVoiceEnabled,
    setMetronomeEnabled,
    setHapticsEnabled,
  }), [hapticsEnabled, metronomeEnabled, setHapticsEnabled, setMetronomeEnabled, setVoiceEnabled, voiceEnabled]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}
