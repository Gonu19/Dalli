/**
 * 개입 오디오 재생 (`ENGINE.md` §7·§11).
 *
 * - 음성 ≤3초 한 문장 + 메트로놈 + 진동, 셋 다 각각 설정으로 끌 수 있다
 * - **메트로놈은 박자를 미리 구운 트랙 하나를 재생한다** (`metronome-track.ts`).
 *   JS 타이머로 박을 찍으면 음악이 나올 때 박자가 아예 고르지 않다
 * - **셋을 모두 끄면 아무것도 내보내지 않는다.** 끈 것을 대신 울려 주지 않는다
 * - 외부 음악은 멈추지 않는다. 개입 순간만 `duckOthers`로 잠깐 줄였다가 되돌린다
 *
 * 문구는 `engine/cues.ts`가 정한다. 여기서는 소리 내는 일만 한다.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import { METRONOME_SEC } from '../engine/constants';
import type { Cue } from '../engine/cues';
import { buildMetronomeTrack } from './metronome-track';

export type CuePreferences = {
  voice: boolean;
  metronome: boolean;
  haptics: boolean;
};

let preferences: CuePreferences = { voice: true, metronome: false, haptics: true };
/** 지금 울리고 있는 트랙. 한 번 재생하고 버린다 — 되감아 재사용하지 않는다. */
let track: AudioPlayer | null = null;
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

/**
 * 진동 한 번. 화면이 꺼져 있으면 OS가 알아서 무시하므로 여기서 따로 막지 않는다.
 * 실패해도 삼킨다 — 진동은 보조 신호이고, 없다고 러닝을 멈출 이유가 없다.
 */
function playHaptic(kind: Cue['haptic']): Promise<void> {
  const fired = kind === 'warning'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  return fired.catch(() => {});
}

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
  // 진동은 오디오와 독립된 채널이다. 소리를 껐다고 대신 울리지도, 소리가 난다고 빠지지도 않는다.
  // 대기열에 넣지 않고 바로 내보낸다 — 개입이 밀려 있어도 신호는 지금 도착해야 한다.
  if (preferences.haptics) void playHaptic(cue.haptic);
  if (!preferences.voice && !preferences.metronome) return;

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

/**
 * 목표 리듬을 미리 들려준다 (러닝 준비·온보딩의 리듬 조절).
 *
 * 개입 큐를 타지 않는다. 사용자가 직접 누른 것이므로 **메트로놈 설정이 꺼져 있어도 울린다.**
 * 설정은 러닝 중 자동 개입을 켜고 끄는 것이지, 직접 요청한 재생까지 막지는 않는다.
 *
 * 길이는 개입 메트로놈과 같은 `METRONOME_SEC`다. 끝나면 resolve하므로 화면이 버튼 상태를
 * 되돌릴 수 있고, 도중에 `stopPreview()`로 끊어도 resolve된다.
 */
export async function previewMetronome(bpm: number): Promise<void> {
  await duck(true);
  // 세션 전환이 끝나기 전에 울리면 첫 클릭이 삼켜진다. 음성이 첫 음절을 잃는 것과 같은 이유다.
  await delay(DUCK_SETTLE_MS);
  try {
    await runMetronome(bpm);
  } finally {
    await duck(false);
  }
}

/** 미리듣기 중단. 화면을 떠나거나 러닝을 시작할 때 반드시 부른다. */
export function stopPreview(): void {
  stopMetronome();
  void duck(false);
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

/**
 * 메트로놈 (`ENGINE.md` §7). `stopCues()`로 중간에 멈춰도 resolve된다.
 *
 * 박을 하나씩 울리지 않는다. `durationSec` 길이의 트랙을 통째로 만들어 한 번 재생하고,
 * 끝나는 시각만 타이머로 잡는다. 박 사이 간격은 샘플 단위로 확정돼 있어 JS 스레드가
 * 밀려도 흔들리지 않는다.
 */
function runMetronome(bpm: number, durationSec: number = METRONOME_SEC): Promise<void> {
  return new Promise((resolve) => {
    stopMetronome();
    if (bpm <= 0 || durationSec <= 0) {
      resolve();
      return;
    }

    metronomeDone = resolve;
    try {
      track = createAudioPlayer({ uri: buildMetronomeTrack(bpm, durationSec) });
      track.play();
    } catch {
      stopMetronome();
      return;
    }
    // 트랙 길이만큼만 잡아 둔다. 재생이 조금 늦게 시작돼도 박자는 트랙 안에서 정확하다.
    metronomeStop = setTimeout(() => stopMetronome(), durationSec * 1000);
  });
}

function stopMetronome(): void {
  if (metronomeStop !== null) clearTimeout(metronomeStop);
  metronomeStop = null;

  if (track !== null) {
    try {
      track.pause();
      track.remove();
    } catch {
      // 이미 정리된 플레이어를 다시 닫아도 문제 없다.
    }
    track = null;
  }

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
