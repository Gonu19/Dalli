import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { useRunResult } from '@/src/components/run-result-provider';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function RunFinishScreen() {
  const router = useRouter();
  const { result } = useRunResult();

  if (!result) {
    return <Screen><StatePanel title="완료된 러닝이 없어요" body="홈에서 오늘의 러닝을 시작해 주세요." actionLabel="홈으로" onAction={() => router.replace('/')} /></Screen>;
  }

  return (
    <Screen footer={<PrimaryButton onPress={() => router.push('/run/report')}>리포트 보기</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{result.record.completed ? '완주' : '러닝 종료'}</Text>
        <Text style={styles.title}>오늘도 한 번의 러닝을 기록했어요.</Text>
        <Text style={styles.body}>{result.simulated ? '시연 기록은 서버에 저장하지 않았어요.' : result.uploaded ? '러닝과 리포트가 안전하게 저장됐어요.' : '기기에 결과를 보존했어요. 연결 후 다시 저장할 수 있어요.'}</Text>
      </View>
      <View style={styles.card}>
        <Summary label="시간" value={formatDuration(result.record.durationSec)} />
        <Summary label="거리" value={result.record.distanceM === null ? '—' : `${(result.record.distanceM / 1000).toFixed(2)} km`} />
        <Summary label="평균 리듬" value={result.record.avgCadence === null ? '—' : `${result.record.avgCadence} spm`} />
      </View>
      <PrimaryButton variant="text" onPress={() => router.replace('/')}>홈으로 돌아가기</PrimaryButton>
    </Screen>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <View style={styles.summary}><Text style={styles.value}>{value}</Text><Text style={styles.label}>{label}</Text></View>;
}

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  return `${minutes}분 ${Math.round(value % 60)}초`;
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  eyebrow: { ...typography.bodyStrong, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.textMuted },
  card: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  summary: { flex: 1, alignItems: 'center', gap: spacing.xs },
  value: { ...typography.bodyStrong, color: colors.text },
  label: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
