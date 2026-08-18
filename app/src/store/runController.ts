/**
 * 실러닝 생명주기 (`ROADMAP.md` `F1-03`·`F1-04`).
 *
 * `runStore`는 순수 TS라 센서를 모른다. **소스를 붙였다 떼는 일은 여기서 한다.**
 * UI는 이 파일의 함수만 부르면 되고, 시뮬레이션은 `simulation.ts`가 같은 자리에
 * `ReplaySource`를 끼운다 — 스토어 아래는 두 경우가 완전히 같다.
 */

import { getCalendar } from '../api/client';
import { startBackgroundAudio, stopBackgroundAudio } from '../native/audio-session';
import { LocationTracker } from '../native/location';
import type { RoutePoint } from '../native/location';
import { PedometerSource } from '../native/pedometer';
import { ensureLocationPermission, ensureMotionPermission } from '../native/permissions';
import { selectPlanForRun } from './plan-link';
import { useRunStore } from './runStore';
import type { RunRecord, StartOptions } from './runStore';
import { clearSnapshot, saveSnapshot, SNAPSHOT_INTERVAL_SEC } from './session-recovery';
import { enqueueRun } from './upload-queue';

export type TrackedRunOptions = StartOptions & {
  /**
   * 넘기면 오늘(전후 6시간) 계획을 찾아 자동으로 연결한다.
   * 연결된 러닝이 업로드되면 서버가 같은 트랜잭션에서 계획을 `DONE`으로 바꾼다.
   * 조회가 실패해도 러닝은 그대로 시작한다 — 계획 연결은 부가 기능이다.
   */
  token?: string | null;
  /** 센서를 못 쓰는 기기·권한 거부 상황을 화면에 알린다 (`F1-09` 제한 모드). */
  onSensorUnavailable?: () => void;
  /** 위치 권한이 없거나 GPS가 안 잡히는 경우. 러닝은 계속된다. */
  onLocationUnavailable?: () => void;
};

let source: PedometerSource | null = null;
let tracker: LocationTracker | null = null;
/** 종료 후에도 결과 화면·결과 이미지가 쓸 수 있게 마지막 경로를 남긴다. 다음 러닝 시작 시 비운다. */
let finishedRoute: readonly RoutePoint[] = [];

/**
 * 러닝 시작 — 오디오 세션을 먼저 열고 센서를 붙인다.
 *
 * 센서를 못 쓰더라도 스토어는 시작한다. 판정이 `UNAVAILABLE`로 남아
 * 화면이 "측정할 수 없음"을 보여줄 수 있어야 하기 때문이다.
 */
export async function startTrackedRun(options: TrackedRunOptions): Promise<void> {
  const { onSensorUnavailable, onLocationUnavailable, token, ...startOptions } = options;

  stopSource();
  finishedRoute = [];
  await startBackgroundAudio();
  useRunStore.getState().start({
    ...startOptions,
    planId: startOptions.planId ?? (await resolveTodayPlanId(token)),
  });

  // 권한은 시점별로 따로 묻는다 (`F1-09`). 모션이 없으면 케이던스를,
  // 위치가 없으면 거리를 잃을 뿐 러닝 자체는 멈추지 않는다.
  const motion = await ensureMotionPermission();
  // 권한 응답이 실제 동작과 어긋나는 기기가 있다. `getPermissionsAsync`가 거부로
  // 읽혀도 걸음은 정상으로 올라오는 경우가 있어서, **권한 판독으로 센서를 막지 않는다.**
  // 붙여보고 값이 안 오면 판정이 `UNAVAILABLE`로 남아 화면이 그대로 알려준다.
  const available = await PedometerSource.isAvailable().catch(() => false);
  if (!available || !motion.granted) onSensorUnavailable?.();

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

  let lastSnapshotSec = 0;
  source = new PedometerSource({ onError: () => onSensorUnavailable?.() });
  source.start((sample) => {
    // GPS는 곁가지다. 값이 없으면 그대로 비워 보내고 판정은 케이던스로만 돈다.
    useRunStore.getState().ingest({
      ...sample,
      dist: tracker?.distance ?? undefined,
      pace: tracker?.paceSecPerKm ?? undefined,
    });

    // 30초마다 디스크에 남긴다. 앱이 죽어도 여기까지는 살아남는다 (`F1-10`).
    if (sample.elapsedSec - lastSnapshotSec >= SNAPSHOT_INTERVAL_SEC) {
      lastSnapshotSec = sample.elapsedSec;
      const snapshot = useRunStore.getState().snapshot();
      if (snapshot !== null) saveSnapshot(snapshot);
    }
  });
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

/**
 * 종료 — 소스와 오디오 세션을 놓고 업로드 재료를 돌려준다.
 *
 * **업로드보다 먼저 기기에 저장한다.** 서버가 죽어 있든 비행기 모드든
 * 러닝은 이미 남아 있고, 큐가 나중에 올린다 (`F1-10`).
 */
export async function stopTrackedRun(completed: boolean): Promise<RunRecord | null> {
  finishedRoute = tracker?.path ?? [];
  stopSource();
  const record = useRunStore.getState().finish(completed);
  clearSnapshot();
  if (record !== null) enqueueRun(record);
  await stopBackgroundAudio();
  return record;
}

/**
 * 러닝 중 지도가 읽는 경로. 종료 후에는 마지막 러닝의 경로를 돌려준다 (`ENGINE.md` §10).
 * 서버로 나가지 않고 다음 러닝을 시작하면 비워진다.
 */
export function getRoutePath(): readonly RoutePoint[] {
  return tracker?.path ?? finishedRoute;
}

/** 화면이 예기치 않게 사라졌을 때의 정리용. 기록은 남기지 않는다. */
export function detachSensor(): void {
  stopSource();
  void stopBackgroundAudio();
}

/**
 * 오늘(전후 6시간) 계획 조회. 실패하면 `null` — 계획이 없어도 러닝은 해야 한다.
 *
 * 월 경계에서는 이번 달 응답에 어제·내일이 없을 수 있는데, 그 경우 연결만 건너뛴다.
 * 사용자는 기록 탭에서 손으로 완료 처리할 수 있다.
 */
async function resolveTodayPlanId(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;

  try {
    const now = new Date();
    const days = await getCalendar(token, now.getFullYear(), now.getMonth() + 1);
    return selectPlanForRun(days, now);
  } catch {
    return null;
  }
}

function stopSource(): void {
  source?.stop();
  source = null;
  tracker?.stop();
  tracker = null;
}
