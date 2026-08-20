import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { useCalendar } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { usePreferences } from '@/src/components/preferences-provider';
import { WheelPickerModal } from '@/src/components/wheel-picker-modal';
import { CONDITION_VALUE } from '@/src/engine/constants';
import type { ConditionLevel } from '@/src/engine/types';
import { findPlanForRun } from '@/src/store/plan-link';
import { useMetronomePreview } from '@/src/components/use-metronome-preview';
import { startTrackedRun } from '@/src/store/runController';
import type { RunGoal } from '@/src/store/runStore';
import { colors, compactPressFeedback, navigationHeader, pressFeedback } from '@/src/theme/tokens';

const timeOptions = Array.from({ length: 24 }, (_, index) => String((index + 1) * 5));
/** 1.0 ~ 15.0 km, 0.5 km 간격. 리포트가 만드는 계획도 0.5 km 단위로 움직인다. */
const distanceOptions = Array.from({ length: 29 }, (_, index) => (1 + index * 0.5).toFixed(1));
const goalKinds = [
  { kind: 'TIME', label: '시간' },
  { kind: 'DISTANCE', label: '거리' },
] as const;
/** 처음 전환했을 때 채워 넣을 값. 빈 칸으로 두면 시작 버튼이 잠겨 이유를 알 수 없다. */
const DEFAULT_TIME_SEC = 30 * 60;
const DEFAULT_DISTANCE_M = 3000;
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
  // 시간·거리 값을 따로 들고 있는다. 토글을 오갈 때 방금 고른 값이 사라지면 안 된다.
  const [goalKind, setGoalKind] = useState<RunGoal['type']>('TIME');
  const [timeSec, setTimeSec] = useState<number | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);
  const { previewing, toggle: togglePreview, stop: stopPreview } = useMetronomePreview(cadence);
  const goal: RunGoal | null = goalKind === 'TIME'
    ? (timeSec === null ? null : { type: 'TIME', value: timeSec })
    : (distanceM === null ? null : { type: 'DISTANCE', value: distanceM });

  // 오늘 계획이 있으면 그 목표로 시작한다. 계획을 세운 사람에게 목표를 다시 묻지 않는다.
  const { token } = useAuth();
  const now = new Date();
  const calendar = useCalendar(token, now.getFullYear(), now.getMonth() + 1);
  const plan = useMemo(
    () => findPlanForRun(calendar.data ?? [], new Date()),
    [calendar.data],
  );

  // 계획 값은 한 번만 채운다. 응답이 늦게 와서 사용자가 조절한 값을 덮어쓰면 안 된다.
  const planApplied = useRef(false);
  useEffect(() => {
    if (planApplied.current || plan === null) return;
    planApplied.current = true;
    setGoalKind(plan.goalType);
    if (plan.goalType === 'TIME') setTimeSec(plan.goalValue);
    else setDistanceM(plan.goalValue);
    if (plan.targetCadence !== null) setCadence(plan.targetCadence);
  }, [plan]);
  const { voiceEnabled, metronomeEnabled, hapticsEnabled, setVoiceEnabled, setMetronomeEnabled, setHapticsEnabled } = usePreferences();

  /** 토글로 종류를 바꾼다. 그쪽 값이 아직 없으면 기본값을 채워 시작 버튼이 잠기지 않게 한다. */
  const selectGoalKind = (kind: RunGoal['type']) => {
    setGoalKind(kind);
    if (kind === 'TIME' && timeSec === null) setTimeSec(DEFAULT_TIME_SEC);
    if (kind === 'DISTANCE' && distanceM === null) setDistanceM(DEFAULT_DISTANCE_M);
  };

  /** 오늘 계획에서 온 목표를 그대로 쓰고 있을 때만 어디서 온 값인지 알린다. */
  const planNote = plan !== null && goal !== null && goal.type === plan.goalType && goal.value === plan.goalValue
    ? `${plan.title?.trim() || '오늘 계획'} 목표예요.`
    : null;

  const begin = async () => {
    if (cadence === null || goal === null) return;
    stopPreview();
    await startTrackedRun({
      referenceCadence: cadence,
      condition: CONDITION_VALUE[condition],
      goal,
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
      <Pressable
        accessibilityLabel={previewing ? '리듬 듣기 멈춤' : '목표 리듬 들어보기'}
        accessibilityRole="button"
        disabled={cadence === null}
        onPress={togglePreview}
        style={({ pressed }) => [styles.preview, previewing && styles.previewOn, cadence === null && styles.disabled, pressed && styles.controlPressed]}
      >
        <Ionicons color={previewing ? colors.white : colors.primary} name={previewing ? 'stop' : 'volume-medium'} size={14} />
        <Text style={[styles.previewText, previewing && styles.previewTextOn]}>{previewing ? '멈춤' : '들어보기'}</Text>
      </Pressable>
      <View style={styles.valueRow}><Text style={styles.value}>{cadence ?? '—'}</Text>{cadence !== null ? <Text style={styles.unit}>spm</Text> : null}</View>
      <View style={styles.controls}>{cadenceControls.map(({ delta, label }) => <Pressable
        accessibilityLabel={`케이던스 ${label}`}
        key={delta}
        disabled={cadence === null}
        onPress={() => setCadence((current) => current === null ? current : Math.max(130, Math.min(185, current + delta)))}
        style={({ pressed }) => [styles.control, cadence === null && styles.disabled, pressed && styles.controlPressed]}
      ><Text style={styles.controlText}>{label}</Text></Pressable>)}</View>
      <View style={styles.line} />
      <View style={styles.segment}>{goalKinds.map(({ kind, label }) => <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: goalKind === kind }}
        key={kind}
        onPress={() => selectGoalKind(kind)}
        style={({ pressed }) => [styles.segmentItem, goalKind === kind && styles.segmentItemOn, pressed && styles.controlPressed]}
      ><Text style={[styles.segmentText, goalKind === kind && styles.segmentTextOn]}>{label}</Text></Pressable>)}</View>
      <Pressable accessibilityLabel={goalKind === 'DISTANCE' ? '목표 거리' : '목표 시간'} accessibilityRole="button" onPress={() => setGoalPickerOpen(true)} style={({ pressed }) => [styles.timeBox, pressed && styles.controlPressed]}>
        <Text style={[styles.time, goal === null && styles.timePlaceholder]}>{formatGoalValue(goal)}</Text>{goal !== null ? <Text style={styles.timeUnit}>{goalKind === 'DISTANCE' ? 'km' : '분'}</Text> : null}
        <Ionicons color={colors.inkMuted} name="chevron-down" size={14} style={styles.timeChevron} />
      </Pressable>
      {planNote !== null ? <Text numberOfLines={1} style={styles.planNote}>{planNote}</Text> : null}
    </View>
    <View style={styles.guide}>
      <Text style={[styles.cardTitle, styles.guideTitle]}>러닝 가이드 방식</Text>
      <Toggle label="음성 안내" copy="목표 이탈 시에만 짧게 코칭합니다" value={voiceEnabled} onChange={setVoiceEnabled} />
      <Toggle label="메트로놈 비트" copy="목표 SPM 리듬에 맞춘 박자 소리" value={metronomeEnabled} onChange={setMetronomeEnabled} />
      <Toggle label="진동 알림" copy="리듬 조절 필요 시 스마트폰 진동" value={hapticsEnabled} onChange={setHapticsEnabled} />
    </View>
    <Pressable disabled={cadence === null || goal === null} onPress={() => void begin()} style={({ pressed }) => [styles.start, (cadence === null || goal === null) && styles.disabledStart, pressed && styles.buttonPressed]}>
      <Ionicons color={colors.white} name="play" size={20} /><Text style={styles.startText}>러닝 시작하기</Text>
    </Pressable>
    {goalPickerOpen ? <WheelPickerModal
      columns={[goalKind === 'DISTANCE'
        ? {
            values: distanceOptions,
            initialIndex: Math.max(0, distanceM === null ? -1 : distanceOptions.indexOf((distanceM / 1000).toFixed(1))),
            suffix: 'km',
          }
        : {
            values: timeOptions,
            initialIndex: Math.max(0, timeSec === null ? -1 : timeOptions.indexOf(String(timeSec / 60))),
            suffix: '분',
          }]}
      onCancel={() => setGoalPickerOpen(false)}
      onConfirm={(indexes) => {
        if (goalKind === 'DISTANCE') setDistanceM(Math.round(Number(distanceOptions[indexes[0]]) * 1000));
        else setTimeSec(Number(timeOptions[indexes[0]]) * 60);
        setGoalPickerOpen(false);
      }}
      title={goalKind === 'DISTANCE' ? '목표 거리' : '목표 시간'}
      visible
    /> : null}
  </FigmaScreen>;
}

/** 목표 값 표시 — 거리는 km, 시간은 분. 단위는 옆 칸이 따로 그린다. */
function formatGoalValue(goal: RunGoal | null): string {
  if (goal === null) return '선택';
  return goal.type === 'DISTANCE' ? String(Number((goal.value / 1000).toFixed(2))) : String(goal.value / 60);
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
  preview: { position: 'absolute', right: 18, top: 14, flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.primary },
  previewOn: { backgroundColor: colors.primary },
  previewText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  previewTextOn: { color: colors.white },
  line: { position: 'absolute', left: 18, right: 18, top: 168, height: 1, backgroundColor: colors.border },
  timeBox: { position: 'absolute', left: 105, top: 190, width: 104, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  time: { marginLeft: 17, fontSize: 14, fontWeight: '700', color: colors.ink },
  timePlaceholder: { color: colors.inkMuted },
  timeUnit: { position: 'absolute', right: 28, fontSize: 13, fontWeight: '700', color: colors.inkMuted },
  timeChevron: { position: 'absolute', right: 8 },
  guide: { position: 'absolute', left: 29, right: 27, top: 425 - navigationHeader.contentLift, height: 203, borderRadius: 20, backgroundColor: colors.white, padding: 21 },
  guideTitle: { marginBottom: 10 },
  // 카드가 절대좌표 레이아웃이라 세그먼트도 같은 방식으로 놓는다. 제목 자리를 대신하므로
  // `timeBox`(left 105)와 겹치지 않게 폭을 묶어 둔다. 둘 다 왼쪽 기준이라 화면 폭과 무관하다.
  segment: { position: 'absolute', left: 18, top: 192, flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: colors.border, padding: 2 },
  segmentItem: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  segmentItemOn: { backgroundColor: colors.primary },
  segmentText: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  segmentTextOn: { color: colors.white },
  planNote: { position: 'absolute', left: 18, right: 18, top: 228, fontSize: 11, color: colors.inkMuted },
  toggle: { height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 3 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: colors.ink },
  toggleCopy: { fontSize: 12, color: 'rgba(28,26,26,.58)', marginTop: 2 },
  start: { position: 'absolute', left: 28, right: 27, top: 646 - navigationHeader.contentLift, height: 52, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  disabledStart: { opacity: 0.45 },
  startText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
