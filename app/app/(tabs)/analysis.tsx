import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDeleteRun, useRuns } from '@/src/api/queries';
import type { RunListItem } from '@/src/api/client';
import { useAuth } from '@/src/components/auth-provider';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function AnalysisScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const runs = useRuns(token);
  const remove = useDeleteRun(token);

  const confirmDelete = (run: RunListItem) => {
    Alert.alert(
      '이 러닝을 삭제할까요?',
      '캘린더와 누적 활동일에서도 함께 사라져요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => void remove.mutateAsync(run.id) },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>분석</Text>
        <Text style={styles.body}>과거의 나와 비교하며 다음 러닝 하나를 준비해요.</Text>
      </View>

      {runs.isLoading ? <StatePanel loading title="러닝 기록을 불러오고 있어요" body="잠시만 기다려 주세요." /> : null}
      {runs.error ? <StatePanel title="기록을 불러오지 못했어요" body="저장된 기록은 유지돼요. 연결을 확인하고 다시 시도해 주세요." actionLabel="다시 시도" onAction={() => void runs.refetch()} /> : null}
      {runs.data?.length === 0 ? <StatePanel title="첫 러닝을 기다리고 있어요" body="러닝을 마치면 나의 리듬과 다음 행동을 확인할 수 있어요." actionLabel="첫 러닝 시작" onAction={() => router.push('/')} /> : null}

      {runs.data?.map((run) => (
        <Pressable
          accessibilityRole="button"
          key={run.id}
          onLongPress={() => confirmDelete(run)}
          onPress={() => run.source === 'APP' && router.push({ pathname: '/run/report', params: { runId: run.id } })}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.date}>{formatDate(run.startedAt)}</Text>
              <Text style={styles.source}>{run.source === 'APP' ? '앱 측정' : '수기 기록'}</Text>
            </View>
            <Text style={styles.complete}>{run.completed ? '완료' : '중도 종료'}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="시간" value={`${Math.floor(run.durationSec / 60)}분`} />
            <Metric label="평균 리듬" value={run.avgCadence === null ? '—' : `${run.avgCadence} spm`} />
            <Metric label="안정 구간" value={run.rhythmScore === null ? '—' : `${Math.round(run.rhythmScore * 100)}%`} />
          </View>
          <Text style={styles.hint}>{run.source === 'APP' ? '탭하여 리포트 보기 · 길게 눌러 삭제' : '앱 없이 달린 날도 활동일에 포함했어요.'}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.hint}>{label}</Text></View>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.textMuted },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  pressed: { opacity: 0.78 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { ...typography.heading, color: colors.text },
  source: { ...typography.caption, color: colors.textMuted },
  complete: { ...typography.caption, color: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, gap: spacing.xs },
  metricValue: { ...typography.bodyStrong, color: colors.text },
  hint: { ...typography.caption, color: colors.textMuted },
});
