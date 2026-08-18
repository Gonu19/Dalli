import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Animated, StyleSheet, View } from 'react-native';

import { navigationHeader } from '@/src/theme/tokens';

export function ScrollHeaderScrim({ scrollY, height = 74 - navigationHeader.contentLift }: { scrollY: Animated.Value; height?: number }) {
  const opacity = scrollY.interpolate({
    inputRange: [0, 8, 32],
    outputRange: [0, 0.8, 1],
    extrapolate: 'clamp',
  });

  return <Animated.View pointerEvents="none" style={[styles.root, { height, opacity }]}>
    {isGlassEffectAPIAvailable()
      ? <GlassView glassEffectStyle="regular" style={StyleSheet.absoluteFill} />
      : <View style={[StyleSheet.absoluteFill, styles.fallback]} />}
    <View style={styles.tint} />
    <View style={styles.edgeGradient}>
      <View style={[styles.edgeBand, styles.edgeBandStrong]} />
      <View style={[styles.edgeBand, styles.edgeBandMedium]} />
      <View style={[styles.edgeBand, styles.edgeBandSoft]} />
      <View style={[styles.edgeBand, styles.edgeBandFade]} />
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 8, shadowColor: '#1C1A1A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.75, shadowRadius: 12 },
  fallback: { backgroundColor: 'rgba(28,26,26,.97)' },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,26,26,.76)' },
  edgeGradient: { position: 'absolute', left: 0, right: 0, bottom: -8, height: 16 },
  edgeBand: { flex: 1 },
  edgeBandStrong: { backgroundColor: 'rgba(255,255,255,.12)' },
  edgeBandMedium: { backgroundColor: 'rgba(255,255,255,.07)' },
  edgeBandSoft: { backgroundColor: 'rgba(255,255,255,.03)' },
  edgeBandFade: { backgroundColor: 'rgba(255,255,255,0)' },
});
