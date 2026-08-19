# 서체 파일 넣는 곳

디자인(`해커톤-박자단속반` / 앱디최종)이 쓰는 서체 두 벌이다. **유료 라이선스라 저장소에
커밋하지 않는다.** 산돌 계정에서 받은 파일을 이 폴더에 아래 이름 그대로 넣는다.

| 파일명 | 디자인의 스타일 이름 | 쓰이는 곳 |
| --- | --- | --- |
| `SandollPress.otf` | `Sandoll Press : 01 Original` | 브랜드 문구 (스플래시 "내 속도로 만드는 러닝 습관") |
| `SDGretaSans-Bold.otf` | `SD Greta Sans : 15 Bd` | 본문·라벨 (`fontWeight: '700'` 자리) |
| `SDGretaSans-Heavy.otf` | `SD Greta Sans : 17 Hv` | 수치·제목 (`fontWeight: '800'` 자리) |

`.ttf`를 받았다면 확장자만 바꿔서 넣지 말고 파일명 확장자를 실제 형식에 맞춘 뒤
`_layout.tsx`의 `require` 경로도 같이 고친다.

## 켜는 순서

1. 위 세 파일을 이 폴더에 넣는다
2. `app/_layout.tsx`의 `useFonts` 블록 주석을 푼다
3. `src/theme/fonts.ts`의 `CUSTOM_FONTS_ENABLED`를 `true`로 바꾼다
4. `npx expo start -c` (서체는 캐시를 타므로 `-c`가 필요하다)

## 왜 파일 없이 미리 켜두지 않았나

`fontFamily`에 등록되지 않은 이름을 쓰면 iOS는 시스템 서체로 조용히 떨어지거나 화면을
붉게 띄운다. 파일이 실제로 들어온 뒤에 한 번에 켜는 편이 안전하다.

`require`는 Metro가 빌드 시점에 해석하므로, 파일이 없는 상태에서 `require`를 남겨두면
`try/catch`로도 막지 못하고 번들링 자체가 실패한다. 그래서 주석으로 둔다.
