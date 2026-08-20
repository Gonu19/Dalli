# server — FastAPI

**소유: 김은송** · 나머지는 읽기만

## 스택
FastAPI · SQLAlchemy 2.0 (`Mapped[]`) · Alembic · PostgreSQL 16 · Pydantic v2

- Python: **3.12.11** (`.python-version`)
- 런타임 패키지: `requirements.txt`
- 테스트·개발 패키지: `requirements-dev.txt`

## 실행
```bash
cd server
cp .env.example .env      # 값 채우기
docker compose up -d      # db(5432 루프백) + api
alembic upgrade head
python -m app.seed        # 개발·데모용 고정 기록
```
- Swagger: `http://localhost:8000/docs`
- OpenAPI: `http://localhost:8000/openapi.json`
- Health: `http://localhost:8000/health` (`{"status":"ok"}`; DB와 분리된 liveness)

로컬 Python 실행:

```bash
cd server
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements-dev.txt
uvicorn app.main:app --reload
python -m pytest -q
```

최초 스키마 revision은 `0001_initial_schema`다. 모델을 추가할 때는
`app/models/__init__.py`에 import한 뒤 autogenerate 결과를 `docs/ERD.md`와 대조한다.

## 프론트용 Mock API (화요일 전)

실제 PostgreSQL·OpenAI 연결이 가능한 화요일 전까지는 fixture 기반 서버를 사용한다.

```bash
cd server
python -m pip install -r requirements-dev.txt
python -m uvicorn app.mock_main:app --host 0.0.0.0 --port 8001
```

- Swagger: `http://localhost:8001/docs`
- 로컬 아이폰 임시 확인: `http://<개발-PC-LAN-IP>:8001`
- 프론트 통합 Base URL: EC2 Nginx의 `https://<api-domain>` (Mock과 실 API에서 동일)
- 데이터: `../docs/mock-data/api-fixtures.json`
- DB와 OpenAI를 호출하지 않으며 재시작 시 상태가 초기화된다.
- EC2 접근 권한이 제공되면 BE가 swap 2GB, Nginx, Certbot과 Mock 배포를 함께
  구성한다. 접근 전에는 실제 서버 설정이나 비밀값 입력을 수행하지 않는다.
- 화요일 실서버 전환 시 외부 HTTPS 주소는 유지하고 Nginx 내부 업스트림만
  `app.mock_main:app`에서 `app.main:app`으로 바꾼다.
- EC2 배포와 전환 절차: [deploy/README.md](deploy/README.md)

## .env
```
APP_ENV=development
DATABASE_URL=postgresql+psycopg://dalli:<pw>@db:5432/dalli
JWT_SECRET=<random-32-bytes>
OPENAI_API_KEY=<key>
LLM_ENABLED=false
OPENAI_MODEL=gpt-4o-mini
LLM_TIMEOUT_SEC=20
LLM_MAX_OUTPUT_TOKENS=3000
```
**절대 커밋 금지.** `.env.example`만 커밋, 실값은 EC2에 직접 설정.

### 선택적 LLM 리포트

LLM은 기본적으로 꺼져 있다. `LLM_ENABLED=false`이거나 `OPENAI_API_KEY`가 비어
있어도 서버는 정상 시작하고 결정적인 fallback 리포트를 200으로 반환한다. 실제
LLM을 사용할 환경에서만 커밋되지 않는 `server/.env`에 다음 값을 설정한다.

```dotenv
LLM_ENABLED=true
OPENAI_API_KEY=<실제 키>
OPENAI_MODEL=gpt-4o-mini
LLM_TIMEOUT_SEC=20
LLM_MAX_OUTPUT_TOKENS=3000
```

`OPENAI_MODEL` 기본값은 Structured Outputs를 지원하는 저비용 모델이며 코드에
분산해 하드코딩하지 않는다. OpenAI Responses API의 Pydantic structured output을
사용하고 SDK 재시도는 0회다. SDK timeout과 서버 측 전체 deadline을 모두 20초
이하로 적용한다. GPT-5 계열은 낮은 reasoning effort로 응답 예산을 관리한다. 외부 호출에는 집계 지표와 허용된 러닝 요약만 전달하며 원본
`samples`·`events`는 보내지 않는다.

timeout, 연결·인증·rate limit·공급자 오류, 빈 응답, JSON/schema/Pydantic 검증
실패 시 기존 fallback을 저장하고 200을 반환한다. 이미 저장된 리포트는 외부 호출
없이 그대로 반환한다. 로그에는 실행 결과와 안전한 분류만 남고 API key, 전체
prompt, 원본 센서 데이터와 공급자 오류 원문은 남기지 않는다.

선택적 실제 호출 테스트는 명시적으로 허용했을 때 한 건만 실행된다. 계정 정책에
따라 비용이 발생할 수 있으며 기본 pytest와 CI에서는 항상 skip된다.

```powershell
$env:RUN_OPENAI_LIVE_TEST = "1"
$env:OPENAI_API_KEY = "<server/.env의 키>"
$env:OPENAI_MODEL = "gpt-4o-mini"
python -m pytest -q -m openai_live
```

## 개발·데모 시드

시드는 `APP_ENV=development` 또는 `APP_ENV=test`에서만 실행된다. 값이 없거나
그 외 값(`production` 포함)이면 DB에 연결하기 전에 종료한다. 실행 전 Alembic
revision이 현재 코드의 head와 정확히 일치해야 하며, migration을 자동 실행하지 않는다.

```powershell
cd server
$env:APP_ENV = "development"
python -m app.seed
```

Docker Compose 안에서는 `.env`의 `APP_ENV=development`를 설정한 뒤 다음처럼 실행한다.

```bash
docker compose run --rm api python -m app.seed
```

고정 날짜는 `2026-08-14`~`2026-09-01`이며 다음 데이터를 만든다.

- 전용 사용자 2명: `dalli-seed-demo-device`, `dalli-seed-ownership-device`
- `DONE`·`PLANNED`·`SKIPPED` 계획
- 계획 연결 APP, 계획 없는 APP, 미완료 APP, 같은 날 MANUAL, KST 월 경계 APP
- 고정 폴백 리포트 1개와 리포트 없는 러닝

고정 UUID·device UUID·`client_run_id`로 기존 seed 행을 갱신하므로 반복 실행해도
개수가 늘지 않는다. seed 전용 식별자가 일반 데이터와 충돌하면 덮어쓰지 않고
실패한다. 기존 데이터를 삭제하거나 DB를 초기화하지 않으며 OpenAI·외부 HTTP를
호출하지 않는다. 운영·공유 DB에서는 실행하지 않는다.

## 마이그레이션
```bash
alembic revision --autogenerate -m "add reports.model"
alembic upgrade head
alembic downgrade -1
```
스키마 변경 시 [../docs/ERD.md](../docs/ERD.md)를 같은 커밋에서 갱신.

### PostgreSQL 통합 검증 게이트

PostgreSQL 서버가 제공되기 전에는 DB 없는 단위 테스트와 Mock API 개발을
진행한다. `TEST_DATABASE_URL`이 없을 때 PostgreSQL 통합 테스트가 skip되는 것은
의도된 동작이며, PostgreSQL 전용 타입·제약·마이그레이션이 검증됐다는 의미가
아니다.

서버 제공 후 운영·기존 개발 DB와 분리된 `dalli_test`를 만들고 다음 검증을
필수 게이트로 실행한다. 테스트 코드가 DB 이름에 `test`가 포함됐는지 확인하므로
`dalli`를 `TEST_DATABASE_URL`로 지정할 수 없다.

```bash
cd server
export TEST_DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>:5432/dalli_test
export DATABASE_URL="$TEST_DATABASE_URL"

alembic upgrade head
alembic current
alembic check
python -m pytest -q
alembic downgrade base
alembic upgrade head
alembic current
alembic check
```

PowerShell에서는 `export NAME=value` 대신 `$env:NAME = "value"`를 사용한다.
이후 실제 API E2E까지 모두 통과한 경우에만 `dalli`에 마이그레이션을 적용한다.
실제 비밀번호는 셸 환경변수나 커밋되지 않는 `server/.env`에만 둔다.

### Day 1 실제 HTTP E2E 게이트

`tests/e2e/test_day1_gate.py`는 TestClient가 아니라 실행 중인 로컬 API에 HTTP
요청을 보내고 격리 PostgreSQL DB를 직접 조회한다. 안전을 위해 API와 DB는
`localhost` 또는 `127.0.0.1`만 허용하며 DB 이름에는 `day1` 또는 `test`가
포함되어야 한다. 완전히 빈 DB에 migration을 적용한 후 실행한다.

```powershell
$env:POSTGRES_DB = "dalli_day1_test"
$env:POSTGRES_USER = "dalli"
$env:POSTGRES_PASSWORD = "day1-local-only-password"
$env:DATABASE_URL = "postgresql+psycopg://dalli:day1-local-only-password@db:5432/dalli_day1_test"
$env:JWT_SECRET = "day1-local-only-jwt-secret-with-32-bytes"
$env:OPENAI_API_KEY = ""

docker compose -p dalli-day1-gate up -d db
docker compose -p dalli-day1-gate exec -T db psql -U dalli -d dalli_day1_test -tAc `
  "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"

# 위 결과가 0임을 확인한 다음 migration과 API를 시작한다.
docker compose -p dalli-day1-gate run --rm api alembic upgrade head
docker compose -p dalli-day1-gate run --rm api alembic current
docker compose -p dalli-day1-gate run --rm api alembic check
docker compose -p dalli-day1-gate up -d api

$env:DALLI_E2E_BASE_URL = "http://127.0.0.1:8000"
$env:DALLI_E2E_DATABASE_URL = "postgresql+psycopg://dalli:day1-local-only-password@127.0.0.1:5432/dalli_day1_test"
python -m pytest -q -m e2e
```

검증은 `health → auth → profile 조회·수정 → APP Run 201 → 동일 요청 200 →
재인증 → 새 token 재확인`을 관통하고 최종 `users=1`, `runs=1`, `plans=0`,
`reports=0`, Alembic head 및 `pgcrypto`를 확인한다. 운영 DB나 기존 개발 DB에는
이 환경변수를 지정하지 않는다.

검증 후 자원을 지울 때는 먼저 `docker compose -p dalli-day1-gate ps`로 project
이름을 재확인한다. 테스트 데이터 보존이 필요 없을 때만
`docker compose -p dalli-day1-gate down -v`로 해당 project 자원만 제거한다.

### 전체 로컬 HTTP E2E 게이트 (BE-P17)

`tests/e2e/test_backend_http.py`는 실제 FastAPI 프로세스에 네트워크 요청을 보내
`auth → profile → plan → run → report → calendar → stats`와 인증·검증·소유권·
충돌 실패 경로를 검증한다. 동시 Run 요청도 PostgreSQL unique 제약을 실제로
통과시킨다. 운영·공유 DB 대신 아래 전용 Compose project와 DB만 사용한다.

```powershell
cd server
$env:POSTGRES_DB = "dalli_bep17_test"
$env:POSTGRES_USER = "dalli"
$env:POSTGRES_PASSWORD = "bep17-local-only-password"
$env:APP_ENV = "test"
$env:DATABASE_URL = "postgresql+psycopg://dalli:bep17-local-only-password@db:5432/dalli_bep17_test"
$env:JWT_SECRET = "bep17-local-only-jwt-secret-with-32-bytes"
$env:OPENAI_API_KEY = ""

docker compose -p dalli-bep17-e2e config
docker compose -p dalli-bep17-e2e up -d db
docker compose -p dalli-bep17-e2e run --rm api alembic upgrade head
docker compose -p dalli-bep17-e2e run --rm api alembic current
docker compose -p dalli-bep17-e2e run --rm api alembic check
docker compose -p dalli-bep17-e2e run --rm api python -m app.seed
docker compose -p dalli-bep17-e2e up -d api

$deadline = (Get-Date).AddSeconds(60)
do {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
  } catch {
    $health = $null
  }
  if ($health.status -eq "ok") { break }
  if ((Get-Date) -ge $deadline) { throw "FastAPI readiness timeout" }
  Start-Sleep -Seconds 1
} while ($true)

$env:DALLI_E2E_BASE_URL = "http://127.0.0.1:8000"
$env:DALLI_E2E_DATABASE_URL = "postgresql+psycopg://dalli:bep17-local-only-password@127.0.0.1:5432/dalli_bep17_test"
$env:DALLI_E2E_JWT_SECRET = "bep17-local-only-jwt-secret-with-32-bytes"
$env:TEST_DATABASE_URL = $env:DALLI_E2E_DATABASE_URL
python -m pytest -q -m e2e
```

E2E 뒤 전체 테스트는 실행 중인 API와 PostgreSQL fixture가 같은 schema를 동시에
변경하지 않도록 API를 먼저 멈추고 실행한다. 전체 테스트가 migration을 내렸다
올릴 수 있으므로 끝난 뒤 head와 schema 차이를 다시 확인한다.

```powershell
docker compose -p dalli-bep17-e2e stop api
Remove-Item Env:DALLI_E2E_BASE_URL, Env:DALLI_E2E_DATABASE_URL, Env:DALLI_E2E_JWT_SECRET
$env:DATABASE_URL = $env:TEST_DATABASE_URL
python -m pytest -q
alembic upgrade head
alembic current
alembic check
```

실패 진단에는 단계·status code·응답 본문이 표시되지만 access token은 마스킹된다.
위 비밀번호와 JWT secret은 로컬 테스트 전용 예시이며 실제 비밀값으로 바꾸거나
커밋하지 않는다. 종료 시 project 이름을 확인한 뒤 이번 실행의 자원만 정리한다.

```powershell
docker compose -p dalli-bep17-e2e ps
docker compose -p dalli-bep17-e2e down -v
```

실제 Expo 앱 연결과 배포 서버 검증은 이 로컬 게이트가 아니라 3B 범위다.

## 구조
```
app/
  main.py  config.py  database.py  deps.py     # get_db · get_current_user
  models/    user  run  report  plan
  schemas/   Pydantic (Sample · Event 포함)
  routers/   auth  users  runs  reports  plans  calendar  stats
  services/
    metrics.py    FI · Rhythm Score · 평균값
    llm.py        20초 타임아웃 · 3000 출력 토큰
    fallback.py   룰베이스 문구
```

## 구현 순서
1. `fallback.py` — **`llm.py`보다 먼저.** LLM 없이도 리포트가 나와야 시연이 안 죽음
2. `metrics.py` — 계산식은 [../docs/ENGINE.md](../docs/ENGINE.md) §10
3. `llm.py` — 20초 타임아웃, 초과·실패 시 폴백으로 **200 응답** (5xx 금지)

## 규칙
- API 계약 변경은 [../docs/CONTRACT.md](../docs/CONTRACT.md)를 **먼저** 고치고 구현 → push + 팀 알림
- `POST /runs`는 `client_run_id` 기준 멱등 (중복 시 기존 run 200 반환)
- 모든 JSON 필드 `snake_case`
- `samples`/`events`는 JSONB. 스키마는 ERD.md §3

## 자주 나는 에러
| 증상 | 해결 |
| --- | --- |
| `gen_random_uuid()` 없음 | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` |
| 실기기에서 API 접속 안 됨 | 컨테이너 포트가 루프백 바인딩. 개발 중엔 `0.0.0.0:8000` + 보안그룹 확인 |
| alembic autogenerate가 빈 마이그레이션 | `alembic/env.py`에 모델 import 누락 |
| 리포트 요청이 오래 걸림 | `LLM_TIMEOUT_SEC`와 `LLM_MAX_OUTPUT_TOKENS` 확인, 폴백 경로 동작 확인 |
