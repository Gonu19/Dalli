import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, compactPressFeedback, navigationHeader, pressFeedback } from '@/src/theme/tokens';
import { triggerButtonHaptic, triggerSelectionHaptic } from './haptics';

const logo = require('@/assets/images/dalli-logo.png');
let previousOnboardingStep = 0;

export function FigmaScreen({ children, includeBottomSafeArea = true }: { children?: ReactNode; includeBottomSafeArea?: boolean }) {
  return <SafeAreaView edges={includeBottomSafeArea ? ['top', 'bottom'] : ['top']} style={styles.safe}><View style={styles.frame}>{children}</View></SafeAreaView>;
}

export function FigmaLogo({ top = navigationHeader.logoTop, left = 31, centered = false }: { top?: number; left?: number; centered?: boolean }) {
  return <Image accessibilityLabel="달리" resizeMode="contain" source={logo} style={[styles.logo, centered ? styles.logoCentered : { left }, { top }]} />;
}

export function FigmaBack({ onPress, top = navigationHeader.backTop, left = 27 }: { onPress: () => void; top?: number; left?: number }) {
  return <Pressable accessibilityLabel="뒤로" hitSlop={8} onPress={() => { triggerButtonHaptic(); onPress(); }} style={({ pressed }) => [styles.back, { top, left }, pressed && styles.compactPressed]}><Ionicons color={colors.white} name="chevron-back" size={22} /></Pressable>;
}

export function OnboardingTop({ step, onBack }: { step: number; onBack: () => void }) {
  const progress = useRef(new Animated.Value(previousOnboardingStep * 20)).current;

  useEffect(() => {
    previousOnboardingStep = step;
    Animated.timing(progress, {
      duration: 420,
      toValue: step * 20,
      useNativeDriver: false,
    }).start();
  }, [progress, step]);

  const width = progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return <>
    <FigmaBack onPress={onBack} />
    <FigmaLogo centered />
    <View style={styles.progressTrack}><Animated.View style={[styles.progressFill, { width }]} /></View>
    <Text style={styles.progressText}>{step} / 5</Text>
  </>;
}

export function FigmaButton({ children, onPress, secondary = false, disabled = false, style }: { children: ReactNode; onPress: () => void; secondary?: boolean; disabled?: boolean; style?: object }) {
  return <Pressable disabled={disabled} onPress={() => { triggerButtonHaptic(); onPress(); }} style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, style, pressed && !disabled && styles.pressed]}><Text style={[styles.buttonText, disabled && styles.disabledText]}>{children}</Text></Pressable>;
}

export function FigmaRadio({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { triggerSelectionHaptic(); onPress(); }} style={({ pressed }) => [styles.radioRow, pressed && styles.pressed]}><View style={[styles.marker, selected && styles.markerSelected]}>{selected ? <View style={styles.markerDot} /> : null}</View><Text style={[styles.radioText, selected && styles.radioTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  frame: { width: '100%', maxWidth: 402, flex: 1, alignSelf: 'center', position: 'relative', overflow: 'hidden', backgroundColor: colors.background },
  logo: { position: 'absolute', zIndex: 10, width: 60, height: 34 },
  logoCentered: { left: '50%', transform: [{ translateX: -30 }] },
  back: { position: 'absolute', zIndex: 10, width: 30, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  pressed: pressFeedback,
  compactPressed: compactPressFeedback,
  progressTrack: { position: 'absolute', left: 27, right: 58, top: 76 - navigationHeader.contentLift, height: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 38, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 38 },
  progressText: { position: 'absolute', right: 27, top: 70 - navigationHeader.contentLift, color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  button: { position: 'absolute', left: 27, right: 28, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.white },
  disabled: { backgroundColor: '#494747', borderColor: '#494747' },
  disabledText: { color: '#8D8B8B' },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  radioRow: { height: 59, flexDirection: 'row', alignItems: 'center', gap: 14 },
  marker: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  markerSelected: { borderColor: colors.primary }, markerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  radioText: { color: colors.white, fontSize: 15, fontWeight: '700' }, radioTextSelected: { color: colors.primary },
});
