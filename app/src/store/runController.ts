/**
 * 실러닝 생명주기 (`ROADMAP.md` `F1-03`·`F1-04`).
 *
 * `runStore`는 순수 TS라 센서를 모른다. **소스를 붙였다 떼는 일은 여기서 한다.**
 * UI는 이 파일의 함수만 부르면 되고, 시뮬레이션은 `simulation.ts`가 같은 자리에
 * `ReplaySource`를 끼운다 — 스토어 아래는 두 경우가 완전히 같다.
 */

import { startBackgroundAudio, stopBackgroundAudio } from '../native/audio-session';
import { LocationTracker } from '../native/location';
import { PedometerSource } from '../native/pedometer';
import { ensureLocationPermission, ensureMotionPermission } from '../native/permissions';
import { useRunStore } from './runStore';
import type { RunRecord, StartOptions } from './runStore';

export type TrackedRunOptions = StartOptions & {
  /** 센서를 못 쓰는 기기·권한 거부 상황을 화면에 알린다 (`F1-09` 제한 모드). */
  onSensorUnavailable?: () => void;
  /** 위치 권한이 없거나 GPS가 안 잡히는 경우. 러닝은 계속된다. */
  onLocationUnavailable?: () => void;
};

let source: PedometerSource | null = null;
let tracker: LocationTracker | null = null;

/**
 * 러닝 시작 — 오디오 세션을 먼저 열고 센서를 붙인다.
 *
 * 센서를 못 쓰더라도 스토어는 시작한다. 판정이 `UNAVAILABLE`로 남아
 * 화면이 "측정할 수 없음"을 보여줄 수 있어야 하기 때문이다.
 */
export async function startTrackedRun(options: TrackedRunOptions): Promise<void> {
  const { onSensorUnavailable, onLocationUnavailable, ...startOptions } = options;

  stopSource();
  await startBackgroundAudio();
  useRunStore.getState().start(startOptions);

  // 권한은 시점별로 따로 묻는다 (`F1-09`). 모션이 없으면 케이던스를,
  // 위치가 없으면 거리를 잃을 뿐 러닝 자체는 멈추지 않는다.
  const motion = await ensureMotionPermission();
  const available = motion.granted && (await PedometerSource.isAvailable().catch(() => false));
  if (!available) onSensorUnavailable?.();

  const location = await ensureLocationPermission();
  if (location.granted) {
    tracker = new LocationTracker();
    const started = await tracker.start();
    if (!started) {
      tracker = null;
      onLocationUnavailable?.();
    }
  } else {
    onLocationUnavailable?.();
  }

  if (!available) return;

  source = new PedometerSource({ onError: () => onSensorUnavailable?.() });
  source.start((sample) =>
    // GPS는 곁가지다. 값이 없으면 그대로 비워 보내고 판정은 케이던스로만 돈다.
    useRunStore.getState().ingest({
      ...sample,
      dist: tracker?.distance ?? undefined,
      pace: tracker?.paceSecPerKm ?? undefined,
    }),
  );
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
  tracker?.stop();
  tracker = null;
}
