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
python seed.py            # 데모용 과거 기록
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
DATABASE_URL=postgresql+psycopg://dalli:<pw>@db:5432/dalli
JWT_SECRET=<random-32-bytes>
OPENAI_API_KEY=<key>
LLM_TIMEOUT_SEC=8
```
**절대 커밋 금지.** `.env.example`만 커밋, 실값은 EC2에 직접 설정.

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

## 구조
```
app/
  main.py  config.py  database.py  deps.py     # get_db · get_current_user
  models/    user  run  report  plan
  schemas/   Pydantic (Sample · Event 포함)
  routers/   auth  users  runs  reports  plans  calendar  stats
  services/
    metrics.py    FI · Rhythm Score · 평균값
    llm.py        8초 타임아웃
    fallback.py   룰베이스 문구
```

## 구현 순서
1. `fallback.py` — **`llm.py`보다 먼저.** LLM 없이도 리포트가 나와야 시연이 안 죽음
2. `metrics.py` — 계산식은 [../docs/ENGINE.md](../docs/ENGINE.md) §10
3. `llm.py` — 8초 타임아웃, 초과·실패 시 폴백으로 **200 응답** (5xx 금지)

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
| 리포트 요청이 오래 걸림 | `LLM_TIMEOUT_SEC=8` 확인, 폴백 경로 동작 확인 |
