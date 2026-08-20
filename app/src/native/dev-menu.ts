import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * 흔들기로 개발자 메뉴가 뜨는 것을 막는다 (개발 빌드 한정).
 *
 * 러닝은 휴대폰이 계속 흔들리는 상황이라 개발자 메뉴가 수시로 튀어나온다.
 * 실기기 검증과 시연 촬영이 그때마다 끊긴다.
 *
 * `expo-dev-menu`의 공개 JS API에는 이 설정이 없지만, 네이티브 모듈
 * `DevMenuPreferences`가 dev-client 바이너리에 들어 있어 직접 부를 수 있다.
 * 값은 기기에 저장되므로 한 번 끄면 앱을 다시 켜도 유지된다.
 *
 * `DevMenuPreferences.swift`가 인터셉터를 **제거하지 않고 비활성화만** 하는 구조라
 * (제거하면 RN 쪽 개발자 메뉴가 대신 뜬다) 이 값 하나로 양쪽이 함께 막힌다.
 *
 * 릴리스 빌드에는 개발자 메뉴 자체가 없다. `__DEV__`에서만 동작한다.
 */
type DevMenuPreferences = {
  setPreferencesAsync: (settings: Record<string, boolean>) => Promise<void>;
};

export function disableShakeDevMenu(): void {
  if (!__DEV__) return;

  // 모듈이 없는 빌드(Expo Go 등)에서는 `null`이 온다. 조용히 넘어간다.
  const preferences = requireOptionalNativeModule<DevMenuPreferences>('DevMenuPreferences');
  void preferences?.setPreferencesAsync({ motionGestureEnabled: false }).catch(() => {
    // 설정 저장에 실패해도 앱 실행을 막을 이유가 없다. 메뉴가 뜨는 불편이 남을 뿐이다.
  });
}
