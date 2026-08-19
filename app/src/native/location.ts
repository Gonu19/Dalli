/**
 * GPS 거리·페이스 (`ROADMAP.md` `F1-08`, `ENGINE.md` §10).
 *
 * **케이던스와 독립이다.** GPS가 안 잡혀도 판정은 정상으로 돌아가고
 * `distance_m`·`avg_pace_sec_per_km`만 `null`이 된다. 지하도·빌딩 사이에서
 * 러닝이 중단되면 안 되기 때문이다.
 *
 * 경로 좌표는 **메모리에만 남는다.** 러닝 중 지도와 종료 직후 결과 이미지가 쓰고,
 * `samples`·업로드·DB에는 들어가지 않는다 (`ENGINE.md` §10).
 *
 * ## 화면을 끄면 `watchPositionAsync`는 멈춘다 ⚠️
 *
 * 무음 루프로 앱은 살아 있어도(`audio-session.ts`), iOS는 **위치**만은 따로 본다.
 * 전경 권한 + `watchPositionAsync` 조합은 화면이 꺼지는 순간 fix가 끊기고,
 * 3km를 달려도 화면을 켜 둔 구간만 남는다.
 *
 * 그래서 배경 권한이 있으면 `startLocationUpdatesAsync`(TaskManager)로 받고,
 * 없으면 기존 `watchPositionAsync`로 내려간다. **어느 쪽이든 누적 로직은 하나다** —
 * 두 경로가 갈리면 한쪽에서만 나는 거리 버그가 생긴다.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

/**
 * 이 정확도보다 나쁜 fix는 거리 누적에서 버린다 (미터).
 *
 * 25m로 잡았더니 도심·건물 사이에서 대부분의 fix가 버려져 3km가 0.3km로 찍혔다.
 * 러닝용 GPS는 보통 5~20m이지만 흐린 날·고층 사이에서는 30~50m로 쉽게 올라간다.
 * 튀는 좌표는 아래 속도 게이트가 한 번 더 거른다.
 */
const ACCURACY_LIMIT_M = 50;
/** 이 시간 넘게 fix가 없으면 미수신으로 본다 (초). */
const STALE_FIX_SEC = 30;
/**
 * 사람이 낼 수 있는 최대 속도(m/s). 8m/s는 1km 2분 5초로, 실제 러너보다 훨씬 빠르다.
 * fix 간격이 벌어지면 그만큼 허용 거리도 늘어나므로, 신호가 끊겼다 돌아온 구간을
 * 통째로 버리지 않는다 — 그게 거리 누락의 진짜 원인이었다.
 */
const MAX_SPEED_MPS = 8;
/** 짧은 간격에서도 이 정도는 허용한다 (미터). 2초 간격 × 8m/s = 16m로는 GPS 흔들림도 못 담는다. */
const MIN_STEP_ALLOWANCE_M = 60;

/** 배경 위치 업데이트 태스크 이름. 태스크 정의는 이 모듈이 로드될 때 한 번 등록된다. */
export const BACKGROUND_LOCATION_TASK = 'dalli-run-location';

/**
 * 배경 태스크가 좌표를 흘려보낼 대상. 러닝은 한 번에 하나뿐이라 인스턴스도 하나다.
 * 러닝 중이 아니면 `null`이고, 그때 들어온 좌표는 그냥 버린다.
 */
let activeTracker: LocationTracker | null = null;

// 태스크 정의는 모듈 최상단에서 한다 — 앱이 배경에서 깨어날 때 이미 등록돼 있어야 한다.
try {
  if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
    // `defineTask`의 실행자는 Promise를 돌려줘야 한다 (`TaskManagerTaskExecutor`).
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
      if (error !== null || data === null || data === undefined) return;
      const { locations } = data as { locations?: Location.LocationObject[] };
      for (const location of locations ?? []) activeTracker?.acceptFix(location);
    });
  }
} catch {
  // 태스크 등록이 불가능한 환경(웹·Expo Go). 전경 구독으로만 동작한다.
}

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
  /** 배경 업데이트로 받고 있는 중인지. 종료 시 태스크를 내려야 한다. */
  private backgroundStarted = false;
  private previous: { lat: number; lon: number } | null = null;
  private previousAtMs: number | null = null;
  private lastFixAtMs: number | null = null;
  /** 마지막으로 처리한 fix의 기기 시각. 전경·배경 두 경로가 같은 fix를 흘릴 때 걸러낸다. */
  private lastFixTimestamp = 0;
  private route: RoutePoint[] = [];

  private distanceM = 0;
  private startedAtMs = 0;
  /** pause 누계와 진입 시각. 멈춰 있는 동안의 이동과 시간은 거리·페이스에 넣지 않는다. */
  private pausedTotalMs = 0;
  private pausedAtMs: number | null = null;

  /**
   * @param background 배경 위치 권한이 있으면 `true`. 화면을 꺼도 fix가 이어진다.
   *
   * **전경 구독은 언제나 건다.** 배경 태스크만 걸었더니 화면을 켜 둔 채 달리는 동안
   * 좌표가 한 번도 안 들어와 지도와 거리가 출발 지점에 멈췄다. 배경 업데이트는
   * 화면을 껐을 때를 위한 **추가 경로**이지 전경 구독의 대체재가 아니다.
   * 두 경로가 같은 fix를 두 번 흘려도 `acceptFix`가 timestamp로 걸러낸다.
   */
  async start(background = false): Promise<boolean> {
    if (this.subscription !== null || this.backgroundStarted) return true;

    this.startedAtMs = Date.now();
    this.distanceM = 0;
    this.previous = null;
    this.previousAtMs = null;
    this.lastFixAtMs = null;
    this.lastFixTimestamp = 0;
    this.pausedTotalMs = 0;
    this.pausedAtMs = null;
    this.route = [];
    activeTracker = this;

    const foreground = await this.startForegroundWatch();
    if (background) await this.startBackgroundUpdates();

    if (!foreground && !this.backgroundStarted) {
      // 권한 거부·미지원. 러닝은 계속되고 거리만 비어 있게 된다.
      if (activeTracker === this) activeTracker = null;
      return false;
    }
    return true;
  }

  private async startForegroundWatch(): Promise<boolean> {
    try {
      this.subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (position) => this.acceptFix(position),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 배경 위치 업데이트. 화면이 꺼진 뒤에도 fix가 이어지게 하는 **추가** 경로다.
   * 실패해도 전경 구독이 남아 있으므로 러닝은 그대로 간다.
   */
  private async startBackgroundUpdates(): Promise<boolean> {
    try {
      if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) return false;
      // 앞선 러닝이 비정상 종료로 남겨둔 태스크가 있으면 먼저 정리한다.
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 5,
        // iOS가 "멈춘 것 같다"고 판단해 업데이트를 접으면 신호등 앞에서 거리가 끊긴다.
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Fitness,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: '달리 러닝 기록 중',
          notificationBody: '거리와 페이스를 기록하고 있어요.',
          notificationColor: '#3E8A6B',
        },
      });
      this.backgroundStarted = true;
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    if (this.backgroundStarted) {
      this.backgroundStarted = false;
      // 정지는 기다릴 이유가 없다. 실패해도 다음 시작이 남은 태스크를 정리한다.
      void Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    }
    if (activeTracker === this) activeTracker = null;
  }

  /**
   * 일시정지 — 구독은 유지하고 누적만 멈춘다.
   * 여기서 구독을 떼면 iOS가 세션을 회수해 재개 후 fix가 늦게 돌아온다.
   * 멈춘 자리에서의 좌표 흔들림과 이동은 거리·경로에 들어가지 않는다.
   */
  pause(): void {
    if (this.pausedAtMs !== null) return;
    this.pausedAtMs = Date.now();
  }

  /** 재개 — 멈춘 동안의 시간은 페이스에서 빼고, 직전 좌표는 버려 이동분이 한 번에 더해지지 않게 한다. */
  resume(): void {
    if (this.pausedAtMs === null) return;
    this.pausedTotalMs += Date.now() - this.pausedAtMs;
    this.pausedAtMs = null;
    this.previous = null;
    this.previousAtMs = null;
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
    // pause 구간을 뺀 활동 시간으로 잰다. 5분 쉬었다고 페이스가 무너지면 안 된다.
    const pausedMs = this.pausedTotalMs + (this.pausedAtMs === null ? 0 : Date.now() - this.pausedAtMs);
    const elapsedSec = (Date.now() - this.startedAtMs - pausedMs) / 1000;
    if (elapsedSec <= 0) return null;
    return Math.round(elapsedSec / (this.distanceM / 1000));
  }

  /** 최근 fix가 끊겼는지 — 화면에서 거리 자리에 안내를 띄우는 용도. */
  isStale(): boolean {
    if (this.lastFixAtMs === null) return true;
    return (Date.now() - this.lastFixAtMs) / 1000 > STALE_FIX_SEC;
  }

  /**
   * fix 하나를 누적한다. 전경 구독과 배경 태스크가 **같은 입구**를 쓴다.
   * 배경 태스크가 부를 수 있어야 해서 `public`이다 — 화면에서 부를 일은 없다.
   */
  acceptFix(position: Location.LocationObject): void {
    // 전경 구독과 배경 태스크는 같은 fix를 각각 흘린다. 기기가 매긴 시각이 같으므로
    // 그것으로 중복을 거른다. 순서가 뒤집힌 오래된 fix도 여기서 걸린다.
    const timestamp = position.timestamp ?? 0;
    if (timestamp > 0 && timestamp <= this.lastFixTimestamp) return;
    this.lastFixTimestamp = timestamp;

    const { latitude, longitude, accuracy } = position.coords;
    if (accuracy != null && accuracy > ACCURACY_LIMIT_M) return;

    const now = Date.now();
    this.lastFixAtMs = now;
    // pause 중에도 구독은 돌지만 누적하지 않는다. 경로도 그대로 둔다.
    if (this.pausedAtMs !== null) return;

    const current = { lat: latitude, lon: longitude };

    if (this.previous !== null) {
      const step = haversineMeters(this.previous, current);
      // 튀는 좌표 하나가 거리를 늘리지 않도록 **속도**로 상한을 둔다.
      // 고정 100m 상한은 fix가 드문 구간을 통째로 버려서, 오히려 거리를 잃는 쪽이었다.
      const gapSec = this.previousAtMs === null ? 0 : (now - this.previousAtMs) / 1000;
      const allowance = Math.max(MIN_STEP_ALLOWANCE_M, MAX_SPEED_MPS * gapSec);
      if (step <= allowance) this.distanceM += step;
    }
    this.previous = current;
    this.previousAtMs = now;

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
