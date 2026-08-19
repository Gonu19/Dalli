import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Animated, StyleSheet, View } from 'react-native';

import { colors, navigationHeader } from '@/src/theme/tokens';

/**
 * 스크롤에 따라 헤더 뒤를 덮는 막.
 *
 * `opaque`는 글래스 대신 배경색으로 완전히 가린다. 상세 화면처럼 헤더 아래로
 * 그래프·숫자가 지나가는 곳에서는 비치는 편이 오히려 읽기 어렵다.
 */
export function ScrollHeaderScrim({ scrollY, height = 74 - navigationHeader.contentLift, opaque = false }: { scrollY: Animated.Value; height?: number; opaque?: boolean }) {
  const opacity = scrollY.interpolate({
    inputRange: [0, 8, 32],
    outputRange: [0, 0.8, 1],
    extrapolate: 'clamp',
  });

  return <Animated.View pointerEvents="none" style={[styles.root, { height, opacity }]}>
    {!opaque && isGlassEffectAPIAvailable()
      ? <GlassView glassEffectStyle="regular" style={StyleSheet.absoluteFill} />
      : <View style={[StyleSheet.absoluteFill, styles.fallback]} />}
    {opaque ? <View style={styles.solid} /> : <View style={styles.tint} />}
    <View style={styles.edge} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 8, shadowColor: '#1C1A1A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.75, shadowRadius: 12 },
  fallback: { backgroundColor: 'rgba(28,26,26,.97)' },
  solid: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,26,26,.76)' },
  edge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: 'rgba(255,255,255,.08)' },
});
