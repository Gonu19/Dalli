import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
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
    <LinearGradient
      colors={['rgba(255,255,255,.12)', 'rgba(255,255,255,.07)', 'rgba(255,255,255,.03)', 'rgba(255,255,255,0)']}
      locations={[0, 0.3, 0.65, 1]}
      pointerEvents="none"
      style={styles.edgeGradient}
    />
  </Animated.View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 8, shadowColor: '#1C1A1A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.75, shadowRadius: 12 },
  fallback: { backgroundColor: 'rgba(28,26,26,.97)' },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,26,26,.76)' },
  edgeGradient: { position: 'absolute', left: 0, right: 0, bottom: -8, height: 16 },
});
