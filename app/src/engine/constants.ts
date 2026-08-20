/**
 * `ENGINE.md` §1 수치표를 그대로 옮긴 것. **이 파일에서 숫자를 새로 만들지 않는다.**
 * 값이 문서와 다르면 문서가 맞다 (`AGENTS.md` §5).
 */

import type { ConditionLevel, ConditionValue, ExperienceLevel, RunningPurpose } from './types';

/** 초기 목표값 규칙표 — 경험 수준 기준값 (§2). 1회차 러닝에만 쓰인다. */
export const EXPERIENCE_BASE_CADENCE: Record<ExperienceLevel, number> = {
  0: 140,
  1: 150,
  2: 160,
};

/** 초기 목표값 규칙표 — 목적 보정 (§2). 의도적으로 낮게 잡는다. */
export const PURPOSE_ADJUST: Record<RunningPurpose, number> = {
  COMPLETE: 0,
  HABIT: -2,
  WEIGHT: -2,
  FITNESS: 2,
  PERFORMANCE: 4,
};

// 측정 사이클 (§4)
export const WINDOW_SEC = 20;
export const TICK_SEC = 5;
export const SENSOR_TICK_SEC = 1;
export const SAMPLE_INTERVAL_SEC = 5;

/**
 * 센서 품질 하한. 미달이면 판정을 멈추고 `UNAVAILABLE`을 노출한다.
 * 서버의 유효 러닝 판정(`CONTRACT.md` 70%)과 같은 값을 쓴다 — 기준이 갈리면
 * 앱은 정상 판정했는데 서버는 분석 불가로 답하는 상황이 생긴다.
 */
export const SENSOR_COVERAGE_MIN = 0.7;

// 판정 타임라인 (§5)
export const WARMUP_SEC = 90;
/**
 * 저속 안내의 성격이 바뀌는 경계.
 *
 * 이 시각 **이전**에는 "목표 리듬을 들려드릴게요" + 메트로놈으로 리듬만 주고,
 * 이후에는 회복을 요구하는 기존 문구를 쓴다 (§7). 판정·하향은 양쪽 다 정상으로 돈다.
 */
export const SLOW_JUDGE_START_SEC = 300;
/**
 * 5분 이전 저속 안내 상한 (§5).
 *
 * 2회를 채우면 실패 2회가 되어 그대로 하향으로 이어진다 (§8). 그 이상은 재촉이 된다.
 */
export const MAX_EARLY_SLOW_INTERVENTION = 2;

// cadence 구간 (§4)
export const IDLE_CADENCE_THRESHOLD = 50;
export const WALK_CADENCE_MIN = 50;
export const WALK_CADENCE_MAX = 120;

// 목표 범위 (§3)
export const TARGET_HALF_WIDTH = 4;
export const CADENCE_CLAMP_MIN = 130;
export const CADENCE_CLAMP_MAX = 185;

/** UI 3단계 → 저장값 1/3/5 (§3). DB·API·FI는 모두 저장값을 쓴다. */
export const CONDITION_VALUE: Record<ConditionLevel, ConditionValue> = {
  TIRED: 1,
  NORMAL: 3,
  LIGHT: 5,
};

/** 저장값 기준 목표 보정폭 (§1). */
export const CONDITION_ADJUST: Record<ConditionValue, number> = {
  1: -3,
  3: 0,
  5: 2,
};

// 이탈 · 회복 (§7)
export const DEVIATION_SEC = 20;
export const SEVERE_DEVIATION_SEC = 10;
export const SEVERE_THRESHOLD = 10;
/** 회복은 언제나 중심 ±3. 이탈 진입(±4 초과)과 기준이 다르다 — 히스테리시스이므로 뒤집지 말 것. */
export const RECOVERY_HALF_WIDTH = 3;
export const COOLDOWN_SEC = 60;

// 개입 오디오 (§7)
export const VOICE_MAX_SEC = 3;
export const METRONOME_SEC = 5;
/**
 * 러닝 시작 안내에서 들려주는 목표 리듬 길이(초).
 * 개입보다 길게 주는 이유는, 시작 시점에는 고칠 것이 아니라 기준을 몸에 넣는 것이기 때문이다.
 */
export const METRONOME_INTRO_SEC = 10;
/**
 * 기준 리듬을 다시 들려주는 주기(초).
 * **개입이 있었던 주기는 건너뛴다.** 방금 지적을 받은 사람에게 또 소리를 내면
 * 쿨다운(§7)이 무의미해지고, 개입 신호가 주기 소리에 묻힌다.
 */
export const PACE_REMINDER_SEC = 60;
export const MAX_FAST_INTERVENTION = 2;
/** 목표 90% 도달 이후 `TOO_FAST` 중지 — 막판 스퍼트 허용 (§10). */
export const FAST_MUTE_PROGRESS = 0.9;

// Downshift (§8)
export const DOWNSHIFT_FAIL_NORMAL = 2;
export const DOWNSHIFT_FAIL_SEVERE = 1;
export const WALK_SEC = 60;
export const MAX_DOWNSHIFT = 2;
export const DOWNSHIFT_INTERVAL_SEC = 300;
export const DOWNSHIFT_FLOOR = 130;
export const MAX_DOWNSHIFT_STEP = 5;
export const DOWNSHIFT_MEDIAN_MIN_SAMPLES = 4;
export const RESTABILIZE_SEC = 30;

/**
 * 실측 baseline 산출 구간 (§2). 러닝 **종료 후** samples에서 계산해
 * `PATCH /users/me`로 확정한다. 러닝 중 캘리브레이션은 없다.
 */
export const BASELINE_WINDOW_START_SEC = 90;
export const BASELINE_WINDOW_END_SEC = 270;
export const BASELINE_MIN_SAMPLES = 30;
export const BASELINE_MIN_DURATION_SEC = 360;

/**
 * 온보딩에서 초기 목표값을 손으로 조절할 수 있는 폭 — 추천값 기준 ±10 (§2).
 * 절대 상·하한은 `CADENCE_CLAMP_MIN/MAX`가 언제나 우선한다.
 */
export const INITIAL_TARGET_ADJUST_RANGE = 10;

/** 조절 버튼 단위 (§2). `±5`가 있어야 조절 폭 ±10을 두 번에 오갈 수 있다. */
export const INITIAL_TARGET_ADJUST_STEPS = [-5, -1, 1, 5] as const;

/**
 * 온보딩 전체 건너뛰기 기본값 (§2).
 *
 * 값을 비워 보내면 서버의 `onboarded`가 계속 `false`라 앱이 온보딩으로 되돌아온다
 * (`CONTRACT.md`). 그래서 **비우지 않고 가장 보수적인 값을 대신 보낸다.**
 * 초기 목표값은 이 조합에서 `computeInitialTargetCadence`가 그대로 계산한다(152).
 */
export const ONBOARDING_SKIP_DEFAULTS = {
  runningPurpose: 'COMPLETE',
  experienceLevel: 0,
  maxContinuousMin: 10,
  weeklyGoalCount: 3,
} as const;
