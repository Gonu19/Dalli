import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useCreateReport, useRunDetail } from '@/src/api/queries';
import type { RunReport } from '@/src/api/client';
import { useAuth } from '@/src/components/auth-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { useRunResult } from '@/src/components/run-result-provider';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function RunReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result, setReport } = useRunResult();
  const localResult = params.runId ? null : result;
  const runId = params.runId ?? localResult?.uploaded?.id ?? null;
  const detail = useRunDetail(token, params.runId ?? null);
  const create = useCreateReport(token);
  const requested = useRef(false);

  useEffect(() => {
    if (!runId || localResult?.report || detail.data?.report || requested.current) return;
    if (params.runId && !detail.data) return;
    requested.current = true;
    create.mutateAsync(runId).then((created) => {
      if (!params.runId) setReport(created);
    }).catch(() => undefined);
  }, [create, detail.data?.report, detail.isLoading, localResult?.report, params.runId, runId, setReport]);

  const report = localResult?.report ?? detail.data?.report ?? create.data;
  const loading = detail.isLoading || Boolean(runId && create.isPending);
  const error = detail.error ?? create.error;

  if (!localResult && !params.runId) {
    return <Screen><StatePanel title="표시할 리포트가 없어요" body="러닝을 마치면 기본 기록과 다음 행동을 볼 수 있어요." actionLabel="홈으로" onAction={() => router.replace('/')} /></Screen>;
  }

  return (
    <Screen footer={<PrimaryButton onPress={() => router.replace('/analysis')}>분석에서 다시 보기</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>러닝 리포트</Text>
        <Text style={styles.title}>{report?.verdict ?? '오늘의 러닝을 마쳤어요'}</Text>
      </View>

      {localResult || detail.data ? (
        <View style={styles.metrics}>
          <Metric label="시간" value={`${Math.floor((localResult?.record.durationSec ?? detail.data!.durationSec) / 60)}분`} />
          <Metric label="평균 리듬" value={formatCadence(localResult?.record.avgCadence ?? detail.data?.avgCadence ?? null)} unit="spm" />
          <Metric label="개입" value={`${localResult?.record.interventionCount ?? detail.data?.interventionCount ?? 0}회`} />
        </View>
      ) : null}

      {detail.data ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>목표와 결과</Text>
          <Text style={styles.body}>목표 {formatGoal(detail.data.goalType, detail.data.goalValue)} · 실제 {formatDuration(detail.data.durationSec)} · {detail.data.completed ? '완주' : '중도 종료'}</Text>
          <Text style={styles.body}>거리 {detail.data.distanceM === null ? '측정되지 않음' : `${(detail.data.distanceM / 1000).toFixed(2)} km`} · 페이스 {formatPace(detail.data.avgPaceSecPerKm)}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.body}>오늘의 러닝에서 다음 행동 하나를 찾고 있어요.</Text>
        </View>
      ) : null}

      {error ? (
        <StatePanel
          title="AI 분석을 불러오지 못했어요"
          body="기본 러닝 기록은 안전하게 보존됐어요. 잠시 후 다시 시도해 주세요."
          actionLabel="다시 시도"
          onAction={() => {
            if (params.runId && detail.error) void detail.refetch();
            else if (runId) void create.mutateAsync(runId).then((created) => {
              if (!params.runId) setReport(created);
            });
          }}
        />
      ) : null}

      {report ? <ReportContent report={report} /> : null}
      {!runId && !loading ? (
        localResult?.simulated ? (
          <StatePanel title="시연 러닝이에요" body="화면과 판정은 실제 경로로 동작했고, 시연 결과는 서버에 올리지 않았어요." />
        ) : (
          <StatePanel
            title="기본 기록을 먼저 보여드려요"
            body="서버 저장이 끝나면 안정 구간과 다음 행동을 확인할 수 있어요."
            actionLabel="저장 화면으로"
            onAction={() => router.back()}
          />
        )
      ) : null}
    </Screen>
  );
}

function ReportContent({ report }: { report: RunReport }) {
  const center = (report.nextTargetMin + report.nextTargetMax) / 2;
  return (
    <>
      {report.limitation ? <View style={styles.limitation}><Text style={styles.body}>{report.limitation}</Text></View> : null}
      <Section title="근거">
        {report.evidence.map((item) => <Text key={item} style={styles.evidence}>• {item}</Text>)}
      </Section>
      <View style={styles.metrics}>
        <Metric label="안정 구간" value={report.metrics.rhythmScore === null ? '—' : `${Math.round(report.metrics.rhythmScore * 100)}%`} />
        <Metric label="오늘의 부담" value={fatigueLabel(report.metrics.fatigueIndex)} />
        <Metric label="다음 리듬" value={`${center}`} unit="spm" />
      </View>
      {report.hypothesis ? <Section title="가능한 원인"><Text style={styles.body}>{report.hypothesis}</Text></Section> : null}
      {report.prescription ? <Section title="다음 러닝에서 한 가지"><Text style={styles.body}>{report.prescription}</Text></Section> : null}
      <Section title="다음 목표"><Text style={styles.body}>{report.nextGoalText}</Text></Section>
      {report.recoveryNote ? <Section title="회복 안내"><Text style={styles.body}>{report.recoveryNote}</Text></Section> : null}
      {report.isFallback ? <Text style={styles.caption}>기본 분석으로 안내했어요.</Text> : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text>{unit ? <Text style={styles.caption}>{unit}</Text> : null}<Text style={styles.caption}>{label}</Text></View>;
}

function fatigueLabel(value: number | null) {
  if (value === null) return '—';
  if (value < 0.35) return '여유로움';
  if (value >= 0.6) return '부담됨';
  return '보통';
}

function formatGoal(type: 'TIME' | 'DISTANCE' | null, value: number | null) {
  if (type === null || value === null) return '없음';
  return type === 'TIME' ? formatDuration(value) : `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} km`;
}

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`;
}

function formatPace(value: number | null) {
  if (value === null) return '측정되지 않음';
  return `${Math.floor(value / 60)}′${String(Math.round(value % 60)).padStart(2, '0')}″/km`;
}

function formatCadence(value: number | null) {
  return value === null ? '—' : String(value);
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  eyebrow: { ...typography.bodyStrong, color: colors.primary },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.text },
  caption: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 96, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  metricValue: { ...typography.heading, color: colors.text, textAlign: 'center' },
  section: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionTitle: { ...typography.bodyStrong, color: colors.primary },
  evidence: { ...typography.body, color: colors.text },
  limitation: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
});
