# CONTRACT.md — API 계약 (단일 진실)

**소유: 김은송 (BE)** · 프론트는 읽기만, 변경은 GitHub 이슈로 요청.

- Base URL: `EXPO_PUBLIC_API_URL` (예: `http://<EC2-IP>:8000`)
- 모든 필드 `snake_case`. 시각은 ISO8601 UTC (`2026-08-13T09:00:00Z`).
- 인증: `Authorization: Bearer <jwt>` (`/auth/device` 제외)
- 에러: `{"detail": {"code": "...", "message": "..."}}`

| 코드 | HTTP |
| --- | --- |
| `UNAUTHORIZED` | 401 |
| `NOT_FOUND` | 404 |
| `VALIDATION_ERROR` | 422 |
| `DUPLICATE_RUN` | 409 |
| `LLM_TIMEOUT` | 200 (`is_fallback: true`로 응답) |

## 엔드포인트 요약
| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/auth/device` | 기기 UUID 로그인/가입 → JWT |
| GET | `/users/me` | 프로필 조회 |
| PATCH | `/users/me` | 프로필·baseline 수정 |
| POST | `/runs` | 러닝 업로드 (멱등) |
| GET | `/runs` | 목록 (페이지네이션) |
| GET | `/runs/{run_id}` | 상세 (samples/events 포함) |
| POST | `/runs/{run_id}/report` | AI 리포트 생성 |
| GET | `/runs/{run_id}/report` | 리포트 조회 |
| GET | `/plans` | 기간별 계획 |
| POST | `/plans` | 계획 생성 |
| PATCH | `/plans/{plan_id}` | 수정·완료 처리 |
| DELETE | `/plans/{plan_id}` | 삭제 |
| GET | `/calendar` | 월별 계획+기록 통합 |
| GET | `/stats` | 누적 러닝 데이 · 요약 |

---

## POST /auth/device
```json
// req
{ "device_uuid": "A1B2-C3D4" }
// res 200
{ "access_token": "eyJ...", "token_type": "bearer", "is_new_user": true }
```

## GET /users/me
```json
{
  "id": "uuid",
  "experience_level": 0,
  "max_continuous_min": 10,
  "weekly_goal_count": 3,
  "baseline_cadence": 157,
  "height_cm": 165, "weight_kg": 54.0, "birth_year": 2004, "gender": "F"
}
```
`PATCH /users/me` — 위 필드 부분 수정. `baseline_cadence`는 첫 러닝 확정 후 클라이언트가 PATCH.

## POST /runs
`client_run_id` 기준 멱등. 동일 값 재요청 시 기존 run을 200으로 반환.

```json
// req
{
  "client_run_id": "uuid-v4-from-device",
  "source": "APP",                       // APP | MANUAL
  "plan_id": null,
  "started_at": "2026-08-13T09:00:00Z",
  "ended_at":   "2026-08-13T09:20:30Z",
  "goal_type": "TIME",                   // TIME | DISTANCE
  "goal_value": 1200,                    // sec | meter
  "condition": 3,                        // 1~5
  "target_cadence_min": 154, "target_cadence_max": 162,
  "final_target_min": 148,  "final_target_max": 156,
  "duration_sec": 1230, "distance_m": 2840,
  "avg_cadence": 156, "avg_pace_sec_per_km": 433,
  "completed": true,
  "intervention_count": 2, "downshift_count": 1,
  "memo": null,
  "samples": [ { "t": 0, "c": 158, "p": 380, "d": 0 } ],
  "events":  [ { "t": 0, "type": "RUN_START", "payload": { "min": 154, "max": 162 } } ]
}
```
```json
// res 201 — rhythm_score/late_drop_rate/fatigue_index는 서버 계산
{
  "id": "uuid", "client_run_id": "...", "created_at": "...",
  "rhythm_score": 0.72, "late_drop_rate": 0.11, "fatigue_index": 0.34
}
```

`source: "MANUAL"` (수기 기록)은 `duration_sec`·`goal_*`만 필수. `samples`/`events`는 생략, 지표는 `null`.

## GET /runs?limit=20&cursor=
```json
{
  "items": [ { "id": "uuid", "started_at": "...", "duration_sec": 1230, "distance_m": 2840,
               "avg_cadence": 156, "completed": true, "source": "APP",
               "rhythm_score": 0.72, "has_report": true } ],
  "next_cursor": null
}
```

## GET /runs/{run_id}
`POST /runs` 요청 바디 + 서버 계산 지표 전체 + `report`(있으면).

## POST /runs/{run_id}/report
LLM 8초 타임아웃. 초과 시 룰베이스 폴백 문구로 **200 응답** (`is_fallback: true`).

```json
{
  "id": "uuid", "run_id": "uuid",
  "verdict": "초반 과속 없이 안정적으로 완주한 러닝이에요",
  "hypothesis": "후반 페이스가 낮아진 원인은 초반보다 빠른 리듬으로 시작한 영향일 수 있어요",
  "prescription": "다음 러닝에서는 시작 5분 동안 현재보다 낮은 리듬을 유지해 보세요",
  "next_goal_text": "다음 목표: 18분 완주, 목표 케이던스 154~160spm",
  "next_target_min": 154, "next_target_max": 160,
  "metrics": { "rhythm_score": 0.72, "late_drop_rate": 0.11,
               "fatigue_index": 0.34, "in_range_sec": 886 },
  "is_fallback": false, "model": "claude-...", "created_at": "..."
}
```
**다음 목표 추천 전용 API는 없습니다.** 이 응답에 포함.

## /plans
```json
// POST req
{ "planned_date": "2026-08-15", "goal_type": "TIME", "goal_value": 1200, "memo": "저녁 러닝" }
// res / GET item
{ "id": "uuid", "planned_date": "2026-08-15", "goal_type": "TIME", "goal_value": 1200,
  "memo": "저녁 러닝", "status": "PLANNED", "run_id": null }
```
`GET /plans?from=2026-08-01&to=2026-08-31` · `PATCH`로 `status`(`PLANNED|DONE|SKIPPED`)·목표 수정.

## GET /calendar?year=2026&month=8
```json
{
  "days": [
    { "date": "2026-08-11", "plan": null,
      "runs": [ { "id": "uuid", "source": "APP", "duration_sec": 1230, "completed": true } ] },
    { "date": "2026-08-15",
      "plan": { "id": "uuid", "status": "PLANNED", "goal_type": "TIME", "goal_value": 1200 },
      "runs": [] }
  ]
}
```

## GET /stats
```json
{
  "total_run_days": 10,        // 앱+수기, 하루 1회만 카운트
  "dalli_days": 5,             // 앱 측정만
  "this_month_days": 8,
  "this_week_count": 1,
  "next_milestone": 20,
  "recent_run": { "id": "uuid", "date": "2026-08-11", "duration_sec": 1200, "completed": true }
}
```

---

## 변경 절차
1. 프론트가 GitHub 이슈로 요청 (필요한 필드 + 이유)
2. BE가 이 문서 수정 → FastAPI 스키마 반영 → push + 팀 알림
3. 프론트가 `npx openapi-typescript ... -o app/src/types/api.ts` 재생성

**필드 삭제·이름 변경은 팀 알림 필수.** 추가는 자유.
