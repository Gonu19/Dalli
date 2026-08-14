# API_HANDOFF.md — 프론트 전달용 API 명세

> 사람이 읽는 단일 진실은 [`CONTRACT.md`](CONTRACT.md), DB 단일 진실은 [`ERD.md`](ERD.md)다.
> 이 문서는 프론트 연동을 위한 요약본이며 충돌 시 `CONTRACT.md`가 우선한다.

## 1. 공통 규칙

- Base URL: `EXPO_PUBLIC_API_URL`
- JSON: `snake_case`
- 시각: ISO8601 UTC
- 인증: `/auth/device`를 제외하고 `Authorization: Bearer <access_token>` 필수
- 오류 바디: `{ "detail": { "code": "...", "message": "..." } }`
- `null`은 계산 불가 또는 선택 입력 없음이다. 프론트에서 0으로 바꾸지 않는다.
- 목 데이터: [`mock-data/api-fixtures.json`](mock-data/api-fixtures.json)

## 2. 프론트가 알아야 할 확정 사항

| 주제 | 계약 |
| --- | --- |
| 온보딩 | `GET /users/me`의 서버 계산값 `onboarded`로 분기 |
| 러닝 목적 | `COMPLETE \| HABIT \| WEIGHT \| FITNESS \| PERFORMANCE` |
| 컨디션 | 피곤함 `1`, 보통 `3`, 가벼움 `5` |
| 러닝 업로드 | 같은 `client_run_id` 재전송 가능. 최초 201, 기존 데이터 200 |
| 리포트 생성 | 최초 생성 후 같은 run 재호출은 기존 리포트 200 |
| 분석 불가 | 러닝은 저장된다. 지표는 `null`, 사유는 `analysis_limitation`/리포트 `limitation` |
| 계획 | 사용자별 날짜당 1개, 계획당 연결 러닝 1개 |
| 수기 기록 | 목표·케이던스·samples/events·AI 리포트 없음 |
| 삭제 | 러닝 hard delete, 연결 report cascade 삭제 |

## 3. 엔드포인트

| Method | Path | 인증 | 성공 | 프론트 사용처 |
| --- | --- | --- | --- | --- |
| POST | `/auth/device` | X | 200 | 앱 시작 |
| GET | `/users/me` | O | 200 | 온보딩 분기·설정 |
| PATCH | `/users/me` | O | 200 | 온보딩 완료·설정·baseline 확정 |
| POST | `/runs` | O | 201/200 | 앱 러닝·수기 기록 저장 |
| GET | `/runs?limit=&cursor=` | O | 200 | 분석 목록·최근 러닝 |
| GET | `/runs/{run_id}` | O | 200 | 러닝 상세 |
| DELETE | `/runs/{run_id}` | O | 204 | 기록 삭제 |
| POST | `/runs/{run_id}/report` | O | 201/200 | 리포트 생성·기존 조회 |
| GET | `/runs/{run_id}/report` | O | 200 | 저장된 리포트 조회 |
| GET | `/plans?from=&to=` | O | 200 | 홈·기록 |
| POST | `/plans` | O | 201 | 계획 생성 |
| PATCH | `/plans/{plan_id}` | O | 200 | 수정·완료·건너뜀 |
| DELETE | `/plans/{plan_id}` | O | 204 | 계획 삭제 |
| GET | `/calendar?year=&month=` | O | 200 | 기록 캘린더 |
| GET | `/stats` | O | 200 | 홈·기록 요약 |

요청·응답의 전체 필드와 enum은 `CONTRACT.md`를 따른다.

## 4. 상태 코드 처리

| HTTP | code | 프론트 처리 |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | 토큰 삭제 후 `/auth/device` 한 번 재시도 |
| 404 | `NOT_FOUND` | 해당 리소스가 삭제됐음을 표시하고 목록 갱신 |
| 409 | `CONFLICT` | 같은 날짜 계획 또는 이미 연결된 계획 안내 |
| 422 | `VALIDATION_ERROR` | `detail.message` 표시, 입력값 보존 |
| 200 + `is_fallback=true` | 오류 아님 | 폴백 리포트를 그대로 표시 |

## 5. 목 데이터 키

`api-fixtures.json`은 아래 시나리오를 한 파일에 제공한다.

- `requests.auth_device`, `requests.patch_user_onboarding`, `requests.create_app_run_minimum_analyzable`, `requests.create_manual_run`, `requests.create_plan`
- `auth.new_user`, `auth.existing_user`
- `users.not_onboarded`, `users.onboarded`
- `runs.created`, `runs.idempotent`, `runs.list`, `runs.detail`, `runs.too_short`, `runs.manual`
- `reports.normal`, `reports.fallback`, `reports.insufficient_data`
- `plans.list`, `plans.created`
- `calendar.month`
- `stats.with_history`, `stats.empty`
- `errors.unauthorized`, `errors.not_found`, `errors.conflict`, `errors.validation`

목 응답에는 `status`와 `body`가 들어 있다. `204` 응답은 body가 없다.
실제 API가 구현되면 FastAPI `/openapi.json`으로 타입을 재생성하고 이 fixture와 계약 테스트를 맞춘다.

## 6. 프론트 체크리스트

- [ ] 토큰을 저장하고 모든 보호 API에 Bearer 헤더를 붙인다.
- [ ] `onboarded=false`면 온보딩으로 이동한다.
- [ ] `rhythm_score`, `late_drop_rate`, `fatigue_index`, GPS 값의 `null`을 처리한다.
- [ ] `is_fallback=true`를 네트워크 오류 화면으로 취급하지 않는다.
- [ ] 수기 기록 요청에 목표나 센서 필드를 보내지 않는다.
- [ ] 업로드 실패 시 같은 `client_run_id`로 재시도한다.
- [ ] 409 계획 충돌을 중복 생성 성공으로 오인하지 않는다.
- [ ] OpenAPI 타입은 자동 생성하고 수동 수정하지 않는다.
