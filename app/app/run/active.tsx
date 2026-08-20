import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Switch, Text, View } from 'react-native';

import { useUploadRun } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { usePreferences } from '@/src/components/preferences-provider';
import { useRunResult } from '@/src/components/run-result-provider';
import { FigmaLogo } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { RunMap } from '@/src/components/run-map';
import { Screen } from '@/src/components/screen';
import type { CadenceZone, JudgePhase, JudgeVerdict, RunState } from '@/src/engine/types';
import { attachCues } from '@/src/store/cue-bridge';
import {
  detachSensor,
  pauseTrackedRun,
  resumeTrackedRun,
  stopTrackedRun,
} from '@/src/store/runController';
import { useRunStore } from '@/src/store/runStore';
import { useSimulationStore } from '@/src/store/simulation';
import { dequeueRun } from '@/src/store/upload-queue';
import { colors, compactPressFeedback, navigationHeader, pressFeedback, radius, spacing, typography } from '@/src/theme/tokens';

export default function ActiveRunScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const {
    voiceEnabled,
    metronomeEnabled,
    hapticsEnabled,
    setVoiceEnabled,
    setMetronomeEnabled,
    setHapticsEnabled,
  } = usePreferences();
  const { setResult } = useRunResult();
  const upload = useUploadRun(token);
  const run = useRunStore();
  const simulationActive = useSimulationStore((state) => state.active);
  const stopSimulation = useSimulationStore((state) => state.stop);
  const [showEnd, setShowEnd] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const previousTarget = useRef(run.target.center);

  useEffect(() => attachCues(), []);

  useEffect(() => {
    if (previousTarget.current > 0 && run.target.center < previousTarget.current) {
      setTargetNotice(`목표를 ${run.target.center}로 낮췄어요`);
      const timeout = setTimeout(() => setTargetNotice(null), 4500);
      previousTarget.current = run.target.center;
      return () => clearTimeout(timeout);
    }
    previousTarget.current = run.target.center;
  }, [run.target.center]);

  const save = async () => {
    const snapshot = run.snapshot();
    const activeDurationSec = Math.round(run.activeSec);
    const completed = snapshot !== null && (
      snapshot.goal.type === 'TIME'
        ? run.activeSec >= snapshot.goal.value
        : (run.distanceM ?? 0) >= snapshot.goal.value
    );
    let record;
    if (simulationActive) {
      stopSimulation();
      record = run.finish(completed);
    } else {
      record = await stopTrackedRun(completed);
    }
    if (!record) return;

    if (simulationActive) {
      setResult({ record, activeDurationSec, uploaded: null, report: null, simulated: true });
      router.replace('/run/finish');
      return;
    }

    let uploaded = null;
    try {
      uploaded = await upload.mutateAsync(record);
      dequeueRun(record.clientRunId);
    } catch {
      // The local result is preserved and shown on the finish screen.
    }
    setResult({ record, activeDurationSec, uploaded, report: null, simulated: false });
    router.replace('/run/finish');
  };

  const discard = () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    if (simulationActive) stopSimulation();
    else detachSensor();
    run.reset();
    router.dismissTo('/');
  };

  const togglePause = () => {
    if (run.runState === 'PAUSED') resumeTrackedRun();
    else pauseTrackedRun();
  };

  const closeEndSheet = () => {
    setShowEnd(false);
    setConfirmDiscard(false);
  };

  const verdictColor = cadenceColor(run.verdict);
  const cadenceStatus = getCadenceStatus(run);

  return (
    <Screen padded={false} scroll={false}>
      <View style={styles.activeRoot}>
      <View style={styles.contentTop}>
        <FigmaLogo left={14} />
        <Pressable accessibilityLabel="가이드" onPress={() => setShowGuide((value) => !value)} style={({ pressed }) => [styles.help, pressed && styles.iconPressed]}><Ionicons color={colors.white} name="help-circle-outline" size={26} /></Pressable>
        <Pressable accessibilityLabel="설정" onPress={() => router.push('/settings')} style={({ pressed }) => [styles.settings, pressed && styles.iconPressed]}><Ionicons color={colors.white} name="settings-outline" size={26} /></Pressable>
        {simulationActive ? <Text style={styles.badge}>시연</Text> : null}

      <View style={styles.statusPill}><View style={[styles.statusDot, { backgroundColor: cadenceStatus.color }]} /><Text style={styles.statusText}>{cadenceStatus.message}</Text></View>
      {/* 초시계는 일시정지 구간을 뺀 `activeSec`이다. `totalSec`은 서버가 이벤트로 나누는 전체 시간축이라 화면에 쓰지 않는다. */}
      <Text style={styles.time}>{formatDuration(run.activeSec)}</Text>

      <View style={styles.metrics}>
        <Metric highlighted label="현재 케이던스" value={run.verdict === 'UNAVAILABLE' || run.displayCadence === null ? '—' : `${Math.round(run.displayCadence)} SPM`} color={verdictColor} />
        <Metric label="거리" value={run.distanceM === null ? '—' : `${(run.distanceM / 1000).toFixed(2)} km`} />
        <Metric label="평균 페이스" value={run.paceSecPerKm === null ? '—' : `${formatPace(run.paceSecPerKm)}/km`} />
      </View>
      </View>

      {targetNotice ? <Text pointerEvents="none" style={styles.notice}>{targetNotice}</Text> : null}
      {!showGuide ? <RunMap live style={styles.map} /> : null}
      {showGuide ? <View style={styles.guide}><Text style={styles.guideTitle}>러닝 가이드 방식</Text><GuideToggle label="음성 안내" copy="목표 이탈 시에만 짧게 코칭합니다" value={voiceEnabled} onChange={setVoiceEnabled}/><GuideToggle label="메트로놈 비트" copy="목표 SPM 리듬에 맞춘 박자 소리" value={metronomeEnabled} onChange={setMetronomeEnabled}/><GuideToggle label="진동 알림" copy="리듬 조절 필요 시 스마트폰 진동" value={hapticsEnabled} onChange={setHapticsEnabled}/></View> : null}
      <View style={styles.controls}>
        <Pressable onPress={togglePause} style={({ pressed }) => [styles.runButton, styles.pauseButton, pressed && styles.buttonPressed]}><Text style={styles.runButtonText}>{run.runState === 'PAUSED' ? '다시 달리기' : '일시정지'}</Text></Pressable>
        <Pressable onPress={() => setShowEnd(true)} style={({ pressed }) => [styles.runButton, styles.finishButton, pressed && styles.buttonPressed]}><Text style={styles.runButtonText}>러닝 완료</Text></Pressable>
      </View>

      {run.runState === 'PAUSED' ? <View pointerEvents="none" style={styles.pauseOverlay}><Text style={styles.pauseText}>잠시 멈췄어요</Text></View> : null}

      <Modal animationType="slide" onRequestClose={closeEndSheet} transparent visible={showEnd}>
        <Pressable style={styles.backdrop} onPress={closeEndSheet} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{confirmDiscard ? '이 기록을 정말 버릴까요?' : '러닝을 마칠까요?'}</Text>
          <Text style={styles.sheetBody}>{confirmDiscard ? '버린 기록은 복구할 수 없어요.' : '지금까지의 러닝은 종료 후에도 안전하게 저장할 수 있어요.'}</Text>
          {!confirmDiscard ? <>
            <SheetButton label="취소" onPress={() => { closeEndSheet(); resumeTrackedRun(); }} />
            <PrimaryButton loading={upload.isPending} onPress={() => void save()}>종료하고 저장</PrimaryButton>
            <SheetButton label="기록 버리기" onPress={discard} variant="dangerText" />
          </> : <>
            <SheetButton label="기록 버리기" onPress={discard} variant="danger" />
            <SheetButton label="돌아가기" onPress={() => setConfirmDiscard(false)} />
          </>}
        </View>
      </Modal>
      </View>
    </Screen>
  );
}

function Metric({ label, value, highlighted = false, color = colors.text }: { label: string; value: string; highlighted?: boolean; color?: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, highlighted && styles.metricHighlighted, { color }]}>{value}</Text></View>;
}

function GuideToggle({label,copy,value,onChange}:{label:string;copy:string;value:boolean;onChange:(value:boolean)=>void}) { return <View style={styles.guideToggle}><View><Text style={styles.guideLabel}>{label}</Text><Text style={styles.guideCopy}>{copy}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{false:'#DDE0E1',true:colors.primary}} thumbColor={colors.white}/></View>; }

function SheetButton({ label, onPress, variant = 'secondary' }: { label: string; onPress: () => void; variant?: 'secondary' | 'danger' | 'dangerText' }) {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [
      variant === 'dangerText' ? styles.sheetTextButton : styles.sheetButton,
      variant === 'danger' && styles.sheetDangerButton,
      pressed && styles.sheetButtonPressed,
    ]}
  ><Text style={[
    styles.sheetButtonLabel,
    variant === 'danger' && styles.sheetDangerButtonLabel,
    variant === 'dangerText' && styles.sheetDangerText,
  ]}>{label}</Text></Pressable>;
}

/**
 * 상태 문구·점 색.
 *
 * 문구·색은 화면 판단이지만 **근거는 엔진 값이다.** cadence를 목표 범위와 직접 비교하면
 * 경계에서 매 초 문구가 뒤집히고(엔진은 ±4 진입 / ±3 회복 히스테리시스를 쓴다),
 * 워밍업 90초처럼 아직 판정하지 않는 구간까지 재촉하게 된다 (`ENGINE.md` §5·§7).
 *
 * 반대로 `verdict` 하나만 보면 걷기·정지도 `IN_RANGE`로 내려와서
 * 실제로 걷고 있는 사람에게 "안정적인 리듬"이라고 말한다 — 그래서 `zone`·`phase`를 같이 본다 (§4·§6).
 */
function getCadenceStatus(run: {
  runState: RunState;
  verdict: JudgeVerdict;
  phase: JudgePhase;
  zone: CadenceZone | null;
  cadence: number | null;
  recovery: boolean;
}): { message: string; color: string } {
  if (run.runState === 'PAUSED') return { message: '잠시 멈췄어요', color: colors.disabled };
  if (run.verdict === 'UNAVAILABLE' || run.cadence === null) {
    return { message: '케이던스를 측정하고 있어요', color: colors.disabled };
  }
  if (run.zone === 'IDLE') return { message: '움직임이 거의 없어요', color: colors.disabled };
  if (run.recovery) return { message: '지금은 회복이 우선이에요', color: colors.disabled };
  if (run.phase === 'WARMUP') return { message: '워밍업 중이에요', color: colors.disabled };
  if (run.verdict === 'TOO_FAST') return { message: '리듬을 조금 낮춰보세요', color: colors.danger };
  if (run.verdict === 'TOO_SLOW' || run.zone === 'WALK') {
    return { message: '리듬을 조금 올려보세요', color: colors.danger };
  }
  return { message: '안정적인 리듬이에요', color: colors.success };
}

function cadenceColor(verdict: JudgeVerdict) {
  if (verdict === 'UNAVAILABLE') return colors.disabled;
  if (verdict === 'TOO_FAST' || verdict === 'TOO_SLOW') return colors.accent;
  return colors.text;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatPace(value: number) {
  return `${Math.floor(value / 60)}′${String(Math.round(value % 60)).padStart(2, '0')}″`;
}

const styles = StyleSheet.create({
  activeRoot: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  contentTop: { zIndex: 2, paddingHorizontal: 20, paddingTop: 100 - navigationHeader.contentLift },
  help: { position: 'absolute', right: 63, top: navigationHeader.compactActionTop, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  settings: { position: 'absolute', right: 14, top: navigationHeader.compactActionTop, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconPressed: compactPressFeedback,
  time: { fontSize: 64, lineHeight: 76, fontWeight: '800', color: colors.text, marginTop: 20 },
  badge: { position: 'absolute', left: 95, top: 38, ...typography.caption, color: colors.primary },
  /**
   * 목표 하향 안내. **흐름에 두면 안 된다.**
   *
   * 4.5초 동안 나타났다 사라지는데, 흐름에 있으면 그동안 아래가 통째로 밀린다.
   * 지도는 절대 배치라 같이 안 밀려서 지표가 지도로 38px 파고든다 (실측: 지표 하단이
   * 284 → 339로, 지도 시작선 301을 넘는다).
   *
   * 지표 아래(284)에서 시작해 지도 위에 띄운다. 떠 있으므로 나타나든 사라지든
   * 아래 배치가 움직이지 않는다.
   */
  notice: { position: 'absolute', left: 20, right: 20, top: 312 - navigationHeader.contentLift, zIndex: 3, ...typography.bodyStrong, color: colors.primary, textAlign: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  statusPill: { alignSelf: 'center', width: 270, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: .5, borderColor: 'rgba(221,224,225,.2)', borderRadius: 30, backgroundColor: colors.surfaceMuted },
  statusDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.success },
  statusText: { ...typography.bodyStrong, color: colors.text },
  metrics: { flexDirection: 'row', gap: 13 },
  metric: { flex: 1, height: 58, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: .5, borderColor: 'rgba(221,224,225,.3)', borderRadius: 20, backgroundColor: colors.surfaceMuted },
  metricLabel: { ...typography.caption, color: colors.text },
  metricValue: { ...typography.subhead, fontWeight: '700', color: colors.text },
  metricHighlighted: { color: colors.primary },
  map: { position: 'absolute', left: 0, right: 0, top: 321 - navigationHeader.contentLift, width: '100%', bottom: 0 },
  guide: { position: 'absolute', left: 29, right: 27, top: 341 - navigationHeader.contentLift, height: 203, padding: 21, borderRadius: 20, backgroundColor: colors.white, zIndex: 2 },
  guideTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 7 },
  guideToggle: { height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 3 },
  guideLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' }, guideCopy: { color: 'rgba(28,26,26,.58)', fontSize: 12 },
  controls: { position: 'absolute', left: 13, right: 13, bottom: 20, zIndex: 3, flexDirection: 'row', gap: 10 },
  runButton: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  buttonPressed: pressFeedback,
  pauseButton: { backgroundColor: colors.background },
  finishButton: { backgroundColor: colors.primary },
  runButtonText: { ...typography.button, color: colors.white },
  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
  pauseText: { ...typography.title, color: colors.white },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 24, right: 24, top: '35%', gap: spacing.md, padding: 30, borderRadius: 40, backgroundColor: colors.white },
  sheetTitle: { ...typography.heading, color: colors.ink },
  sheetBody: { ...typography.subhead, color: 'rgba(28,26,26,.62)' },
  sheetButton: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D9D9D9', borderRadius: radius.md, backgroundColor: colors.white },
  sheetButtonLabel: { ...typography.button, color: colors.ink },
  sheetDangerButton: { borderColor: colors.danger, backgroundColor: colors.danger },
  sheetDangerButtonLabel: { color: colors.white },
  sheetTextButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sheetDangerText: { ...typography.button, color: '#D94444' },
  sheetButtonPressed: pressFeedback,
});
