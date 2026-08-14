# AGENTS.md — AI 공통 규칙 (전원 필독)

모든 AI 도구의 단일 규칙 소스. `CLAUDE.md` / `.cursorrules`는 이 파일 참조만.

## 0. 프로젝트
**달리(Dalli)** — 개인 케이던스 기준 완주 보조 + 기록·계획 루틴화 러닝 앱. Expo/iOS + FastAPI + PostgreSQL.

## 1. 버전 고정
| 항목 | 값 |
| --- | --- |
| Expo SDK | **54** (`expo@~54.0.35`, 설치 버전 `54.0.36`) |
| 라우팅 | `expo-router` |
| 오디오 | **`expo-audio`** ❌ `expo-av` 금지 (deprecated) |
| 센서/위치 | `expo-sensors`(Pedometer), `expo-location` |
| 상태 | `zustand` + `@tanstack/react-query` |
| BE | FastAPI, SQLAlchemy 2.0 (`Mapped[]`), Alembic, PostgreSQL 16 |

AI 프롬프트에 **"Expo SDK 54, expo-audio"** 항상 명시.

## 2. 폴더 소유권
**한 폴더에 주인 한 명. 남의 폴더는 직접 안 고치고 주인에게 요청.**

| 경로 | 주인 |
| --- | --- |
| `app/src/engine/`, `native/`, `store/` | 고은우 (Core FE) |
| `app/app/`, `src/api/`, `src/components/`, `src/theme/` | 김민서 (UI FE) |
| `server/**` | 김은송 (BE) |
| `docs/CONTRACT.md`, `docs/ERD.md` | 김은송 |
| `docs/ENGINE.md` | 고은우 |
| `docs/SCREENS.md` | 김민서 |
| `app/src/engine/types.ts` | 고은우 — **UI FE가 읽는 유일한 접점** |
| `app/assets/` | 디자인 → UI FE가 커밋 |

접점 규칙
- UI FE → `engine/types.ts`, `store/runStore.ts`만 import. 엔진 내부 직접 접근 금지.
- `engine/`은 순수 TS. `react-native` import 금지.
- 네이티브 접근은 `native/` 래퍼 경유.

## 3. 역할별 필독
| 역할 | 문서 |
| --- | --- |
| 전원 | `AGENTS.md`, `docs/PRODUCT.md` |
| Core FE | + `ENGINE.md`, `CONTRACT.md` |
| UI FE | + `SCREENS.md`, `CONTRACT.md`, `engine/types.ts` |
| BE | + `CONTRACT.md`, `ERD.md`, `ENGINE.md` §10 |
| 디자인 | + `PRODUCT.md` 톤, `SCREENS.md` |

## 4. 네이밍
| 층 | 규칙 | 예 |
| --- | --- | --- |
| API JSON / DB | `snake_case` | `target_cadence_min` |
| Python | `snake_case`, 클래스 `PascalCase` | `compute_fatigue_index` |
| TS 변수·함수 | `camelCase` | `targetCadenceMin` |
| TS 타입·컴포넌트 | `PascalCase` | `RunState` |
| 이벤트 enum | `SCREAMING_SNAKE` | `TARGET_ADJUSTED` |

변환 지점은 `app/src/api/client.ts` 한 곳.

**`app/src/types/api.ts`는 자동 생성물 — 수동 편집 금지.**
```bash
npx openapi-typescript http://localhost:8000/openapi.json -o app/src/types/api.ts
```

## 5. 단일 진실
| 주제 | 문서 |
| --- | --- |
| API 모양 | `docs/CONTRACT.md` |
| DB 스키마 | `docs/ERD.md` |
| 판정 룰·수치 | `docs/ENGINE.md` |
| 화면·라우팅 | `docs/SCREENS.md` |
| 문구 톤 | `docs/PRODUCT.md` |

코드와 문서가 다르면 **문서가 맞음**. AI가 수치를 지어내면 `ENGINE.md` 기준으로 되돌릴 것.

## 6. 브랜치 · 커밋
```bash
git pull --rebase && git push
```
- main 직접 push. push 전 `pull --rebase` 필수.
- **빌드 깨진 채 push 금지** (유일한 강제 규칙).
- 실험만 브랜치, 하루 안에 머지.

커밋: `<type>(<scope>): <한글 한 줄>`
- type: `feat|fix|docs|chore|refactor|test`
- scope: `engine|native|store|ui|api|server|docs|infra`
- 예: `feat(engine): 20초 슬라이딩 윈도우 SPM 계산`

## 7. 충돌 나는 파일 3개
| 파일 | 규칙 |
| --- | --- |
| `app/package.json` | 의존성 추가 시 즉시 push + 팀 알림 |
| `app/package-lock.json` | 충돌 시 `git checkout --theirs` 후 `npm i` |
| `docs/CONTRACT.md` | BE만 수정. 프론트는 이슈로 요청 |

## 8. 환경변수
```
app/.env      ← 커밋 OK   EXPO_PUBLIC_API_URL=http://<EC2-IP>:8000
server/.env   ← 커밋 금지  DATABASE_URL / JWT_SECRET / OPENAI_API_KEY
```
- `server/.env.example`만 커밋. 실값은 EC2에 직접 설정.
- 레포 private. private이어도 키 커밋 금지.
- `EXPO_PUBLIC_*`는 앱 번들에 노출됨 → 비밀값 금지.

## 9. 하지 말 것
- 남의 폴더 수정 · 프론트가 `CONTRACT.md` 수정
- `types/api.ts` 수동 편집 · `expo-av` 사용
- `engine/`에서 `react-native` import
- 서버 키를 `app/.env`에 · 빌드 깨진 채 push
