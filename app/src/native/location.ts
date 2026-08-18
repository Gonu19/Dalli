/**
 * GPS 거리·페이스 (`ROADMAP.md` `F1-08`, `ENGINE.md` §10).
 *
 * **케이던스와 독립이다.** GPS가 안 잡혀도 판정은 정상으로 돌아가고
 * `distance_m`·`avg_pace_sec_per_km`만 `null`이 된다. 지하도·빌딩 사이에서
 * 러닝이 중단되면 안 되기 때문이다.
 *
 * 경로 좌표는 **메모리에만 남는다.** 러닝 중 지도와 종료 직후 결과 이미지가 쓰고,
 * `samples`·업로드·DB에는 들어가지 않는다 (`ENGINE.md` §10).
 */

import * as Location from 'expo-location';

/** 이 정확도보다 나쁜 fix는 거리 누적에서 버린다 (미터). */
const ACCURACY_LIMIT_M = 25;
/** 이 시간 넘게 fix가 없으면 미수신으로 본다 (초). */
const STALE_FIX_SEC = 30;

/** 지도에 그릴 좌표 한 점. 서버로 나가지 않는다. */
export type RoutePoint = { latitude: number; longitude: number };

/** 경로 배열 상한. 1초 간격 20분이면 1200점이라 여유가 있다. */
const MAX_ROUTE_POINTS = 5_000;

/**
 * 지도 첫 화면용 좌표. fix를 기다리지 않고 **마지막으로 알려진 위치**를 즉시 준다.
 * 없으면 `null` — 그 경우 지도는 첫 fix까지 기본 뷰로 남는다.
 */
export async function getLastKnownPoint(): Promise<RoutePoint | null> {
  try {
    const position = await Location.getLastKnownPositionAsync();
    if (position === null) return null;
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}

export class LocationTracker {
  private subscription: Location.LocationSubscription | null = null;
  private previous: { lat: number; lon: number } | null = null;
  private lastFixAtMs: number | null = null;
  private route: RoutePoint[] = [];

  private distanceM = 0;
  private startedAtMs = 0;

  async start(): Promise<boolean> {
    if (this.subscription !== null) return true;

    this.startedAtMs = Date.now();
    this.distanceM = 0;
    this.previous = null;
    this.lastFixAtMs = null;
    this.route = [];

    try {
      this.subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (position) => this.onFix(position),
      );
      return true;
    } catch {
      // 권한 거부·미지원. 러닝은 계속되고 거리만 비어 있게 된다.
      return false;
    }
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
  }

  /**
   * 지나온 경로. 지도와 결과 이미지가 읽는다.
   * 정확도 필터를 통과한 점만 들어가므로 튀는 좌표로 선이 꺾이지 않는다.
   */
  get path(): readonly RoutePoint[] {
    return this.route;
  }

  /** 지도 초기 위치용 최근 좌표. */
  get lastPoint(): RoutePoint | null {
    return this.route.length === 0 ? null : this.route[this.route.length - 1];
  }

  /** 누적 거리. fix를 한 번도 못 받았으면 `null`. */
  get distance(): number | null {
    return this.lastFixAtMs === null ? null : Math.round(this.distanceM);
  }

  /**
   * 평균 페이스(초/km). 거리가 너무 짧거나 fix가 끊긴 지 오래면 `null`.
   * 100m 미만에서 계산하면 값이 요동쳐서 화면에 쓸 수 없다.
   */
  get paceSecPerKm(): number | null {
    if (this.isStale() || this.distanceM < 100) return null;
    const elapsedSec = (Date.now() - this.startedAtMs) / 1000;
    return Math.round(elapsedSec / (this.distanceM / 1000));
  }

  /** 최근 fix가 끊겼는지 — 화면에서 거리 자리에 안내를 띄우는 용도. */
  isStale(): boolean {
    if (this.lastFixAtMs === null) return true;
    return (Date.now() - this.lastFixAtMs) / 1000 > STALE_FIX_SEC;
  }

  private onFix(position: Location.LocationObject): void {
    const { latitude, longitude, accuracy } = position.coords;
    if (accuracy !== null && accuracy > ACCURACY_LIMIT_M) return;

    this.lastFixAtMs = Date.now();
    const current = { lat: latitude, lon: longitude };

    if (this.previous !== null) {
      const step = haversineMeters(this.previous, current);
      // 튀는 좌표 하나가 거리를 수백 미터 늘리지 않도록 상한을 둔다.
      if (step < 100) this.distanceM += step;
    }
    this.previous = current;

    if (this.route.length < MAX_ROUTE_POINTS) {
      this.route.push({ latitude, longitude });
    }
  }
}

/** 두 좌표 사이 거리(미터). */
function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const earthRadiusM = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}
