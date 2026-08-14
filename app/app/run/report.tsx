import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useCreateReport, useRunReport } from '@/src/api/queries';
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
  const runId = params.runId ?? result?.uploaded?.id ?? null;
  const existing = useRunReport(token, params.runId ?? null);
  const create = useCreateReport(token);
  const requested = useRef(false);

  useEffect(() => {
    if (params.runId || !runId || result?.report || requested.current) return;
    requested.current = true;
    create.mutateAsync(runId).then(setReport).catch(() => undefined);
  }, [create, params.runId, result?.report, runId, setReport]);

  const report = params.runId ? existing.data : result?.report ?? create.data;
  const loading = params.runId ? existing.isLoading : Boolean(runId && create.isPending);
  const error = params.runId ? existing.error : create.error;

  if (!result && !params.runId) {
    return <Screen><StatePanel title="표시할 리포트가 없어요" body="러닝을 마치면 기본 기록과 다음 행동을 볼 수 있어요." actionLabel="홈으로" onAction={() => router.replace('/')} /></Screen>;
  }

  return (
    <Screen footer={<PrimaryButton onPress={() => router.replace('/analysis')}>분석에서 다시 보기</PrimaryButton>}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>러닝 리포트</Text>
        <Text style={styles.title}>{report?.verdict ?? '오늘의 러닝을 마쳤어요'}</Text>
      </View>

      {result ? (
        <View style={styles.metrics}>
          <Metric label="시간" value={`${Math.floor(result.record.durationSec / 60)}분`} />
          <Metric label="평균 리듬" value={result.record.avgCadence === null ? '—' : `${result.record.avgCadence}`} unit="spm" />
          <Metric label="개입" value={`${result.record.interventionCount}회`} />
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
            if (params.runId) void existing.refetch();
            else if (runId) void create.mutateAsync(runId).then(setReport);
          }}
        />
      ) : null}

      {report ? <ReportContent report={report} /> : null}
      {!runId && !loading ? (
        <StatePanel title="시연 러닝이에요" body="화면과 판정은 실제 경로로 동작했고, 시연 결과는 서버에 올리지 않았어요." />
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
