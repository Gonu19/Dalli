/**
 * Pedometer 래퍼 — 실센서를 `CadenceSource`로 감싼다 (`ENGINE.md` §4·§11).
 *
 * 네이티브 접근은 전부 이 파일을 거친다. `engine/`은 순수 TS로 남고, 판정은
 * 이 소스가 만든 `elapsedSec`·`cadence`만 본다 (`AGENTS.md` §2).
 *
 * **시간을 만드는 곳은 소스 한 곳뿐이다.** 여기서만 wall-clock을 읽는다.
 * 백그라운드에서 타이머가 지연·병합되어도 경과 초와 SPM이 정확하도록,
 * 매 tick의 **실제 경과 시간**으로 나눈다 — 1초라고 가정하지 않는다.
 */

import { Pedometer } from 'expo-sensors';

import { SENSOR_TICK_SEC } from '../engine/constants';
import type { CadenceSample, CadenceSource } from '../engine/types';

export type PedometerSourceOptions = {
  /** 샘플 주기. 기본 1초 (`SENSOR_TICK_SEC`). */
  tickSec?: number;
  /** 걸음 구독이 끊겼을 때 알림 — 화면에서 센서 오류를 안내하는 용도. */
  onError?: (error: unknown) => void;
};

export class PedometerSource implements CadenceSource {
  private subscription: { remove: () => void } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private startedAtMs = 0;
  private lastTickMs = 0;
  /** `watchStepCount`가 주는 누적 걸음. 콜백 호출 빈도가 불규칙해 여기서는 값만 갱신한다. */
  private cumulativeSteps = 0;
  private lastSteps = 0;

  constructor(private readonly options: PedometerSourceOptions = {}) {}

  static isAvailable(): Promise<boolean> {
    return Pedometer.isAvailableAsync();
  }

  /** 권한 요청은 시점별 개별 요청 원칙에 따라 화면 쪽에서 한다 (`F1-09`). */
  static requestPermission() {
    return Pedometer.requestPermissionsAsync();
  }

  start(cb: (sample: CadenceSample) => void): void {
    if (this.timer !== null) return;

    const tickSec = this.options.tickSec ?? SENSOR_TICK_SEC;
    this.startedAtMs = Date.now();
    this.lastTickMs = this.startedAtMs;
    this.cumulativeSteps = 0;
    this.lastSteps = 0;

    try {
      this.subscription = Pedometer.watchStepCount((result) => {
        this.cumulativeSteps = result.steps;
      });
    } catch (error) {
      this.options.onError?.(error);
    }

    this.timer = setInterval(() => {
      void this.tick(cb);
    }, tickSec * 1000);
  }

  /**
   * 1초 tick — 누적 걸음 차분으로 순간 SPM을 만든다.
   *
   * `watchStepCount`가 조용한 기기가 있다. iOS는 걸음을 배치로 올려보내는데,
   * 구독이 늦게 붙거나 이벤트가 유실되면 누적값이 0에 머문다. 그러면 화면이
   * 계속 0을 가리키고 사용자는 "측정이 안 된다"고 느낀다.
   *
   * 그래서 **시작 시각부터의 누적 걸음을 직접 조회한 값과 큰 쪽을 쓴다.**
   * 조회가 실패하면 구독값으로 그대로 간다 — 어느 한쪽이 죽어도 측정이 멈추지 않는다.
   */
  private async tick(cb: (sample: CadenceSample) => void): Promise<void> {
    const now = Date.now();
    const deltaSec = (now - this.lastTickMs) / 1000;
    if (deltaSec <= 0) return;

    let cumulative = this.cumulativeSteps;
    try {
      const queried = await Pedometer.getStepCountAsync(new Date(this.startedAtMs), new Date(now));
      if (queried?.steps !== undefined) cumulative = Math.max(cumulative, queried.steps);
    } catch {
      // 과거 구간 조회를 지원하지 않는 기기도 있다. 구독값만으로 계속한다.
    }

    const deltaSteps = Math.max(0, cumulative - this.lastSteps);
    this.lastTickMs = now;
    this.lastSteps = cumulative;
    this.cumulativeSteps = cumulative;

    cb({
      elapsedSec: (now - this.startedAtMs) / 1000,
      cadence: (deltaSteps / deltaSec) * 60,
    });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.subscription?.remove();
    this.subscription = null;
  }
}
