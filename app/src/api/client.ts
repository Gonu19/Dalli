import type { components } from '../types/api';

type ApiSchemas = components['schemas'];
type UserMeResponse = ApiSchemas['UserMeResponse'];
type UserMeUpdate = ApiSchemas['UserMeUpdate'];
type DeviceAuthRequest = ApiSchemas['DeviceAuthRequest'];
type AppRunCreate = ApiSchemas['AppRunCreate'];
type ManualRunCreate = ApiSchemas['ManualRunCreate'];
type RunCreateResponse = ApiSchemas['RunCreateResponse'];
type RunListResponse = ApiSchemas['RunListResponse'];
type RunDetailResponse = ApiSchemas['RunDetailResponse'];
type RunReportResponse = ApiSchemas['ReportResponse'];
type PlanListResponse = ApiSchemas['PlanListResponse'];
type PlanCreate = ApiSchemas['PlanCreate'];
type PlanResponse = ApiSchemas['PlanResponse'];
type PlanUpdate = ApiSchemas['PlanUpdate'];
type CalendarResponse = ApiSchemas['CalendarResponse'];
type StatsResponse = ApiSchemas['StatsResponse'];

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

type ApiErrorBody = Partial<ApiSchemas['ErrorResponse']>;

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
  runningPurpose?: RunningPurpose;
  experienceLevel?: 0 | 1 | 2;
  maxContinuousMin?: number;
  weeklyGoalCount?: number;
  baselineCadence?: number;
  heightCm?: number | null;
  weightKg?: number | null;
  birthYear?: number | null;
  gender?: 'M' | 'F' | 'O' | null;
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
  samples: ApiSchemas['RunSample'][];
  events: ApiSchemas['RunEvent'][];
};

export type RunCreated = {
  id: string;
  clientRunId: string;
  isAnalyzable: boolean;
  analysisLimitation: ApiSchemas['RunCreateResponse']['analysis_limitation'];
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
  clientRunId: string;
  source: 'APP' | 'MANUAL';
  planId: string | null;
  startedAt: string;
  endedAt: string | null;
  goalType: 'TIME' | 'DISTANCE' | null;
  goalValue: number | null;
  condition: 1 | 3 | 5 | null;
  targetCadenceMin: number | null;
  targetCadenceMax: number | null;
  finalTargetMin: number | null;
  finalTargetMax: number | null;
  durationSec: number;
  distanceM: number | null;
  avgCadence: number | null;
  avgPaceSecPerKm: number | null;
  completed: boolean;
  interventionCount: number | null;
  downshiftCount: number | null;
  rhythmScore: number | null;
  lateDropRate: number | null;
  fatigueIndex: number | null;
  memo: string | null;
  isAnalyzable: boolean;
  analysisLimitation: 'MANUAL_RUN' | 'TOO_SHORT' | 'INSUFFICIENT_SENSOR_DATA' | null;
  samples: ApiSchemas['RunSample'][] | null;
  events: ApiSchemas['RunEvent'][] | null;
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
  recentRun: {
    id: string;
    date: string;
    durationSec: number;
    completed: boolean;
  } | null;
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

function requireApiUrl() {
  if (!apiUrl) {
    throw new ApiError('API 주소가 설정되지 않았어요. app/.env를 확인해 주세요.', undefined, 'CONFIGURATION_ERROR');
  }
  return apiUrl;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    });
    headers.delete('X-Mock-Scenario');
    response = await fetch(`${requireApiUrl()}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError('네트워크에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.', undefined, 'NETWORK_ERROR');
  }

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

export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NETWORK_ERROR';
}

export async function authenticateDevice(deviceUuid: string): Promise<AuthToken> {
  const body: DeviceAuthRequest = { device_uuid: deviceUuid };
  const response = await request<ApiSchemas['DeviceAuthResponse']>('/auth/device', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    isNewUser: response.is_new_user,
  };
}

function mapRunningPurpose(value: UserMeResponse['running_purpose']): RunningPurpose | null {
  if (value === null || value === 'COMPLETE' || value === 'HABIT' || value === 'WEIGHT' || value === 'FITNESS' || value === 'PERFORMANCE') return value;
  throw new ApiError('서버의 러닝 목적 값이 올바르지 않아요.', undefined, 'CONTRACT_ERROR');
}

function mapUserProfile(response: UserMeResponse): UserProfile {
  return {
    id: response.id,
    onboarded: response.onboarded,
    runningPurpose: mapRunningPurpose(response.running_purpose),
    experienceLevel: mapExperienceLevel(response.experience_level),
    maxContinuousMin: response.max_continuous_min,
    weeklyGoalCount: response.weekly_goal_count,
    baselineCadence: response.baseline_cadence,
    heightCm: response.height_cm,
    weightKg: response.weight_kg,
    birthYear: response.birth_year,
    gender: response.gender,
  };
}

function mapExperienceLevel(value: number | null): 0 | 1 | 2 | null {
  if (value === null || value === 0 || value === 1 || value === 2) return value;
  throw new ApiError('서버의 러닝 경험 값이 올바르지 않아요.');
}

function mapCondition(value: number | null): 1 | 3 | 5 | null {
  if (value === null || value === 1 || value === 3 || value === 5) return value;
  throw new ApiError('서버의 컨디션 값이 올바르지 않아요.');
}

export async function getUserProfile(token: string): Promise<UserProfile> {
  const response = await request<UserMeResponse>('/users/me', {}, token);
  return mapUserProfile(response);
}

export async function patchUserProfile(token: string, profile: UserProfilePatch): Promise<UserProfile> {
  const body: UserMeUpdate = {
    ...(profile.runningPurpose !== undefined ? { running_purpose: profile.runningPurpose } : {}),
    ...(profile.experienceLevel !== undefined ? { experience_level: profile.experienceLevel } : {}),
    ...(profile.maxContinuousMin !== undefined ? { max_continuous_min: profile.maxContinuousMin } : {}),
    ...(profile.weeklyGoalCount !== undefined ? { weekly_goal_count: profile.weeklyGoalCount } : {}),
    ...(profile.baselineCadence !== undefined ? { baseline_cadence: profile.baselineCadence } : {}),
    ...(profile.heightCm !== undefined ? { height_cm: profile.heightCm } : {}),
    ...(profile.weightKg !== undefined ? { weight_kg: profile.weightKg } : {}),
    ...(profile.birthYear !== undefined ? { birth_year: profile.birthYear } : {}),
    ...(profile.gender !== undefined ? { gender: profile.gender } : {}),
  };
  const response = await request<UserMeResponse>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, token);
  return mapUserProfile(response);
}

export async function createRun(token: string, run: RunUpload): Promise<RunCreated> {
  const body: AppRunCreate = {
    client_run_id: run.clientRunId,
    source: run.source,
    started_at: run.startedAt,
    duration_sec: run.durationSec,
    condition: run.condition,
    goal_type: run.goalType,
    goal_value: run.goalValue,
    target_cadence_min: run.targetCadenceMin,
    target_cadence_max: run.targetCadenceMax,
    final_target_min: run.finalTargetMin,
    final_target_max: run.finalTargetMax,
    avg_cadence: run.avgCadence,
    completed: run.completed,
    intervention_count: run.interventionCount,
    downshift_count: run.downshiftCount,
    samples: run.samples,
    events: run.events,
    ...(run.planId !== null ? { plan_id: run.planId } : {}),
    ...(run.endedAt ? { ended_at: run.endedAt } : {}),
    ...(run.distanceM !== null ? { distance_m: run.distanceM } : {}),
    ...(run.avgPaceSecPerKm !== null ? { avg_pace_sec_per_km: run.avgPaceSecPerKm } : {}),
  };
  const response = await request<RunCreateResponse>('/runs', {
    method: 'POST',
    body: JSON.stringify(body),
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
  const response = await request<RunListResponse>('/runs?limit=20', {}, token);
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
  const response = await request<RunDetailResponse>(`/runs/${runId}`, {}, token);

  return {
    id: response.id,
    clientRunId: response.client_run_id,
    source: response.source,
    planId: response.plan_id,
    startedAt: response.started_at,
    endedAt: response.ended_at,
    goalType: response.goal_type,
    goalValue: response.goal_value,
    condition: mapCondition(response.condition),
    targetCadenceMin: response.target_cadence_min,
    targetCadenceMax: response.target_cadence_max,
    finalTargetMin: response.final_target_min,
    finalTargetMax: response.final_target_max,
    durationSec: response.duration_sec,
    distanceM: response.distance_m,
    avgCadence: response.avg_cadence,
    avgPaceSecPerKm: response.avg_pace_sec_per_km,
    completed: response.completed,
    interventionCount: response.intervention_count,
    downshiftCount: response.downshift_count,
    rhythmScore: response.rhythm_score,
    lateDropRate: response.late_drop_rate,
    fatigueIndex: response.fatigue_index,
    memo: response.memo,
    isAnalyzable: response.is_analyzable,
    analysisLimitation: response.analysis_limitation,
    samples: response.samples,
    events: response.events,
    report: response.report ? mapRunReport(response.report) : null,
  };
}

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
  const response = await request<CalendarResponse>(`/calendar?year=${year}&month=${month}`, {}, token);
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
  const response = await request<StatsResponse>('/stats', {}, token);
  return {
    totalRunDays: response.total_run_days,
    dalliDays: response.dalli_days,
    thisMonthDays: response.this_month_days,
    thisWeekCount: response.this_week_count,
    nextMilestone: response.next_milestone,
    recentRun: response.recent_run ? {
      id: response.recent_run.id,
      date: response.recent_run.date,
      durationSec: response.recent_run.duration_sec,
      completed: response.recent_run.completed,
    } : null,
  };
}

export async function createPlan(
  token: string,
  input: { plannedDate: string; goalType: 'TIME' | 'DISTANCE'; goalValue: number; memo?: string },
): Promise<Plan> {
  const body: PlanCreate = {
    planned_date: input.plannedDate,
    goal_type: input.goalType,
    goal_value: input.goalValue,
    memo: input.memo?.trim() || null,
  };
  const response = await request<PlanResponse>('/plans', {
    method: 'POST',
    body: JSON.stringify(body),
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

export async function getPlans(token: string, from: string, to: string): Promise<Plan[]> {
  const response = await request<PlanListResponse>(`/plans?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {}, token);
  return response.items.map(mapPlan);
}

function mapPlan(response: PlanResponse): Plan {
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
  input: { goalType?: 'TIME' | 'DISTANCE'; goalValue?: number; status?: 'PLANNED' | 'DONE' | 'SKIPPED' },
): Promise<Plan> {
  const body: PlanUpdate = {
    ...(input.goalType ? { goal_type: input.goalType } : {}),
    ...(input.goalValue !== undefined ? { goal_value: input.goalValue } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const response = await request<PlanResponse>(`/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, token);
  return mapPlan(response);
}

export async function deletePlan(token: string, planId: string): Promise<void> {
  await request<void>(`/plans/${planId}`, { method: 'DELETE' }, token);
}

export async function createManualRun(
  token: string,
  input: { clientRunId: string; startedAt: string; durationSec: number; distanceM?: number; memo?: string },
): Promise<RunCreated> {
  const body: ManualRunCreate = {
    client_run_id: input.clientRunId,
    source: 'MANUAL',
    started_at: input.startedAt,
    duration_sec: input.durationSec,
    completed: true,
    ...(input.distanceM !== undefined ? { distance_m: input.distanceM } : {}),
    ...(input.memo !== undefined ? { memo: input.memo.trim() || null } : {}),
  };
  const response = await request<RunCreateResponse>('/runs', {
    method: 'POST',
    body: JSON.stringify(body),
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
