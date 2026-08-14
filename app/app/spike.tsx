import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Pedometer } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

type CheckStatus = 'idle' | 'running' | 'passed' | 'failed';
type StepPoint = { at: number; steps: number };

const silence = require('@/assets/sounds/silence.wav');

export default function SpikeScreen() {
  const router = useRouter();
  const player = useAudioPlayer(silence, { keepAudioSessionActive: true });
  const audioStatus = useAudioPlayerStatus(player);
  const [pedometerStatus, setPedometerStatus] = useState<CheckStatus>('idle');
  const [audioCheck, setAudioCheck] = useState<CheckStatus>('idle');
  const [speechCheck, setSpeechCheck] = useState<CheckStatus>('idle');
  const [steps, setSteps] = useState(0);
  const [cadence, setCadence] = useState<number | null>(null);
  const [backgroundSteps, setBackgroundSteps] = useState<number | null>(null);
  const [message, setMessage] = useState('각 항목을 실기기에서 차례로 확인해 주세요.');
  const startedAt = useRef<Date | null>(null);
  const stepPoints = useRef<StepPoint[]>([]);
  const pedometerSubscription = useRef<ReturnType<typeof Pedometer.watchStepCount> | null>(null);

  useEffect(() => {
    return () => {
      pedometerSubscription.current?.remove();
      Speech.stop();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !startedAt.current || Platform.OS !== 'ios') return;
      try {
        const result = await Pedometer.getStepCountAsync(startedAt.current, new Date());
        setBackgroundSteps(result.steps);
        if (result.steps > 0) setPedometerStatus('passed');
      } catch {
        setMessage('화면 복귀 후 누적 걸음을 읽지 못했어요. 모션 권한을 확인해 주세요.');
      }
    });
    return () => subscription.remove();
  }, []);

  const startPedometer = async () => {
    setPedometerStatus('running');
    setMessage('20초 이상 걸어 주세요. 화면을 끈 뒤 다시 켜 누적 걸음도 확인하세요.');
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      setPedometerStatus('failed');
      setMessage('이 기기에서는 만보계 데이터를 사용할 수 없어요.');
      return;
    }

    const permission = await Pedometer.requestPermissionsAsync();
    if (!permission.granted) {
      setPedometerStatus('failed');
      setMessage('모션 권한이 거부되어 걸음을 측정할 수 없어요.');
      return;
    }

    startedAt.current = new Date();
    stepPoints.current = [{ at: Date.now(), steps: 0 }];
    pedometerSubscription.current?.remove();
    pedometerSubscription.current = Pedometer.watchStepCount((result) => {
      const now = Date.now();
      const points = [...stepPoints.current, { at: now, steps: result.steps }]
        .filter((point) => point.at >= now - 20_000);
      stepPoints.current = points;
      setSteps(result.steps);

      const first = points[0];
      const last = points.at(-1);
      if (first && last && last.at > first.at) {
        const spm = Math.round(((last.steps - first.steps) * 60_000) / (last.at - first.at));
        setCadence(spm);
        if (last.steps > first.steps) setPedometerStatus('passed');
      }
    });
  };

  const startSilentLoop = async () => {
    setAudioCheck('running');
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
      });
      player.loop = true;
      player.volume = 1;
      player.play();
      setAudioCheck('passed');
      setMessage('외부 음악을 재생한 뒤 화면을 꺼 보세요. 음악과 무음 루프가 함께 유지되어야 해요.');
    } catch {
      setAudioCheck('failed');
      setMessage('오디오 세션을 시작하지 못했어요. dev build와 iOS 설정을 확인해 주세요.');
    }
  };

  const testSpeech = async () => {
    setSpeechCheck('running');
    try {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
      Speech.speak('지금은 조금 천천히 가도 괜찮아요.', {
        language: 'ko-KR',
        rate: 1,
        onDone: () => setSpeechCheck('passed'),
        onError: () => setSpeechCheck('failed'),
      });
      setMessage('음성이 나오는 동안 외부 음악이 멈추거나 크게 작아지지 않는지 들어 보세요.');
    } catch {
      setSpeechCheck('failed');
    }
  };

  return (
    <Screen footer={<PrimaryButton variant="text" onPress={() => router.back()}>닫기</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>IN-06 · 실기기 전용</Text>
        <Text style={styles.title}>센서·오디오 스파이크</Text>
        <Text style={styles.description}>{message}</Text>
      </View>

      <CheckCard title="1. Pedometer" status={pedometerStatus}>
        <Text style={styles.metric}>{cadence ?? '—'} <Text style={styles.unit}>spm</Text></Text>
        <Text style={styles.detail}>전경 걸음 {steps} · 복귀 후 누적 {backgroundSteps ?? '—'}</Text>
        <PrimaryButton variant="secondary" onPress={() => void startPedometer()}>측정 시작</PrimaryButton>
      </CheckCard>

      <CheckCard title="2. expo-audio 무음 루프" status={audioCheck}>
        <Text style={styles.detail}>재생 상태: {audioStatus.playing ? '재생 중' : '정지'}</Text>
        <PrimaryButton variant="secondary" onPress={() => void startSilentLoop()}>무음 루프 시작</PrimaryButton>
      </CheckCard>

      <CheckCard title="3. expo-speech 믹싱" status={speechCheck}>
        <Text style={styles.detail}>외부 음악을 먼저 재생하고 음성을 확인하세요.</Text>
        <PrimaryButton variant="secondary" onPress={() => void testSpeech()}>안내 음성 재생</PrimaryButton>
      </CheckCard>
    </Screen>
  );
}

function CheckCard({
  title,
  status,
  children,
}: {
  title: string;
  status: CheckStatus;
  children: React.ReactNode;
}) {
  const statusLabel = {
    idle: '대기',
    running: '확인 중',
    passed: '동작',
    failed: '실패',
  }[status];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.status, status === 'failed' && styles.failed]}>{statusLabel}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  eyebrow: { ...typography.caption, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.textMuted },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cardTitle: { ...typography.heading, color: colors.text, flex: 1 },
  status: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  failed: { color: colors.danger },
  metric: { ...typography.display, color: colors.text },
  unit: { ...typography.bodyStrong, color: colors.textMuted },
  detail: { ...typography.body, color: colors.textMuted },
});
