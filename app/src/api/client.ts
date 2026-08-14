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

export type UserProfilePatch = {
  experienceLevel: 0 | 1 | 2;
  maxContinuousMin: number;
  weeklyGoalCount: number;
  baselineCadence: number;
  heightCm?: number;
  weightKg?: number;
  birthYear?: number;
  gender?: 'M' | 'F' | 'O';
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

export async function patchUserProfile(token: string, profile: UserProfilePatch) {
  return request('/users/me', {
    method: 'PATCH',
    body: JSON.stringify({
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
}
