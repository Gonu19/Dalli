/**
 * 20초 슬라이딩 윈도우 (`ENGINE.md` §4).
 *
 * 소스가 흘려보낸 순간 SPM을 모아 **중앙값**을 낸다. 이 값이 판정용 cadence다.
 * 순수 TS라 센서 없이 `ReplaySource`로 그대로 검증된다.
 */

import { SENSOR_COVERAGE_MIN, WINDOW_SEC } from './constants';
import { median } from './math';

export class CadenceWindow {
  private samples: { t: number; c: number }[] = [];

  constructor(private readonly windowSec: number = WINDOW_SEC) {}

  push(t: number, cadence: number): void {
    this.samples = [...this.samples, { t, c: cadence }].filter(
      (sample) => t - sample.t < this.windowSec,
    );
  }

  /**
   * 판정용 cadence. 품질이 모자라면 `null`을 돌려주고 판정은 `UNAVAILABLE`로 간다.
   *
   * 품질은 **샘플 개수가 아니라 시간 커버리지**로 잰다 — 소스마다 tick 간격이 다르기 때문이다
   * (실센서 1초, `ReplaySource` 5초). 시작 직후에는 윈도우가 아직 못 찼으므로 경과 시간을 기준으로 본다.
   */
  value(elapsedSec: number): number | null {
    if (this.samples.length < 2) return null;

    const reference = Math.min(this.windowSec, elapsedSec);
    if (reference <= 0) return null;

    const span = this.samples[this.samples.length - 1].t - this.samples[0].t;
    if (span / reference < SENSOR_COVERAGE_MIN) return null;

    return median(this.samples.map((sample) => sample.c));
  }

  reset(): void {
    this.samples = [];
  }
}
