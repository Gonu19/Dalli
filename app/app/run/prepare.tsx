import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { usePreferences } from '@/src/components/preferences-provider';
import { WheelPickerModal } from '@/src/components/wheel-picker-modal';
import { CONDITION_VALUE } from '@/src/engine/constants';
import type { ConditionLevel } from '@/src/engine/types';
import { startTrackedRun } from '@/src/store/runController';
import { colors, compactPressFeedback, navigationHeader, pressFeedback } from '@/src/theme/tokens';

const timeOptions = Array.from({ length: 24 }, (_, index) => String((index + 1) * 5));
const cadenceControls = [
  { delta: -5, label: '-5' },
  { delta: -1, label: '−' },
  { delta: 1, label: '+' },
  { delta: 5, label: '+5' },
] as const;

export default function RunPrepare() {
  const router = useRouter();
  const params = useLocalSearchParams<{ condition?: string; cadence?: string }>();
  const parsedCadence = Number(params.cadence);
  const referenceCadence = Number.isFinite(parsedCadence) && parsedCadence > 0 ? parsedCadence : null;
  const condition = (params.condition as ConditionLevel) || 'NORMAL';
  const [cadence, setCadence] = useState<number | null>(referenceCadence);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const { voiceEnabled, metronomeEnabled, hapticsEnabled, setVoiceEnabled, setMetronomeEnabled, setHapticsEnabled } = usePreferences();

  const begin = async () => {
    if (cadence === null || minutes === null) return;
    await startTrackedRun({
      referenceCadence: cadence,
      condition: CONDITION_VALUE[condition],
      goal: { type: 'TIME', value: minutes * 60 },
      onSensorUnavailable: () => Alert.alert(
        '케이던스를 측정하지 못했어요',
        '러닝은 계속 기록할 수 있어요.',
        [{ text: '계속', style: 'cancel' }, { text: '설정 열기', onPress: () => void Linking.openSettings() }],
      ),
      onLocationUnavailable: () => Alert.alert(
        '위치를 확인하지 못했어요',
        '거리와 페이스는 표시되지 않아요.',
        [{ text: '계속', style: 'cancel' }, { text: '설정 열기', onPress: () => void Linking.openSettings() }],
      ),
    });
    router.replace('/run/active');
  };

  return <FigmaScreen>
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>러닝 준비</Text>
    <Pressable accessibilityLabel="설정" onPress={() => router.push('/settings')} style={({ pressed }) => [styles.settings, pressed && styles.iconPressed]}>
      <Ionicons color={colors.white} name="settings-outline" size={26} />
    </Pressable>
    <View style={styles.goalCard}>
      <Text style={styles.cardTitle}>목표 케이던스 조절</Text>
      <View style={styles.valueRow}><Text style={styles.value}>{cadence ?? '—'}</Text>{cadence !== null ? <Text style={styles.unit}>spm</Text> : null}</View>
      <View style={styles.controls}>{cadenceControls.map(({ delta, label }) => <Pressable
        accessibilityLabel={`케이던스 ${label}`}
        key={delta}
        disabled={cadence === null}
        onPress={() => setCadence((current) => current === null ? current : Math.max(130, Math.min(185, current + delta)))}
        style={({ pressed }) => [styles.control, cadence === null && styles.disabled, pressed && styles.controlPressed]}
      ><Text style={styles.controlText}>{label}</Text></Pressable>)}</View>
      <View style={styles.line} />
      <Text style={styles.timeTitle}>목표 시간</Text>
      <Pressable accessibilityRole="button" onPress={() => setTimePickerOpen(true)} style={({ pressed }) => [styles.timeBox, pressed && styles.controlPressed]}>
        <Text style={[styles.time, minutes === null && styles.timePlaceholder]}>{minutes ?? '선택'}</Text>{minutes !== null ? <Text style={styles.timeUnit}>분</Text> : null}
        <Ionicons color={colors.inkMuted} name="chevron-down" size={14} style={styles.timeChevron} />
      </Pressable>
    </View>
    <View style={styles.guide}>
      <Text style={[styles.cardTitle, styles.guideTitle]}>러닝 가이드 방식</Text>
      <Toggle label="음성 안내" copy="목표 이탈 시에만 짧게 코칭합니다" value={voiceEnabled} onChange={setVoiceEnabled} />
      <Toggle label="메트로놈 비트" copy="목표 SPM 리듬에 맞춘 박자 소리" value={metronomeEnabled} onChange={setMetronomeEnabled} />
      <Toggle label="진동 알림" copy="리듬 조절 필요 시 스마트폰 진동" value={hapticsEnabled} onChange={setHapticsEnabled} />
    </View>
    <Pressable disabled={cadence === null || minutes === null} onPress={() => void begin()} style={({ pressed }) => [styles.start, (cadence === null || minutes === null) && styles.disabledStart, pressed && styles.buttonPressed]}>
      <Ionicons color={colors.white} name="play" size={20} /><Text style={styles.startText}>러닝 시작하기</Text>
    </Pressable>
    {timePickerOpen ? <WheelPickerModal
      columns={[{
        values: timeOptions,
         initialIndex: Math.max(0, minutes === null ? 0 : timeOptions.indexOf(String(minutes))),
        suffix: '분',
      }]}
      onCancel={() => setTimePickerOpen(false)}
      onConfirm={(indexes) => {
        setMinutes(Number(timeOptions[indexes[0]]));
        setTimePickerOpen(false);
      }}
      title="목표 시간"
      visible
    /> : null}
  </FigmaScreen>;
}

function Toggle({ label, copy, value, onChange }: { label: string; copy: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.toggle}><View><Text style={styles.toggleLabel}>{label}</Text><Text style={styles.toggleCopy}>{copy}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: '#DDE0E1', true: colors.primary }} thumbColor={colors.white} /></View>;
}

const styles = StyleSheet.create({
  settings: { position: 'absolute', right: 26, top: navigationHeader.actionTop, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconPressed: compactPressFeedback,
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', color: colors.white, fontSize: 17, fontWeight: '700' },
  goalCard: { position: 'absolute', left: 28, right: 28, top: 153 - navigationHeader.contentLift, height: 246, borderRadius: 20, backgroundColor: colors.white, padding: 18 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  valueRow: { position: 'absolute', left: 0, right: 0, top: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  value: { fontSize: 36, fontWeight: '800', color: colors.primary },
  unit: { fontSize: 13, fontWeight: '700', color: colors.inkMuted, marginTop: 14 },
  controls: { position: 'absolute', left: 18, right: 18, top: 113, flexDirection: 'row', justifyContent: 'space-between' },
  control: { width: 54, height: 34, borderWidth: 1, borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  controlPressed: compactPressFeedback,
  buttonPressed: pressFeedback,
  controlText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  disabled: { opacity: 0.45 },
  line: { position: 'absolute', left: 18, right: 18, top: 168, height: 1, backgroundColor: colors.border },
  timeTitle: { position: 'absolute', left: 18, top: 198, fontSize: 17, fontWeight: '700', color: colors.ink },
  timeBox: { position: 'absolute', left: 105, top: 190, width: 104, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  time: { marginLeft: 17, fontSize: 14, fontWeight: '700', color: colors.ink },
  timePlaceholder: { color: colors.inkMuted },
  timeUnit: { position: 'absolute', right: 28, fontSize: 13, fontWeight: '700', color: colors.inkMuted },
  timeChevron: { position: 'absolute', right: 8 },
  guide: { position: 'absolute', left: 29, right: 27, top: 425 - navigationHeader.contentLift, height: 203, borderRadius: 20, backgroundColor: colors.white, padding: 21 },
  guideTitle: { marginBottom: 10 },
  toggle: { height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 3 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  toggleCopy: { fontSize: 12, color: 'rgba(28,26,26,.58)', marginTop: 2 },
  start: { position: 'absolute', left: 28, right: 27, top: 646 - navigationHeader.contentLift, height: 52, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  disabledStart: { opacity: 0.45 },
  startText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
