/**
 * 권한 요청 (`ROADMAP.md` `F1-09`, FR-027).
 *
 * **묶어서 한 번에 요청하지 않는다.** 필요한 시점에 하나씩 묻는다 —
 * 모션은 러닝 시작에, 위치는 거리 표시를 켤 때. 거부해도 제한 모드로 계속 달린다.
 */

import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';

export type PermissionResult = {
  granted: boolean;
  /** `false`면 앱 설정으로 보내야 한다 — 다시 물어도 시스템 창이 뜨지 않는다. */
  canAskAgain: boolean;
};

/** 러닝 시작 직전에 묻는다. 거부되면 케이던스 측정이 불가능해 `UNAVAILABLE`로 간다. */
export async function ensureMotionPermission(): Promise<PermissionResult> {
  try {
    const current = await Pedometer.getPermissionsAsync();
    if (current.granted) return { granted: true, canAskAgain: current.canAskAgain };

    const asked = await Pedometer.requestPermissionsAsync();
    return { granted: asked.granted, canAskAgain: asked.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/**
 * 거리·페이스를 켤 때만 묻는다. 거부해도 러닝은 그대로 진행되고
 * `distance_m`·`avg_pace_sec_per_km`만 `null`이 된다 (`ENGINE.md` §10).
 */
export async function ensureLocationPermission(): Promise<PermissionResult> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return { granted: true, canAskAgain: current.canAskAgain };

    const asked = await Location.requestForegroundPermissionsAsync();
    return { granted: asked.granted, canAskAgain: asked.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/**
 * 배경 위치 — **화면을 끄고 달릴 때 거리가 이어지려면 이것이 필요하다.**
 * 무음 루프로 앱은 살아 있어도 위치는 별도 권한이라, 전경 권한만으로는
 * 화면이 꺼지는 순간 fix가 끊긴다 (`ENGINE.md` §10).
 *
 * 전경 권한이 있어야만 물을 수 있고(iOS 순서 제약), 거부돼도 러닝은 그대로 간다 —
 * 화면을 켜 둔 구간은 전경 구독으로 계속 쌓인다 (`location.ts`).
 */
export async function ensureBackgroundLocationPermission(): Promise<PermissionResult> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return { granted: false, canAskAgain: false };

    const current = await Location.getBackgroundPermissionsAsync();
    if (current.granted) return { granted: true, canAskAgain: current.canAskAgain };
    if (!current.canAskAgain) return { granted: false, canAskAgain: false };

    const asked = await Location.requestBackgroundPermissionsAsync();
    return { granted: asked.granted, canAskAgain: asked.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}
