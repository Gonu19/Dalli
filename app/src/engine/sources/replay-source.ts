/**
 * 배열을 그대로 흘려보내는 `CadenceSource` (`ENGINE.md` §6·§11).
 *
 * 엔진은 `elapsedSec`으로만 시간을 판단하므로, 여기서 `speed`배로 빨리 흘려보내면
 * 쿨다운·이탈 지속·하향 간격까지 전부 같이 배속된다. 엔진 코드는 한 줄도 바뀌지 않는다.
 * 센서도 맥도 없이 Windows + Node에서 판정 전체를 검증하는 통로다 (`ROADMAP.md` §1-1 ①층).
 */

import type { CadenceSample, CadenceSource } from '../types';

export type ReplayOptions = {
  /** 재생 배속. `Infinity`면 타이머 없이 동기로 전부 흘려보낸다 (Node 검증용). */
  speed?: number;
  /** 마지막 샘플까지 흘려보낸 뒤 1회 호출. */
  onEnd?: () => void;
};

export class ReplaySource implements CadenceSource {
  private readonly samples: readonly CadenceSample[];
  private readonly speed: number;
  private readonly onEnd?: () => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private index = 0;
  private running = false;

  constructor(samples: readonly CadenceSample[], options: ReplayOptions = {}) {
    // elapsedSec 순서가 어긋난 배열이 들어와도 재생 간격이 음수가 되지 않도록 정렬해 둔다.
    this.samples = [...samples].sort((a, b) => a.elapsedSec - b.elapsedSec);
    this.speed = options.speed ?? 1;
    this.onEnd = options.onEnd;
  }

  start(cb: (sample: CadenceSample) => void): void {
    if (this.running) return;
    this.running = true;
    this.index = 0;

    if (this.speed === Infinity) {
      for (const sample of this.samples) {
        if (!this.running) return;
        cb(sample);
      }
      this.finish();
      return;
    }

    this.schedule(cb);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(cb: (sample: CadenceSample) => void): void {
    if (!this.running) return;

    const sample = this.samples[this.index];
    if (sample === undefined) {
      this.finish();
      return;
    }

    const previous = this.index === 0 ? null : this.samples[this.index - 1];
    const gapSec = previous === null ? sample.elapsedSec : sample.elapsedSec - previous.elapsedSec;

    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.running) return;
        this.index += 1;
        cb(sample);
        this.schedule(cb);
      },
      Math.max(0, (gapSec * 1000) / this.speed),
    );
  }

  private finish(): void {
    this.running = false;
    this.timer = null;
    this.onEnd?.();
  }
}
