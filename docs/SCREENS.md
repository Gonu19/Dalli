# SCREENS.md — 화면 목록 + 라우팅

**소유: 김민서 (UI FE)** · 라우터: `expo-router` (file-based)

## 라우팅 트리
| 경로 | 파일 | 화면 |
| --- | --- | --- |
| — | `app/_layout.tsx` | 루트 (Provider, 온보딩 여부 분기) |
| `/onboarding` | `app/onboarding/index.tsx` | 경험·목표 입력 |
| `/onboarding/cadence` | `app/onboarding/cadence.tsx` | 기준 리듬 확인 |
| — | `app/(tabs)/_layout.tsx` | 탭바 (분석·홈·기록) |
| `/analysis` | `app/(tabs)/analysis.tsx` | 분석 |
| `/` | `app/(tabs)/index.tsx` | 홈 |
| `/record` | `app/(tabs)/record.tsx` | 기록(캘린더) |
| `/run/active` | `app/run/active.tsx` | 러닝 중 |
| `/run/report` | `app/run/report.tsx` | 종료 리포트 |
| `/settings` | `app/settings.tsx` | 설정 |

기본 탭 = 홈(가운데). 온보딩 미완료면 루트에서 `/onboarding`으로 redirect.

## 화면 명세

### `/onboarding` 경험·목표
- 입력: 경험 수준(초보/가끔/규칙적), 최대 연속 러닝 시간, 주간 목표 횟수, (선택) 키·몸무게·출생연도·성별
- 다음 → `/onboarding/cadence`
- API: 없음 (로컬 보관)

### `/onboarding/cadence` 기준 리듬
- Rule-based 추천 baseline 표시 + **±5 spm 범위, 1 spm 단위** 수동 조절
- 안내: "첫 러닝에서 실제 리듬을 측정해 기준을 확정합니다"
- 완료 → `POST /auth/device` → `PATCH /users/me` → `/`

### `/` 홈
- 오늘의 목표: 시간 | 거리 토글 + 값
- 컨디션: 가벼움 / 보통 / 피곤함
- 안내 방식: 음성 on/off, 메트로놈 on/off
- 목표 케이던스 범위 미리보기 (`ENGINE.md` §3 공식, 계산은 engine)
- **러닝 시작** 버튼 → `/run/active`
- 최근 러닝 요약 카드 / 누적 러닝 데이
- API: `GET /stats`, `GET /runs?limit=1`, `GET /plans?from=today&to=today`

### `/run/active` 러닝 중
**화면 안 보고 뛰는 화면** — 큰 숫자, 고대비, 큰 터치 영역.
- 경과 시간(대), 현재 케이던스(대), 목표 범위 표시, 거리·페이스(GPS 없으면 `—`)
- 상태 배지: 워밍업 / 안정 / 조정 중 / 하향됨
- 컨트롤: 일시정지·재개, 종료(길게 눌러 확인)
- 상태 소스: `store/runStore`의 `RunState`만 구독. 엔진 내부 접근 금지.
- 종료 → 업로드(`POST /runs`) → `/run/report`

| RunState | 화면 |
| --- | --- |
| `CALIBRATING` | "기준 리듬 측정 중" + 남은 시간 |
| `RUNNING` | 기본 |
| `PAUSED` | 딤 + 재개 버튼 |

### `/run/report` 종료 리포트
- 기본: 목표 vs 실제, 완주 여부, 범위 유지 시간, 평균 케이던스·페이스, 케이던스/페이스 그래프
- AI: 한 줄 판정 → 피로도 → 인과 가설 → 다음 처방 → 다음 목표 추천
- AI 로딩 스켈레톤(최대 8초). 실패/타임아웃 시 폴백 문구 그대로 표시, **에러 화면 금지**
- API: `POST /runs/{id}/report`
- 닫기 → `/analysis`

### `/analysis` 분석
- 날짜별 리포트 목록 (완주 여부·평균 케이던스·Rhythm Score)
- 항목 탭 → 상세 (리포트 화면 재사용)
- 케이던스·페이스 추이, 완주 횟수 흐름, 추천 목표 히스토리
- API: `GET /runs`, `GET /runs/{id}`

### `/record` 기록
- 상단 캘린더 80%: 완료 ● / 수기 ○ / 예정 ◇
- 하단 프로필 20%: 누적 러닝 데이, 이번 달 활동일
- 날짜 탭 → 바텀시트: 계획 추가·수정·삭제·완료, 수기 기록 추가
- 우상단 ⚙ → `/settings`
- API: `GET /calendar`, `POST|PATCH|DELETE /plans`, `POST /runs` (`source: MANUAL`)

### `/settings`
- 기본 정보 수정 / 목표 수정 / 음성·메트로놈 / 알림
- API: `GET|PATCH /users/me`

## 공용 컴포넌트 (`src/components/`)
`CadenceRing` · `StatTile` · `GoalPicker` · `ConditionPicker` · `CadenceChart` · `CalendarGrid` · `ReportCard` · `PrimaryButton` · `BottomSheet` · `LoadingSkeleton` · `EmptyState`

## 디자인 토큰
Figma → `src/theme/tokens.ts` (색·타이포·간격). 컴포넌트에 하드코딩 색상 금지.
아이콘·사운드는 드라이브 공유 → UI FE가 `app/assets/`에 커밋.

## 규칙
- 문구는 `PRODUCT.md` §8 톤 규칙 준수
- 엔진 접점은 `engine/types.ts` + `store/runStore.ts`만
- 서버 통신은 `src/api/queries.ts` 훅 경유. 화면에서 axios 직접 호출 금지
- 업로드 실패는 `uploadQueue.ts`(AsyncStorage 재시도)로. **사용자에게 데이터 유실 노출 금지**
