import * as Haptics from 'expo-haptics';
import { createElement, type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

/** 화면 조작에 쓰는 짧고 절제된 촉각 피드백. 지원하지 않는 환경에서는 조용히 무시한다. */
export function triggerButtonHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function triggerSelectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** 일반 화면 버튼용 Pressable. disabled 상태에서는 촉각 피드백을 내지 않는다. */
export function HapticPressable({ children, disabled, onPress, ...props }: PressableProps & { children?: ReactNode }) {
  return createElement(Pressable, {
    ...props,
    disabled,
    onPress: (event) => {
      if (!disabled) triggerButtonHaptic();
      onPress?.(event);
    },
  }, children);
}
