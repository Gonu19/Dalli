# 달리 (Dalli)

> 멋쟁이사자처럼 해커톤 · 이전 프로젝트명 `PaceMaker`

초보 러너의 개인 케이던스를 기준으로 무리 없는 **완주를 돕고**, 기록·계획을 **일상 루틴으로 연결**하는 러닝 앱.

> 더 빠르게 달리게 하는 것이 아니라, 끝까지 달릴 수 있는 리듬을 찾아줍니다.

**Expo(iOS) + FastAPI + PostgreSQL**

## 링크
| | |
| --- | --- |
| Figma | `<링크 넣기>` |
| API 문서 (Swagger) | `http://<EC2-IP>:8000/docs` |
| 이슈 | GitHub Issues |

## 문서
| 문서 | 내용 | 주인 |
| --- | --- | --- |
| [AGENTS.md](AGENTS.md) | **AI 공통 규칙 · 폴더 소유권 (전원 필독)** | 전원 |
| [docs/PRODUCT.md](docs/PRODUCT.md) | 기획 요약 · 페르소나 · 톤 규칙 | 전원 |
| [docs/CONTRACT.md](docs/CONTRACT.md) | API 계약 — 단일 진실 | 김은송 |
| [docs/ERD.md](docs/ERD.md) | DB 스키마 | 김은송 |
| [docs/ENGINE.md](docs/ENGINE.md) | 판정 룰 · 상태머신 · 수치표 | 고은우 |
| [docs/SCREENS.md](docs/SCREENS.md) | 화면 목록 + 라우팅 | 김민서 |
| [docs/DEMO.md](docs/DEMO.md) | 시연 대본 90초 | 전원 |

## 실행
- 앱: [app/README.md](app/README.md)
- 서버: [server/README.md](server/README.md)

```bash
# app
cd app && npm i && npx expo start

# server
cd server && cp .env.example .env && docker compose up -d && alembic upgrade head && python seed.py
```

## 팀
| 역할 | 담당 | 소유 |
| --- | --- | --- |
| Core FE | 고은우 | `app/src/engine`, `native`, `store` |
| UI FE | 김민서 | `app/app`, `src/api`, `src/components`, `src/theme` |
| BE | 김은송 | `server/**`, `docs/CONTRACT.md` |
| 디자인 | 2명 | Figma → 토큰·에셋 전달 |

**남의 폴더는 직접 안 고칩니다. 주인에게 요청.** 상세: [AGENTS.md](AGENTS.md)

## 규칙 요약
- `git pull --rebase && git push` (main 직접 push)
- 빌드 깨진 채 push 금지
- `server/.env` 커밋 금지
- `app/src/types/api.ts`는 자동 생성물 — 수정 금지
