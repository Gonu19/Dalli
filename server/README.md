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

현재는 도메인 모델과 revision이 없으므로 `alembic current`는 revision을 출력하지 않는 것이 정상이다.
첫 모델 계획에서 모델을 `app/models/__init__.py`에 import하고 migration을 생성한다.

## 프론트용 Mock API (화요일 전)

실제 PostgreSQL·OpenAI 연결이 가능한 화요일 전까지는 fixture 기반 서버를 사용한다.

```bash
cd server
python -m pip install -r requirements-dev.txt
python -m uvicorn app.mock_main:app --host 0.0.0.0 --port 8001
```

- Swagger: `http://localhost:8001/docs`
- 아이폰 Base URL: `http://<개발-PC-LAN-IP>:8001`
- 데이터: `../docs/mock-data/api-fixtures.json`
- DB와 OpenAI를 호출하지 않으며 재시작 시 상태가 초기화된다.
- 화요일 실서버 전환 시 실행 모듈을 `app.main:app`으로 바꾸고 HTTPS Base URL을 전달한다.

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
