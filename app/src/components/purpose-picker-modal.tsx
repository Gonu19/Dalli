import { Ionicons } from '@expo/vector-icons';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Modal, StyleSheet, Text, View } from 'react-native';

import type { RunningPurpose } from '@/src/api/client';
import { colors, pressFeedback } from '@/src/theme/tokens';
import { HapticPressable as Pressable } from './haptics';

const accessibleOrange = '#C64B2F';

const purposes: { value: RunningPurpose; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'COMPLETE', label: '완주', description: '부담 없이 끝까지 달리는 데 집중해요', icon: 'flag-outline' },
  { value: 'HABIT', label: '습관 형성', description: '꾸준히 달리는 루틴을 만들어요', icon: 'repeat-outline' },
  { value: 'WEIGHT', label: '체중 관리', description: '건강한 활동량을 차근차근 늘려요', icon: 'fitness-outline' },
  { value: 'FITNESS', label: '체력 향상', description: '더 오래 편안하게 달릴 힘을 길러요', icon: 'heart-outline' },
  { value: 'PERFORMANCE', label: '기록 향상', description: '페이스와 케이던스를 안정적으로 높여요', icon: 'speedometer-outline' },
];

export const purposeLabel = (purpose: RunningPurpose | null) => purposes.find((item) => item.value === purpose)?.label ?? '선택해 주세요';

export function PurposePickerModal({
  visible,
  value,
  onClose,
  onChange,
}: {
  visible: boolean;
  value: RunningPurpose;
  onClose: () => void;
  onChange: (purpose: RunningPurpose) => void;
}) {
  const content = <>
    <View style={styles.handle} />
    <Text style={styles.title}>러닝 목적 변경</Text>
    <Text style={styles.copy}>지금 가장 중요한 목표를 하나 선택해 주세요.</Text>
    <View style={styles.options}>
      {purposes.map((item) => {
        const selected = item.value === value;
        return <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          key={item.value}
          onPress={() => {
            onChange(item.value);
            onClose();
          }}
          style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}
        >
          <View style={[styles.icon, selected && styles.iconSelected]}>
            <Ionicons color={selected ? colors.white : colors.ink} name={item.icon} size={20} />
          </View>
          <View style={styles.optionCopy}>
            <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{item.label}</Text>
            <Text style={styles.optionDescription}>{item.description}</Text>
          </View>
          {selected ? <Ionicons color={accessibleOrange} name="checkmark-circle" size={22} /> : null}
        </Pressable>;
      })}
    </View>
  </>;

  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
    <View style={styles.root}>
      <Pressable accessibilityLabel="러닝 목적 선택 닫기" onPress={onClose} style={styles.backdrop} />
      {isGlassEffectAPIAvailable()
        ? <GlassView glassEffectStyle="regular" isInteractive style={styles.sheet}>{content}</GlassView>
        : <View style={[styles.sheet, styles.fallback]}>{content}</View>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.38)' },
  sheet: { minHeight: 470, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, overflow: 'hidden' },
  fallback: { backgroundColor: 'rgba(248,248,248,.98)' },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(28,26,26,.2)', alignSelf: 'center' },
  title: { color: colors.ink, fontSize: 21, fontWeight: '800', marginTop: 18 },
  copy: { color: colors.inkMuted, fontSize: 13, marginTop: 6 },
  options: { gap: 7, marginTop: 18 },
  option: { minHeight: 62, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,.6)' },
  optionSelected: { borderColor: 'rgba(198,75,47,.72)', backgroundColor: 'rgba(255,122,89,.16)' },
  optionPressed: pressFeedback,
  icon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.72)' },
  iconSelected: { backgroundColor: colors.primary },
  optionCopy: { flex: 1 },
  optionLabel: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  optionLabelSelected: { color: accessibleOrange, fontWeight: '900' },
  optionDescription: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
});
