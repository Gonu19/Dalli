/**
 * 실러닝 생명주기 (`ROADMAP.md` `F1-03`·`F1-04`).
 *
 * `runStore`는 순수 TS라 센서를 모른다. **소스를 붙였다 떼는 일은 여기서 한다.**
 * UI는 이 파일의 함수만 부르면 되고, 시뮬레이션은 `simulation.ts`가 같은 자리에
 * `ReplaySource`를 끼운다 — 스토어 아래는 두 경우가 완전히 같다.
 */

import { startBackgroundAudio, stopBackgroundAudio } from '../native/audio-session';
import { PedometerSource } from '../native/pedometer';
import { useRunStore } from './runStore';
import type { RunRecord, StartOptions } from './runStore';

export type TrackedRunOptions = StartOptions & {
  /** 센서를 못 쓰는 기기·권한 거부 상황을 화면에 알린다 (`F1-09` 제한 모드). */
  onSensorUnavailable?: () => void;
};

let source: PedometerSource | null = null;

/**
 * 러닝 시작 — 오디오 세션을 먼저 열고 센서를 붙인다.
 *
 * 센서를 못 쓰더라도 스토어는 시작한다. 판정이 `UNAVAILABLE`로 남아
 * 화면이 "측정할 수 없음"을 보여줄 수 있어야 하기 때문이다.
 */
export async function startTrackedRun(options: TrackedRunOptions): Promise<void> {
  const { onSensorUnavailable, ...startOptions } = options;

  stopSource();
  await startBackgroundAudio();
  useRunStore.getState().start(startOptions);

  const available = await PedometerSource.isAvailable().catch(() => false);
  if (!available) {
    onSensorUnavailable?.();
    return;
  }

  source = new PedometerSource({ onError: () => onSensorUnavailable?.() });
  source.start((sample) => useRunStore.getState().ingest(sample));
}

/**
 * 일시정지 — 소스는 계속 돌린다.
 * pause 구간의 길이를 알아야 `activeSec`를 뺄 수 있고, 여기서 센서를 떼면
 * iOS가 백그라운드 세션을 회수해 재개가 불가능해질 수 있다.
 */
export function pauseTrackedRun(): void {
  useRunStore.getState().pause();
}

export function resumeTrackedRun(): void {
  useRunStore.getState().resume();
}

/** 종료 — 소스와 오디오 세션을 놓고 업로드 재료를 돌려준다. */
export async function stopTrackedRun(completed: boolean): Promise<RunRecord | null> {
  stopSource();
  const record = useRunStore.getState().finish(completed);
  await stopBackgroundAudio();
  return record;
}

/** 화면이 예기치 않게 사라졌을 때의 정리용. 기록은 남기지 않는다. */
export function detachSensor(): void {
  stopSource();
  void stopBackgroundAudio();
}

function stopSource(): void {
  source?.stop();
  source = null;
}
