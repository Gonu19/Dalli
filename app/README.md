# app — Expo / iOS

## 버전
- **Expo SDK 54** (`expo@~54.0.0`) — 첫 세팅 후 실제 버전으로 갱신
- 오디오는 **`expo-audio`**. `expo-av` 금지 (deprecated)

## 실행
```bash
cd app
npm i
npx expo start
```
- 실기기: Expo Go 앱에서 QR 스캔 (같은 Wi-Fi)
- 개발 빌드 필요 시: `npx eas build --profile development --platform ios`

## 실기기 필수 이유
Pedometer(만보계), 백그라운드 오디오, GPS는 **시뮬레이터에서 동작하지 않습니다.**
센서 없이 개발할 때는 `engine/sources/ReplaySource.ts`로 붙이세요.

## .env
```
EXPO_PUBLIC_API_URL=http://<EC2-IP>:8000
```
커밋 OK. **비밀값 금지** (번들에 그대로 박힘).

## app.json 필수 설정
```jsonc
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMotionUsageDescription": "러닝 케이던스 측정을 위해 동작 데이터를 사용합니다.",
        "NSLocationWhenInUseUsageDescription": "러닝 거리와 페이스 측정을 위해 위치를 사용합니다.",
        "NSLocationAlwaysAndWhenInUseUsageDescription": "백그라운드 러닝 기록을 위해 위치를 사용합니다.",
        "UIBackgroundModes": ["audio", "location"]
      }
    }
  }
}
```

## 타입 생성
```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
```
`src/types/api.ts`는 **자동 생성물. 수동 편집 금지.**

## 자주 나는 에러
| 증상 | 원인 · 해결 |
| --- | --- |
| `expo-av` deprecated 경고 / 오디오 API 없음 | AI가 옛날 코드 생성. `expo-audio`로 교체 |
| 백그라운드 진입 시 오디오·판정 정지 | 무음 루프 미재생 or `UIBackgroundModes: ["audio"]` 누락 |
| 음악 앱이 끊김 | 오디오 세션 `MixWithOthers` 미설정 |
| Pedometer 값이 항상 0 | 시뮬레이터. 실기기 필요 + `NSMotionUsageDescription` 확인 |
| 거리·페이스가 null | GPS 미수신. 정상 동작 (`ENGINE.md` §8) |
| `Network request failed` | `EXPO_PUBLIC_API_URL`이 `localhost` — 실기기에선 PC/EC2 IP로 |
| `.env` 변경이 반영 안 됨 | `npx expo start -c` (캐시 클리어) |
| package-lock 충돌 | `git checkout --theirs package-lock.json && npm i` |

## 폴더 소유권
| 경로 | 주인 |
| --- | --- |
| `src/engine/`, `src/native/`, `src/store/` | 고은우 |
| `app/`, `src/api/`, `src/components/`, `src/theme/` | 김민서 |

`src/engine/`은 순수 TS — `react-native` import 금지. 상세: [../AGENTS.md](../AGENTS.md)
