/**
 * 서체 (`해커톤-박자단속반` / 앱디최종).
 *
 * 디자인이 쓰는 서체는 두 벌이다.
 * - **Sandoll 프레스** — 브랜드 문구 전용. 스플래시의 "내 속도로 만드는 러닝 습관"처럼
 *   한 화면에 한 줄만 쓴다.
 * - **SD 그레타산스 TT** — 나머지 전부. Bold(15 Bd)와 Heavy(17 Hv) 두 굵기만 쓴다.
 *
 * ## 아직 켜지지 않았다 ⚠️
 *
 * 두 서체 모두 유료 라이선스라 저장소에 파일이 없다. `assets/fonts/README.md`의
 * 파일명 그대로 넣고 `_layout.tsx`의 `useFonts` 블록을 살리면 그때부터 적용된다.
 *
 * **파일이 없는 상태에서 `fontFamily`를 넣으면 안 된다.** iOS는 등록되지 않은
 * 서체 이름을 만나면 시스템 서체로 조용히 떨어지거나 화면을 붉게 띄운다.
 */

/** `useFonts`에 등록할 이름. 값이 곧 `fontFamily`에 쓰는 문자열이다. */
export const fonts = {
  /** 브랜드 문구 전용 (Sandoll 프레스 01 Original). */
  brand: 'SandollPress',
  /** 본문·라벨 (SD 그레타산스 TT Bold). */
  body: 'SDGretaSans-Bold',
  /** 수치·제목 (SD 그레타산스 TT Heavy). */
  display: 'SDGretaSans-Heavy',
} as const;

export type FontRole = keyof typeof fonts;

/**
 * 굵기를 서체 이름으로 바꾼다.
 *
 * 커스텀 서체는 굵기별로 **파일이 따로**라, `fontWeight`만 바꿔서는 굵어지지 않는다.
 * 지금 화면들이 쓰는 굵기는 `'700'`과 `'800'` 두 가지뿐이라 그대로 두 벌에 대응한다.
 */
export function fontFamilyFor(weight: '700' | '800' | undefined): string {
  return weight === '800' ? fonts.display : fonts.body;
}

/** 서체 파일이 준비돼 적용 중인지. 전환 시점을 한 곳에서 관리한다. */
export const CUSTOM_FONTS_ENABLED = false;
