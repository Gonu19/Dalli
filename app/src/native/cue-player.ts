/**
 * 개입 오디오 재생 (`ENGINE.md` §7·§11).
 *
 * - 음성 ≤3초 한 문장 + 메트로놈 5초, 각각 설정으로 끌 수 있다
 * - **음성·메트로놈 모두 off면 햅틱 1회.** 아무 피드백도 없으면 앱이 죽은 것처럼 보인다
 * - 외부 음악은 멈추지 않는다. 개입 순간만 `duckOthers`로 잠깐 줄였다가 되돌린다
 *
 * 문구는 `engine/cues.ts`가 정한다. 여기서는 소리 내는 일만 한다.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import { METRONOME_SEC } from '../engine/constants';
import type { Cue } from '../engine/cues';
import { CLICK_WAV_DATA_URI } from './click-sound';

export type CuePreferences = {
  voice: boolean;
  metronome: boolean;
};

let preferences: CuePreferences = { voice: true, metronome: false };
let click: AudioPlayer | null = null;
let metronomeTimer: ReturnType<typeof setInterval> | null = null;
let metronomeStop: ReturnType<typeof setTimeout> | null = null;

/** 설정 화면의 값을 그대로 넘겨준다. 러닝 중 변경도 즉시 반영된다. */
export function configureCues(next: CuePreferences): void {
  preferences = next;
}

/**
 * 개입 1회 재생. 실패해도 러닝을 멈추지 않는다 — 오디오는 보조 수단이다.
 *
 * `bpm`은 목표 중심값이다. 메트로놈은 언제나 center로 울린다 (§3).
 */
export async function playCue(cue: Cue, bpm: number): Promise<void> {
  if (!preferences.voice && !preferences.metronome) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    return;
  }

  await duck(true);

  if (preferences.voice) {
    try {
      Speech.speak(cue.text, { language: 'ko-KR', rate: 1.0 });
    } catch {
      // 음성이 죽어도 메트로놈·햅틱 경로는 살린다.
    }
  }

  if (preferences.metronome && cue.metronome) {
    startMetronome(bpm);
  } else {
    // 메트로놈이 없으면 음성 길이만큼만 줄였다가 되돌린다.
    setTimeout(() => void duck(false), 3000);
  }
}

/** 러닝 종료·화면 이탈 시 정리. */
export function stopCues(): void {
  Speech.stop();
  stopMetronome();
  void duck(false);
}

function startMetronome(bpm: number): void {
  stopMetronome();
  if (bpm <= 0) return;

  click ??= createAudioPlayer({ uri: CLICK_WAV_DATA_URI });
  const intervalMs = (60 / bpm) * 1000;

  const beat = () => {
    try {
      click?.seekTo(0);
      click?.play();
    } catch {
      stopMetronome();
    }
  };

  beat();
  metronomeTimer = setInterval(beat, intervalMs);
  metronomeStop = setTimeout(() => {
    stopMetronome();
    void duck(false);
  }, METRONOME_SEC * 1000);
}

function stopMetronome(): void {
  if (metronomeTimer !== null) clearInterval(metronomeTimer);
  if (metronomeStop !== null) clearTimeout(metronomeStop);
  metronomeTimer = null;
  metronomeStop = null;
}

/** 개입 순간만 외부 음악을 살짝 줄인다. 끝나면 반드시 `mixWithOthers`로 되돌린다. */
async function duck(active: boolean): Promise<void> {
  try {
    await setAudioModeAsync({
      interruptionMode: active ? 'duckOthers' : 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
  } catch {
    // 세션 조정 실패가 개입을 막지 않는다.
  }
}
