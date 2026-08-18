/**
 * Pedometer 래퍼 — 실센서를 `CadenceSource`로 감싼다 (`ENGINE.md` §4·§11).
 *
 * 네이티브 접근은 전부 이 파일을 거친다. `engine/`은 순수 TS로 남고, 판정은
 * 이 소스가 만든 `elapsedSec`·`cadence`만 본다 (`AGENTS.md` §2).
 *
 * **시간을 만드는 곳은 소스 한 곳뿐이다.** 여기서만 wall-clock을 읽는다.
 * 백그라운드에서 타이머가 지연·병합되어도 경과 초와 SPM이 정확하도록,
 * 매 tick의 **실제 경과 시간**으로 나눈다 — 1초라고 가정하지 않는다.
 *
 * ## 1초 차분이 아니라 누적 걸음의 롤링 비율을 쓴다 ⚠️
 *
 * iOS는 걸음을 **묶어서** 올려보낸다. 3초쯤 조용하다가 한 번에 5걸음이 들어오는 식이라,
 * 1초 차분으로 SPM을 만들면 `0, 0, 300, 0, 0, 240 …`처럼 튄다. 그 값을 20초 중앙값에
 * 넣으면 절반 이상이 0이라 **중앙값이 0으로 내려앉는다** — 걷고 있는데 화면이 0을 가리킨다.
 *
 * 그래서 최근 `ROLLING_WINDOW_SEC` 구간의 **누적 걸음 증가분**을 그 구간 길이로 나눈다.
 * 배치로 들어와도 구간 합은 같으므로 값이 안정적이다.
 */

import { Pedometer } from 'expo-sensors';

import { SENSOR_TICK_SEC } from '../engine/constants';
import { rollingCadenceSpm, updateStepHistory } from '../engine/step-rate';
import type { StepPoint } from '../engine/step-rate';
import type { CadenceSample, CadenceSource } from '../engine/types';

/**
 * 롤링 구간 길이(초). 짧으면 배치 때문에 다시 튀고, 길면 리듬 변화가 늦게 보인다.
 * 엔진의 20초 윈도우가 뒤에서 한 번 더 다듬으므로 여기서는 짧게 잡는다.
 */
const ROLLING_WINDOW_SEC = 8;

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
  /** 최근 구간의 누적 걸음 이력. 롤링 비율 계산에만 쓴다. */
  private history: StepPoint[] = [];

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
    this.history = [{ atMs: this.startedAtMs, steps: 0 }];

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
   * 1초 tick — 최근 구간의 누적 걸음 증가분으로 SPM을 만든다.
   *
   * 누적값의 출처가 둘이다. `watchStepCount` 구독과 `getStepCountAsync` 조회인데,
   * 구독이 조용한 기기가 있어 **둘 중 큰 값**을 쓴다. 어느 한쪽이 죽어도 측정이 멈추지 않는다.
   */
  private async tick(cb: (sample: CadenceSample) => void): Promise<void> {
    const now = Date.now();
    if (now <= this.lastTickMs) return;
    this.lastTickMs = now;

    let cumulative = this.cumulativeSteps;
    try {
      const queried = await Pedometer.getStepCountAsync(new Date(this.startedAtMs), new Date(now));
      if (queried?.steps !== undefined) cumulative = Math.max(cumulative, queried.steps);
    } catch {
      // 과거 구간 조회를 지원하지 않는 기기도 있다. 구독값만으로 계속한다.
    }
    // 누적값은 줄어들지 않는다. 조회가 잠깐 낮게 오더라도 뒤로 가지 않게 막는다.
    cumulative = Math.max(cumulative, this.cumulativeSteps);
    this.cumulativeSteps = cumulative;

    this.history = updateStepHistory(this.history, { atMs: now, steps: cumulative }, ROLLING_WINDOW_SEC);

    cb({
      elapsedSec: (now - this.startedAtMs) / 1000,
      cadence: rollingCadenceSpm(this.history),
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
