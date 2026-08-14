/**
 * 백그라운드 오디오 세션 + 무음 루프 (`ENGINE.md` §11, `ROADMAP.md` `F1-04`).
 *
 * 화면을 꺼도 앱이 살아 있어야 Pedometer 타이머가 계속 돈다. iOS에서 그 수단이
 * **무음 파일 상시 재생 + `UIBackgroundModes: ["audio"]`**다.
 *
 * 외부 음악을 끊지 않는 것이 제품의 차별점이다 (`DEMO.md` 강조 1).
 * 그래서 `mixWithOthers`로 열고, 개입 순간에도 음악을 멈추지 않는다.
 *
 * `IN-06` 스파이크에서 실기기로 검증된 호출 순서를 그대로 따른다.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const silence = require('../../assets/sounds/silence.wav');

let player: AudioPlayer | null = null;

/**
 * 러닝 시작 시 1회 호출. 세션을 열고 무음 루프를 재생한다.
 * 실패해도 러닝은 계속된다 — 전경에서는 측정이 되므로 앱을 죽이지 않는다.
 */
export async function startBackgroundAudio(): Promise<boolean> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    });

    player ??= createAudioPlayer(silence);
    player.loop = true;
    player.volume = 1;
    player.play();
    return true;
  } catch {
    return false;
  }
}

/** 러닝 종료 시 호출. 세션을 놓아 외부 음악 앱에 제어를 돌려준다. */
export async function stopBackgroundAudio(): Promise<void> {
  try {
    player?.pause();
    player?.remove();
  } catch {
    // 이미 해제된 경우는 무시한다.
  } finally {
    player = null;
  }

  try {
    await setAudioModeAsync({ shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
  } catch {
    // 세션 복구 실패가 러닝 종료를 막지 않는다.
  }
}

/** 무음 루프가 살아 있는지 — 백그라운드 생존 확인용. */
export function isBackgroundAudioActive(): boolean {
  return player?.playing ?? false;
}
