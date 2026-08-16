const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiErrorBody = {
  detail?: {
    code?: string;
    message?: string;
  };
};

export type AuthToken = {
  accessToken: string;
  tokenType: string;
  isNewUser: boolean;
};

export type RunningPurpose = 'COMPLETE' | 'HABIT' | 'WEIGHT' | 'FITNESS' | 'PERFORMANCE';

export type UserProfile = {
  id: string;
  onboarded: boolean;
  runningPurpose: RunningPurpose | null;
  experienceLevel: 0 | 1 | 2 | null;
  maxContinuousMin: number | null;
  weeklyGoalCount: number | null;
  baselineCadence: number | null;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  gender: 'M' | 'F' | 'O' | null;
};

export type UserProfilePatch = {
  runningPurpose: RunningPurpose;
  experienceLevel: 0 | 1 | 2;
  maxContinuousMin: number;
  weeklyGoalCount: number;
  baselineCadence: number;
  heightCm?: number;
  weightKg?: number;
  birthYear?: number;
  gender?: 'M' | 'F' | 'O';
};

export type RunUpload = {
  clientRunId: string;
  source: 'APP';
  planId: string | null;
  startedAt: string;
  endedAt: string;
  goalType: 'TIME' | 'DISTANCE';
  goalValue: number;
  condition: 1 | 3 | 5;
  targetCadenceMin: number;
  targetCadenceMax: number;
  finalTargetMin: number;
  finalTargetMax: number;
  durationSec: number;
  distanceM: number | null;
  avgCadence: number | null;
  avgPaceSecPerKm: number | null;
  completed: boolean;
  interventionCount: number;
  downshiftCount: number;
  samples: { t: number; c: number; p?: number | null; d?: number | null }[];
  events: { t: number; type: string; payload: object }[];
};

export type RunCreated = {
  id: string;
  clientRunId: string;
  isAnalyzable: boolean;
  analysisLimitation: string | null;
  rhythmScore: number | null;
  lateDropRate: number | null;
  fatigueIndex: number | null;
};

export type RunListItem = {
  id: string;
  startedAt: string;
  durationSec: number;
  distanceM: number | null;
  avgCadence: number | null;
  completed: boolean;
  source: 'APP' | 'MANUAL';
  rhythmScore: number | null;
  hasReport: boolean;
};

export type RunDetail = {
  id: string;
  source: 'APP' | 'MANUAL';
  startedAt: string;
  goalType: 'TIME' | 'DISTANCE' | null;
  goalValue: number | null;
  condition: 1 | 3 | 5 | null;
  durationSec: number;
  distanceM: number | null;
  avgCadence: number | null;
  avgPaceSecPerKm: number | null;
  completed: boolean;
  interventionCount: number | null;
  rhythmScore: number | null;
  memo: string | null;
  report: RunReport | null;
};

export type RunReport = {
  id: string;
  runId: string;
  verdict: string;
  evidence: string[];
  hypothesis: string | null;
  prescription: string | null;
  nextGoalText: string;
  nextTargetMin: number;
  nextTargetMax: number;
  recoveryNote: string | null;
  limitation: string | null;
  metrics: {
    rhythmScore: number | null;
    lateDropRate: number | null;
    fatigueIndex: number | null;
    inRangeSec: number | null;
  };
  isFallback: boolean;
};

export type CalendarDay = {
  date: string;
  plan: null | {
    id: string;
    status: 'PLANNED' | 'DONE' | 'SKIPPED';
    goalType: 'TIME' | 'DISTANCE';
    goalValue: number;
  };
  runs: {
    id: string;
    source: 'APP' | 'MANUAL';
    durationSec: number;
    completed: boolean;
  }[];
};

export type Stats = {
  totalRunDays: number;
  dalliDays: number;
  thisMonthDays: number;
  thisWeekCount: number;
  nextMilestone: number;
};

export type Plan = {
  id: string;
  plannedDate: string;
  goalType: 'TIME' | 'DISTANCE';
  goalValue: number;
  memo: string | null;
  status: 'PLANNED' | 'DONE' | 'SKIPPED';
  runId: string | null;
};

type UserProfileResponse = {
  id: string;
  onboarded: boolean;
  running_purpose: RunningPurpose | null;
  experience_level: 0 | 1 | 2 | null;
  max_continuous_min: number | null;
  weekly_goal_count: number | null;
  baseline_cadence: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  gender: 'M' | 'F' | 'O' | null;
};

function requireApiUrl() {
  if (!apiUrl) {
    throw new ApiError('Mock API 주소가 설정되지 않았어요. app/.env를 확인해 주세요.');
  }
  return apiUrl;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${requireApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.detail?.message ?? '서버 요청을 완료하지 못했어요.',
      response.status,
      body.detail?.code,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function authenticateDevice(deviceUuid: string): Promise<AuthToken> {
  const response = await request<{
    access_token: string;
    token_type: string;
    is_new_user: boolean;
  }>('/auth/device', {
    method: 'POST',
    body: JSON.stringify({ device_uuid: deviceUuid }),
  });

  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    isNewUser: response.is_new_user,
  };
}

function mapUserProfile(response: UserProfileResponse): UserProfile {
  return {
    id: response.id,
    onboarded: response.onboarded,
    runningPurpose: response.running_purpose,
    experienceLevel: response.experience_level,
    maxContinuousMin: response.max_continuous_min,
    weeklyGoalCount: response.weekly_goal_count,
    baselineCadence: response.baseline_cadence,
    heightCm: response.height_cm,
    weightKg: response.weight_kg,
    birthYear: response.birth_year,
    gender: response.gender,
  };
}

export async function getUserProfile(token: string): Promise<UserProfile> {
  const response = await request<UserProfileResponse>('/users/me', {}, token);
  return mapUserProfile(response);
}

export async function patchUserProfile(token: string, profile: UserProfilePatch): Promise<UserProfile> {
  const response = await request<UserProfileResponse>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify({
      running_purpose: profile.runningPurpose,
      experience_level: profile.experienceLevel,
      max_continuous_min: profile.maxContinuousMin,
      weekly_goal_count: profile.weeklyGoalCount,
      baseline_cadence: profile.baselineCadence,
      height_cm: profile.heightCm ?? null,
      weight_kg: profile.weightKg ?? null,
      birth_year: profile.birthYear ?? null,
      gender: profile.gender ?? null,
    }),
  }, token);
  return mapUserProfile(response);
}

export async function createRun(token: string, run: RunUpload): Promise<RunCreated> {
  const response = await request<{
    id: string;
    client_run_id: string;
    is_analyzable: boolean;
    analysis_limitation: string | null;
    rhythm_score: number | null;
    late_drop_rate: number | null;
    fatigue_index: number | null;
  }>('/runs', {
    method: 'POST',
    body: JSON.stringify({
      client_run_id: run.clientRunId,
      source: run.source,
      plan_id: run.planId,
      started_at: run.startedAt,
      ended_at: run.endedAt,
      goal_type: run.goalType,
      goal_value: run.goalValue,
      condition: run.condition,
      target_cadence_min: run.targetCadenceMin,
      target_cadence_max: run.targetCadenceMax,
      final_target_min: run.finalTargetMin,
      final_target_max: run.finalTargetMax,
      duration_sec: run.durationSec,
      distance_m: run.distanceM,
      avg_cadence: run.avgCadence,
      avg_pace_sec_per_km: run.avgPaceSecPerKm,
      completed: run.completed,
      intervention_count: run.interventionCount,
      downshift_count: run.downshiftCount,
      memo: null,
      samples: run.samples,
      events: run.events,
    }),
  }, token);

  return {
    id: response.id,
    clientRunId: response.client_run_id,
    isAnalyzable: response.is_analyzable,
    analysisLimitation: response.analysis_limitation,
    rhythmScore: response.rhythm_score,
    lateDropRate: response.late_drop_rate,
    fatigueIndex: response.fatigue_index,
  };
}

export async function getRuns(token: string): Promise<RunListItem[]> {
  const response = await request<{ items: {
    id: string;
    started_at: string;
    duration_sec: number;
    distance_m: number | null;
    avg_cadence: number | null;
    completed: boolean;
    source: 'APP' | 'MANUAL';
    rhythm_score: number | null;
    has_report: boolean;
  }[] }>('/runs?limit=20', {}, token);
  return response.items.map((item) => ({
    id: item.id,
    startedAt: item.started_at,
    durationSec: item.duration_sec,
    distanceM: item.distance_m,
    avgCadence: item.avg_cadence,
    completed: item.completed,
    source: item.source,
    rhythmScore: item.rhythm_score,
    hasReport: item.has_report,
  }));
}

export async function getRunDetail(token: string, runId: string): Promise<RunDetail> {
  const response = await request<{
    id: string;
    source: 'APP' | 'MANUAL';
    started_at: string;
    goal_type: 'TIME' | 'DISTANCE' | null;
    goal_value: number | null;
    condition: 1 | 3 | 5 | null;
    duration_sec: number;
    distance_m: number | null;
    avg_cadence: number | null;
    avg_pace_sec_per_km: number | null;
    completed: boolean;
    intervention_count: number | null;
    rhythm_score: number | null;
    memo: string | null;
    report: RunReportResponse | null;
  }>(`/runs/${runId}`, {}, token);

  return {
    id: response.id,
    source: response.source,
    startedAt: response.started_at,
    goalType: response.goal_type,
    goalValue: response.goal_value,
    condition: response.condition,
    durationSec: response.duration_sec,
    distanceM: response.distance_m,
    avgCadence: response.avg_cadence,
    avgPaceSecPerKm: response.avg_pace_sec_per_km,
    completed: response.completed,
    interventionCount: response.intervention_count,
    rhythmScore: response.rhythm_score,
    memo: response.memo,
    report: response.report ? mapRunReport(response.report) : null,
  };
}

type RunReportResponse = {
  id: string;
  run_id: string;
  verdict: string;
  evidence: string[];
  hypothesis: string | null;
  prescription: string | null;
  next_goal_text: string;
  next_target_min: number;
  next_target_max: number;
  recovery_note: string | null;
  limitation: string | null;
  metrics: {
    rhythm_score: number | null;
    late_drop_rate: number | null;
    fatigue_index: number | null;
    in_range_sec: number | null;
  };
  is_fallback: boolean;
};

function mapRunReport(response: RunReportResponse): RunReport {
  return {
    id: response.id,
    runId: response.run_id,
    verdict: response.verdict,
    evidence: response.evidence,
    hypothesis: response.hypothesis,
    prescription: response.prescription,
    nextGoalText: response.next_goal_text,
    nextTargetMin: response.next_target_min,
    nextTargetMax: response.next_target_max,
    recoveryNote: response.recovery_note,
    limitation: response.limitation,
    metrics: {
      rhythmScore: response.metrics.rhythm_score,
      lateDropRate: response.metrics.late_drop_rate,
      fatigueIndex: response.metrics.fatigue_index,
      inRangeSec: response.metrics.in_range_sec,
    },
    isFallback: response.is_fallback,
  };
}

export async function createRunReport(token: string, runId: string): Promise<RunReport> {
  return mapRunReport(await request<RunReportResponse>(`/runs/${runId}/report`, { method: 'POST' }, token));
}

export async function getRunReport(token: string, runId: string): Promise<RunReport> {
  return mapRunReport(await request<RunReportResponse>(`/runs/${runId}/report`, {}, token));
}

export async function deleteRun(token: string, runId: string): Promise<void> {
  await request<void>(`/runs/${runId}`, { method: 'DELETE' }, token);
}

export async function getCalendar(token: string, year: number, month: number): Promise<CalendarDay[]> {
  const response = await request<{ days: {
    date: string;
    plan: null | { id: string; status: 'PLANNED' | 'DONE' | 'SKIPPED'; goal_type: 'TIME' | 'DISTANCE'; goal_value: number };
    runs: { id: string; source: 'APP' | 'MANUAL'; duration_sec: number; completed: boolean }[];
  }[] }>(`/calendar?year=${year}&month=${month}`, {}, token);
  return response.days.map((day) => ({
    date: day.date,
    plan: day.plan ? {
      id: day.plan.id,
      status: day.plan.status,
      goalType: day.plan.goal_type,
      goalValue: day.plan.goal_value,
    } : null,
    runs: day.runs.map((run) => ({
      id: run.id,
      source: run.source,
      durationSec: run.duration_sec,
      completed: run.completed,
    })),
  }));
}

export async function getStats(token: string): Promise<Stats> {
  const response = await request<{
    total_run_days: number;
    dalli_days: number;
    this_month_days: number;
    this_week_count: number;
    next_milestone: number;
  }>('/stats', {}, token);
  return {
    totalRunDays: response.total_run_days,
    dalliDays: response.dalli_days,
    thisMonthDays: response.this_month_days,
    thisWeekCount: response.this_week_count,
    nextMilestone: response.next_milestone,
  };
}

export async function createPlan(
  token: string,
  input: { plannedDate: string; goalType: 'TIME' | 'DISTANCE'; goalValue: number; memo?: string },
): Promise<Plan> {
  const response = await request<{
    id: string;
    planned_date: string;
    goal_type: 'TIME' | 'DISTANCE';
    goal_value: number;
    memo: string | null;
    status: 'PLANNED' | 'DONE' | 'SKIPPED';
    run_id: string | null;
  }>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      planned_date: input.plannedDate,
      goal_type: input.goalType,
      goal_value: input.goalValue,
      memo: input.memo?.trim() || null,
    }),
  }, token);
  return {
    id: response.id,
    plannedDate: response.planned_date,
    goalType: response.goal_type,
    goalValue: response.goal_value,
    memo: response.memo,
    status: response.status,
    runId: response.run_id,
  };
}

export async function updatePlan(
  token: string,
  planId: string,
  input: { goalType?: 'TIME' | 'DISTANCE'; goalValue?: number; memo?: string; status?: 'PLANNED' | 'DONE' | 'SKIPPED' },
): Promise<Plan> {
  const response = await request<{
    id: string;
    planned_date: string;
    goal_type: 'TIME' | 'DISTANCE';
    goal_value: number;
    memo: string | null;
    status: 'PLANNED' | 'DONE' | 'SKIPPED';
    run_id: string | null;
  }>(`/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(input.goalType ? { goal_type: input.goalType } : {}),
      ...(input.goalValue !== undefined ? { goal_value: input.goalValue } : {}),
      ...(input.memo !== undefined ? { memo: input.memo.trim() || null } : {}),
      ...(input.status ? { status: input.status } : {}),
    }),
  }, token);
  return {
    id: response.id,
    plannedDate: response.planned_date,
    goalType: response.goal_type,
    goalValue: response.goal_value,
    memo: response.memo,
    status: response.status,
    runId: response.run_id,
  };
}

export async function deletePlan(token: string, planId: string): Promise<void> {
  await request<void>(`/plans/${planId}`, { method: 'DELETE' }, token);
}

export async function createManualRun(
  token: string,
  input: { clientRunId: string; startedAt: string; durationSec: number; distanceM?: number; memo?: string },
): Promise<RunCreated> {
  const response = await request<{
    id: string;
    client_run_id: string;
    is_analyzable: boolean;
    analysis_limitation: string | null;
    rhythm_score: number | null;
    late_drop_rate: number | null;
    fatigue_index: number | null;
  }>('/runs', {
    method: 'POST',
    body: JSON.stringify({
      client_run_id: input.clientRunId,
      source: 'MANUAL',
      plan_id: null,
      started_at: input.startedAt,
      duration_sec: input.durationSec,
      distance_m: input.distanceM ?? null,
      condition: 3,
      completed: true,
      memo: input.memo?.trim() || null,
    }),
  }, token);
  return {
    id: response.id,
    clientRunId: response.client_run_id,
    isAnalyzable: response.is_analyzable,
    analysisLimitation: response.analysis_limitation,
    rhythmScore: response.rhythm_score,
    lateDropRate: response.late_drop_rate,
    fatigueIndex: response.fatigue_index,
  };
}
