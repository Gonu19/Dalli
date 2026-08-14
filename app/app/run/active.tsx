import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useUploadRun } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { usePreferences } from '@/src/components/preferences-provider';
import { useRunResult } from '@/src/components/run-result-provider';
import { Screen } from '@/src/components/screen';
import type { JudgeVerdict } from '@/src/engine/types';
import {
  detachSensor,
  pauseTrackedRun,
  resumeTrackedRun,
  stopTrackedRun,
} from '@/src/store/runController';
import { useRunStore } from '@/src/store/runStore';
import { useSimulationStore } from '@/src/store/simulation';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function ActiveRunScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { voiceEnabled, metronomeEnabled } = usePreferences();
  const { setResult } = useRunResult();
  const upload = useUploadRun(token);
  const run = useRunStore();
  const simulationActive = useSimulationStore((state) => state.active);
  const stopSimulation = useSimulationStore((state) => state.stop);
  const [showEnd, setShowEnd] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const previousTarget = useRef(run.target.center);
  const previousInterventions = useRef(run.interventionCount);

  useEffect(() => {
    if (previousTarget.current > 0 && run.target.center < previousTarget.current) {
      setTargetNotice(`목표를 ${run.target.center}로 낮췄어요`);
      const timeout = setTimeout(() => setTargetNotice(null), 4500);
      previousTarget.current = run.target.center;
      return () => clearTimeout(timeout);
    }
    previousTarget.current = run.target.center;
  }, [run.target.center]);

  useEffect(() => {
    if (
      run.interventionCount > previousInterventions.current
      && !voiceEnabled
      && !metronomeEnabled
    ) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    previousInterventions.current = run.interventionCount;
  }, [metronomeEnabled, run.interventionCount, voiceEnabled]);

  const save = async () => {
    let record;
    if (simulationActive) {
      stopSimulation();
      record = run.finish(true);
    } else {
      record = await stopTrackedRun(false);
    }
    if (!record) return;

    if (simulationActive) {
      setResult({ record, uploaded: null, report: null, simulated: true });
      router.replace('/run/finish');
      return;
    }

    let uploaded = null;
    try {
      uploaded = await upload.mutateAsync(record);
    } catch {
      // The local result is preserved and shown on the finish screen.
    }
    setResult({ record, uploaded, report: null, simulated: false });
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
    router.replace('/');
  };

  const togglePause = () => {
    if (run.runState === 'PAUSED') resumeTrackedRun();
    else pauseTrackedRun();
  };

  const verdictColor = cadenceColor(run.verdict);

  return (
    <Screen scroll={false}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>경과 시간</Text>
          <Text style={styles.time}>{formatDuration(run.totalSec)}</Text>
        </View>
        {simulationActive ? <Text style={styles.badge}>시연 모드</Text> : null}
      </View>

      {targetNotice ? <Text style={styles.notice}>{targetNotice}</Text> : null}
      {run.recovery ? <Text style={styles.notice}>지금은 회복이 우선이에요</Text> : null}

      <View style={styles.rhythmArea}>
        <Text style={styles.label}>현재 리듬</Text>
        <Text style={[styles.cadence, { color: verdictColor }]}>{run.verdict === 'UNAVAILABLE' || run.cadence === null ? '—' : Math.round(run.cadence)}</Text>
        <Text style={styles.unit}>{run.verdict === 'UNAVAILABLE' ? '측정이 어려워요' : 'spm'}</Text>
        <View style={styles.targetPill}>
          <Text style={styles.targetLabel}>오늘의 리듬</Text>
          <Text style={styles.targetValue}>{run.target.center}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric label="거리" value={run.distanceM === null ? '—' : `${(run.distanceM / 1000).toFixed(2)} km`} />
        <Metric label="페이스" value={run.paceSecPerKm === null ? '—' : formatPace(run.paceSecPerKm)} />
      </View>

      <View style={styles.controls}>
        <PrimaryButton variant="secondary" onPress={togglePause}>
          {run.runState === 'PAUSED' ? '다시 달리기' : '일시정지'}
        </PrimaryButton>
        <PrimaryButton variant="text" onPress={() => setShowEnd(true)}>러닝 종료</PrimaryButton>
      </View>

      {run.runState === 'PAUSED' ? <View pointerEvents="none" style={styles.pauseOverlay}><Text style={styles.pauseText}>잠시 멈췄어요</Text></View> : null}

      <Modal animationType="slide" onRequestClose={() => setShowEnd(false)} transparent visible={showEnd}>
        <Pressable style={styles.backdrop} onPress={() => setShowEnd(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{confirmDiscard ? '이 기록을 정말 버릴까요?' : '러닝을 마칠까요?'}</Text>
          <Text style={styles.sheetBody}>{confirmDiscard ? '버린 기록은 복구할 수 없어요.' : '지금까지의 러닝은 종료 후에도 안전하게 저장할 수 있어요.'}</Text>
          {!confirmDiscard ? <PrimaryButton variant="secondary" onPress={() => { setShowEnd(false); resumeTrackedRun(); }}>계속 달리기</PrimaryButton> : null}
          {!confirmDiscard ? <PrimaryButton loading={upload.isPending} onPress={() => void save()}>종료하고 저장</PrimaryButton> : null}
          <PrimaryButton variant="text" onPress={discard}>{confirmDiscard ? '기록 버리기' : '기록 버리기'}</PrimaryButton>
          {confirmDiscard ? <PrimaryButton variant="secondary" onPress={() => setConfirmDiscard(false)}>돌아가기</PrimaryButton> : null}
        </View>
      </Modal>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.label}>{label}</Text></View>;
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typography.caption, color: colors.textMuted },
  time: { ...typography.heading, color: colors.text },
  badge: { ...typography.caption, color: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  notice: { ...typography.bodyStrong, color: colors.primary, textAlign: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  rhythmArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cadence: { fontSize: 104, lineHeight: 116, fontWeight: '700' },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  targetPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  targetLabel: { ...typography.caption, color: colors.textMuted },
  targetValue: { ...typography.heading, color: colors.primary },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, alignItems: 'center', gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  metricValue: { ...typography.heading, color: colors.text },
  controls: { gap: spacing.sm },
  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(23,33,28,0.72)' },
  pauseText: { ...typography.title, color: colors.white },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.background },
  sheetTitle: { ...typography.title, color: colors.text },
  sheetBody: { ...typography.body, color: colors.textMuted },
});
