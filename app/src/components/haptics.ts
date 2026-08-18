import * as Haptics from 'expo-haptics';
import { createElement, useRef, type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

/** 화면 조작에 쓰는 짧고 절제된 촉각 피드백. 지원하지 않는 환경에서는 조용히 무시한다. */
export function triggerButtonHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** 길게 누르기처럼 의도가 큰 조작에 쓰는 조금 더 분명한 촉각 피드백. */
export function triggerLongPressHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function triggerSelectionHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** 일반 화면 버튼용 Pressable. disabled 상태에서는 촉각 피드백을 내지 않는다. */
export function HapticPressable({
  children,
  disabled,
  onPress,
  onLongPress,
  onPressIn,
  onPressHaptic = triggerButtonHaptic,
  onLongPressHaptic = triggerLongPressHaptic,
  ...props
}: PressableProps & {
  children?: ReactNode;
  onPressHaptic?: () => void;
  onLongPressHaptic?: () => void;
}) {
  const longPressed = useRef(false);

  return createElement(Pressable, {
    ...props,
    disabled,
    onPressIn: (event) => {
      longPressed.current = false;
      onPressIn?.(event);
    },
    onLongPress: (event) => {
      if (!disabled) {
        longPressed.current = true;
        onLongPressHaptic();
      }
      onLongPress?.(event);
    },
    onPress: (event) => {
      if (!disabled && !longPressed.current) onPressHaptic();
      longPressed.current = false;
      onPress?.(event);
    },
  }, children);
}
