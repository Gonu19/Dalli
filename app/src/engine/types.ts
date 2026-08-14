/**
 * 엔진 공개 타입 — UI FE가 읽는 유일한 접점 (`AGENTS.md` §2).
 * 순수 TS. `react-native` import 금지 (`ENGINE.md` §0).
 *
 * 용어
 * - **초기 목표값**: 온보딩에서 규칙 기반으로 잡는 첫 러닝의 목표 중심값.
 * - **baseline**: 1회차 러닝이 끝난 뒤 samples에서 산출해 확정하는 그 사람의 기준 리듬 (`ENGINE.md` §2).
 *   러닝 중에는 측정하지 않는다. 2회차부터 목표 중심값의 원천이 된다.
 */

/** 세션 상태 (`ENGINE.md` §6). `CALIBRATING`은 존재하지 않는다. */
export type RunState = 'IDLE' | 'RUNNING' | 'PAUSED';

/**
 * 화면에 노출되는 판정 4상태 (`ROADMAP.md` `F1-05`).
 * 러닝 중 화면은 이 값으로 현재 리듬 숫자의 색을 정한다 (`ENGINE.md` §3).
 */
export type JudgeVerdict = 'IN_RANGE' | 'TOO_FAST' | 'TOO_SLOW' | 'UNAVAILABLE';

/** 판정 상태머신의 내부 단계 (`ENGINE.md` §6). UI는 색 결정에 `JudgeVerdict`만 쓴다. */
export type JudgePhase =
  | 'WARMUP'
  | 'IN_RANGE'
  | 'DEVIATING'
  | 'INTERVENED'
  | 'COOLDOWN'
  | 'FAILED'
  | 'DOWNSHIFT'
  | 'RECOVERY';

/** 윈도우 cadence 구간 (`ENGINE.md` §4). */
export type CadenceZone = 'IDLE' | 'WALK' | 'RUN';

/** 이탈 방향. downshift로 이어지는 것은 `SLOW`뿐이다 (`ENGINE.md` §7 비대칭 원칙). */
export type DeviationDirection = 'FAST' | 'SLOW';

/** 온보딩 경험 수준. 초기 목표값 계산에 쓰이는 두 입력 중 하나 (`ENGINE.md` §2). */
export type ExperienceLevel = 0 | 1 | 2;

/** 온보딩 러닝 목적. `CONTRACT.md`의 `running_purpose`와 같은 enum이다. */
export type RunningPurpose = 'COMPLETE' | 'HABIT' | 'WEIGHT' | 'FITNESS' | 'PERFORMANCE';

/** 컨디션 — UI 3단계, 저장값 1/3/5 (`ENGINE.md` §3). 2·4는 사용하지 않는다. */
export type ConditionLevel = 'TIRED' | 'NORMAL' | 'LIGHT';
export type ConditionValue = 1 | 3 | 5;

/**
 * 목표 범위. DB·API는 `target_cadence_min/max`가 원본이고
 * `center`는 `(min + max) / 2`다 (±4 대칭이라 항상 정수).
 * 화면·음성에는 `center` 하나만 노출한다 (`ENGINE.md` §3).
 */
export type TargetRange = {
  center: number;
  min: number;
  max: number;
};

/** 소스가 흘려보내는 샘플. 시간축은 wall-clock이 아니라 경과 초다 (`ENGINE.md` §6). */
export type CadenceSample = {
  elapsedSec: number;
  cadence: number;
  /** GPS 미수신 시 생략 (`ENGINE.md` §10). */
  pace?: number;
  dist?: number;
};

/**
 * 시간을 만드는 유일한 지점. 엔진은 여기서 받은 `elapsedSec`으로만 시간을 판단한다.
 * `PedometerSource`(실센서)와 `ReplaySource`(배열 재생)가 같은 인터페이스를 구현한다.
 */
export type CadenceSource = {
  start(cb: (sample: CadenceSample) => void): void;
  stop(): void;
};

/** 목표 하향 사유 (`ENGINE.md` §7). */
export type TargetAdjustedReason = 'no_recovery' | 'severe' | 'walking';

/** 리커버리 진입 사유 (`ENGINE.md` §7). */
export type RecoveryReason = 'downshift_exhausted' | 'floor_reached';

/**
 * 러닝 이벤트. `type`과 `payload`는 `CONTRACT.md`의 `events[]`와 1:1로 대응한다.
 * 업로드 시 `t`는 `elapsedSec`을 그대로 쓴다.
 */
export type RunEvent =
  | { t: number; type: 'RUN_START'; payload: { min: number; max: number } }
  | { t: number; type: 'TOO_FAST'; payload: { cadence: number } }
  | { t: number; type: 'TOO_SLOW'; payload: { cadence: number } }
  | {
      t: number;
      type: 'TARGET_ADJUSTED';
      payload: { min: number; max: number; reason: TargetAdjustedReason };
    }
  | { t: number; type: 'RECOVERY_MODE_ON'; payload: { reason: RecoveryReason } }
  | { t: number; type: 'PAUSE'; payload: Record<string, never> }
  | { t: number; type: 'RESUME'; payload: Record<string, never> }
  | { t: number; type: 'RUN_END'; payload: { completed: boolean } };

export type RunEventType = RunEvent['type'];
