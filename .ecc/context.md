# 달리(Dalli) — 워커가 알아야 할 프로젝트 제약

규칙의 원본은 저장소 루트 `AGENTS.md`, `docs/PRODUCT.md`, `docs/ENGINE.md`, `docs/SCREENS.md`다.
코드와 문서가 다르면 **문서가 맞다** (`AGENTS.md` §5).

## 버전 고정
- Expo SDK **54** 고정. `expo@~54.0.35`(설치 54.0.36), `expo-constants@~18.0.13`은
  `expo install --check`가 상향을 권해도 **올리지 않는다**. 이건 의도된 고정이지 드리프트가 아니다.
- 오디오는 `expo-audio`. `expo-av`는 deprecated라 **금지**.
- `react-native-svg`는 SDK 54 핀인 `15.12.1`로 캐럿 없이 정확히 고정한다.

## 화면 문구 (`PRODUCT.md` §8-1 매핑표)
초보자에게 벽이 되는 내부 용어를 화면에 그대로 쓰지 않는다.
- `cadence` → **리듬** (`케이던스`라고 쓰지 않는다)
- `baseline` → **나의 기준 리듬**
- `Rhythm Score` → **안정 구간**. `ENGINE.md` §12는 *"157을 61% 유지"* 어법을 금지한다.
  그래서 `목표 유지율`이 아니라 `안정 구간`이다.
- 디자인(Figma `해커톤-박자단속반`)에 `케이던스 변화`·`목표 유지율`로 적혀 있어도
  코드 문구는 위 매핑을 따른다. **이건 실수가 아니라 결정이다.**

## 폴더 소유권 (`AGENTS.md` §2)
- `app/app/`, `app/src/api/`, `app/src/components/`, `app/src/theme/` — 김민서 (UI FE)
- `app/src/engine/`, `app/src/native/`, `app/src/store/` — 고은우 (Core FE)
- `server/**` — 김은송 (BE)
- UI FE는 `engine/types.ts`와 `store/runStore.ts`만 import한다. 엔진 내부 직접 접근 금지.
- `app/src/types/api.ts`는 openapi-typescript 자동 생성물 — **수동 편집 금지**.

## 서체
`theme/fonts.ts`의 `CUSTOM_FONTS_ENABLED = false`. 유료 라이선스라 파일이 저장소에 없다.
**파일이 없는 상태에서 `fontFamily`를 넣으면 안 된다** (iOS에서 시스템 서체로 떨어지거나 화면이 붉게 뜬다).
그래서 지금 화면들이 `fontWeight`만 쓰는 것은 정상이다.

## 테스트
Jest가 아직 붙어 있지 않다. 검증 수단은 `npm run typecheck`(tsc --noEmit)와 `npm run lint`(expo lint)다.
"테스트 파일이 없다"는 지적은 이미 아는 사실이므로 반복하지 않아도 된다.
