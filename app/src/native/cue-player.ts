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
/** 메트로놈 5초가 끝났음을 큐에 알리는 resolver. 중간에 멈춰도 반드시 부른다. */
let metronomeDone: (() => void) | null = null;

/** 재생 대기열과 진행 여부. 개입은 겹치지 않고 순서대로 나간다. */
let queue: { cue: Cue; bpm: number }[] = [];
let playing = false;

/**
 * 발화 안전망(ms). `onDone`이 오지 않는 기기가 있어 무한정 기다리지 않는다.
 * 문구는 3초 이내 한 문장이므로 (`ENGINE.md` §7) 8초면 충분히 넉넉하다.
 */
const SPEECH_TIMEOUT_MS = 8_000;

/**
 * 덕킹을 걸고 나서 말하기 전까지의 여유(ms).
 *
 * `setAudioModeAsync`가 반환돼도 오디오 세션 전환은 하드웨어에서 조금 더 걸린다.
 * 곧바로 말하면 **첫 음절이 잘린다.** 0.2초는 사람이 지연으로 느끼지 않는다.
 */
const DUCK_SETTLE_MS = 200;

/** 설정 화면의 값을 그대로 넘겨준다. 러닝 중 변경도 즉시 반영된다. */
export function configureCues(next: CuePreferences): void {
  preferences = next;
}

/**
 * 개입 1회 재생. 실패해도 러닝을 멈추지 않는다 — 오디오는 보조 수단이다.
 *
 * `bpm`은 목표 중심값이다. 메트로놈은 언제나 center로 울린다 (§3).
 *
 * ## 순서가 정해져 있다 ⚠️
 *
 * `duck(true) → 음성 끝까지 → 메트로놈 5초 → duck(false)`.
 *
 * 이걸 고정 타이머로 하면 말이 잘린다. `setAudioModeAsync`는 발화 중에 부르면
 * iOS 오디오 세션을 다시 잡아서 TTS를 끊고, 메트로놈을 음성과 동시에 울리면
 * 클릭이 목소리를 덮는다. 그래서 **실제 발화 종료(`onDone`)를 기다린다.**
 *
 * 하향과 리커버리처럼 **같은 tick에 두 이벤트가 나오는 경우**(`judge.ts`의
 * `floor_reached`)도 있어서 대기열로 직렬화한다. 안 그러면 두 번째 발화가
 * 첫 번째를 끊는다.
 */
export async function playCue(cue: Cue, bpm: number): Promise<void> {
  if (!preferences.voice && !preferences.metronome) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    return;
  }

  queue.push({ cue, bpm });
  if (playing) return;

  playing = true;
  await duck(true);
  if (preferences.voice) await delay(DUCK_SETTLE_MS);
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;

      if (preferences.voice) await speakOnce(next.cue.text);
      if (preferences.metronome && next.cue.metronome) await runMetronome(next.bpm);
    }
  } finally {
    playing = false;
    await duck(false);
  }
}

/** 러닝 종료·화면 이탈 시 정리. */
export function stopCues(): void {
  queue = [];
  Speech.stop();
  stopMetronome();
  void duck(false);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 한 문장을 끝까지 읽는다. 끝나거나·멈추거나·실패하면 resolve — 어느 쪽이든 다음으로 넘어간다. */
function speakOnce(text: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve();
    };
    const guard = setTimeout(finish, SPEECH_TIMEOUT_MS);

    try {
      Speech.speak(text, {
        language: 'ko-KR',
        rate: 1.0,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      // 음성이 죽어도 메트로놈·햅틱 경로는 살린다.
      finish();
    }
  });
}

/** 메트로놈 5초 (`ENGINE.md` §7). `stopCues()`로 중간에 멈춰도 resolve된다. */
function runMetronome(bpm: number): Promise<void> {
  return new Promise((resolve) => {
    stopMetronome();
    if (bpm <= 0) {
      resolve();
      return;
    }

    metronomeDone = resolve;
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
    metronomeStop = setTimeout(() => stopMetronome(), METRONOME_SEC * 1000);
  });
}

function stopMetronome(): void {
  if (metronomeTimer !== null) clearInterval(metronomeTimer);
  if (metronomeStop !== null) clearTimeout(metronomeStop);
  metronomeTimer = null;
  metronomeStop = null;

  const done = metronomeDone;
  metronomeDone = null;
  done?.();
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
