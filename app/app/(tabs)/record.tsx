import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCalendar, useCreateManualRun, useCreatePlan, useStats } from '@/src/api/queries';
import type { CalendarDay } from '@/src/api/client';
import { useAuth } from '@/src/components/auth-provider';
import { PrimaryButton } from '@/src/components/primary-button';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, radius, spacing, typography } from '@/src/theme/tokens';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

export default function RecordScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const calendar = useCalendar(token, year, month);
  const stats = useStats(token);
  const createPlan = useCreatePlan(token);
  const createManual = useCreateManualRun(token);
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [form, setForm] = useState<'plan' | 'manual' | null>(null);
  const [minutes, setMinutes] = useState('20');
  const [distance, setDistance] = useState('');
  const [memo, setMemo] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const daysByDate = useMemo(() => new Map(calendar.data?.map((day) => [day.date, day]) ?? []), [calendar.data]);
  const selected = daysByDate.get(selectedDate);
  const cells = buildMonth(year, month);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>기록</Text>
        <View style={styles.headerActions}>
          <Text style={styles.month}>{year}년 {month}월</Text>
          <Pressable accessibilityLabel="설정" accessibilityRole="button" onPress={() => router.push('/settings')} style={styles.settingsButton}>
            <Ionicons color={colors.text} name="settings-outline" size={22} />
          </Pressable>
        </View>
      </View>

      {calendar.isLoading ? <StatePanel loading title="캘린더를 불러오고 있어요" body="완료한 날과 계획을 정리하는 중이에요." /> : null}
      {calendar.error ? <StatePanel title="캘린더를 불러오지 못했어요" body="기록은 보존되어 있어요. 잠시 후 다시 시도해 주세요." actionLabel="다시 시도" onAction={() => void calendar.refetch()} /> : null}

      {calendar.data ? (
        <View style={styles.calendar}>
          <View style={styles.weekRow}>{weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
          <View style={styles.grid}>
            {cells.map((day, index) => day === null ? <View key={`empty-${index}`} style={styles.dayCell} /> : (
              <DayCell
                key={day}
                day={day}
                data={daysByDate.get(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)}
                selected={selectedDate.endsWith(`-${String(day).padStart(2, '0')}`)}
                onPress={() => setSelectedDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)}
              />
            ))}
          </View>
          <View style={styles.legend}>
            <Text style={styles.legendText}>● 완료</Text><Text style={styles.legendText}>○ 수기</Text><Text style={styles.legendText}>◇ 계획</Text>
          </View>
        </View>
      ) : null}

      {savedMessage ? <Text style={styles.saved}>{savedMessage}</Text> : null}
      <DayDetail date={selectedDate} day={selected} onAddManual={() => setForm('manual')} onAddPlan={() => setForm('plan')} />

      <View style={styles.statsCard}>
        <Text style={styles.sectionTitle}>나의 러닝 루틴</Text>
        <View style={styles.statRow}>
          <Stat label="누적 활동일" value={`${stats.data?.totalRunDays ?? 0}일`} />
          <Stat label="앱 측정" value={`${stats.data?.dalliDays ?? 0}일`} />
          <Stat label="이번 달" value={`${stats.data?.thisMonthDays ?? 0}일`} />
        </View>
      </View>

      <Modal animationType="slide" onRequestClose={() => setForm(null)} transparent visible={form !== null}>
        <Pressable style={styles.backdrop} onPress={() => setForm(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{form === 'plan' ? '러닝 계획 추가' : '수기 기록 추가'}</Text>
          <Text style={styles.body}>{selectedDate}</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setMinutes}
            placeholder="시간(분)"
            placeholderTextColor={colors.disabled}
            style={styles.input}
            value={minutes}
          />
          {form === 'manual' ? (
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setDistance}
              placeholder="거리(km) · 선택"
              placeholderTextColor={colors.disabled}
              style={styles.input}
              value={distance}
            />
          ) : null}
          <TextInput onChangeText={setMemo} placeholder="메모 · 선택" placeholderTextColor={colors.disabled} style={styles.input} value={memo} />
          {(createPlan.error || createManual.error) ? <Text style={styles.error}>저장하지 못했어요. 입력 내용은 그대로 유지되어 있어요.</Text> : null}
          <PrimaryButton
            disabled={!Number.isFinite(Number(minutes)) || Number(minutes) <= 0}
            loading={createPlan.isPending || createManual.isPending}
            onPress={async () => {
              try {
                if (form === 'plan') {
                  await createPlan.mutateAsync({ plannedDate: selectedDate, goalType: 'TIME', goalValue: Number(minutes) * 60, memo });
                  setSavedMessage(`${Number(selectedDate.slice(-2))}일 계획을 추가했어요.`);
                } else {
                  await createManual.mutateAsync({
                    clientRunId: makeClientRunId(),
                    startedAt: `${selectedDate}T09:00:00Z`,
                    durationSec: Number(minutes) * 60,
                    distanceM: distance ? Number(distance) * 1000 : undefined,
                    memo,
                  });
                  setSavedMessage(`${Number(selectedDate.slice(-2))}일 수기 기록을 추가했어요.`);
                }
                setForm(null);
                setMinutes('20');
                setDistance('');
                setMemo('');
              } catch {
                // Mutation state renders a recoverable error and preserves every field.
              }
            }}>
            저장
          </PrimaryButton>
          <PrimaryButton variant="text" onPress={() => setForm(null)}>취소</PrimaryButton>
        </View>
      </Modal>
    </Screen>
  );
}

function DayCell({ day, data, selected, onPress }: { day: number; data?: CalendarDay; selected: boolean; onPress: () => void }) {
  const manual = data?.runs.some((run) => run.source === 'MANUAL');
  const completed = data?.runs.some((run) => run.source === 'APP' && run.completed);
  const planned = data?.plan?.status === 'PLANNED';
  return (
    <Pressable onPress={onPress} style={[styles.dayCell, selected && styles.selectedDay]}>
      <Text style={[styles.dayNumber, selected && styles.selectedDayText]}>{day}</Text>
      <Text style={styles.marker}>{completed ? '●' : manual ? '○' : planned ? '◇' : ' '}</Text>
    </Pressable>
  );
}

function DayDetail({ date, day, onAddPlan, onAddManual }: { date: string; day?: CalendarDay; onAddPlan: () => void; onAddManual: () => void }) {
  const labels: string[] = [];
  if (day?.plan) labels.push(day.plan.status === 'PLANNED' ? '계획' : day.plan.status === 'DONE' ? '완료한 계획' : '미완료 계획');
  if (day?.runs.some((run) => run.source === 'APP')) labels.push('앱 측정 완료');
  if (day?.runs.some((run) => run.source === 'MANUAL')) labels.push('수기 기록');
  return (
    <View style={styles.detailCard}>
      <Text style={styles.sectionTitle}>{Number(date.slice(-2))}일</Text>
      {labels.length ? labels.map((label) => <Text key={label} style={styles.detailLabel}>{label}</Text>) : <Text style={styles.body}>아직 일정이나 기록이 없어요. 홈에서 다음 러닝을 시작해 보세요.</Text>}
      <View style={styles.actionRow}>
        <View style={styles.flex}><PrimaryButton variant="secondary" onPress={onAddPlan}>계획 추가</PrimaryButton></View>
        <View style={styles.flex}><PrimaryButton variant="secondary" onPress={onAddManual}>수기 기록</PrimaryButton></View>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.legendText}>{label}</Text></View>;
}

function buildMonth(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const count = new Date(year, month, 0).getDate();
  return [...Array<null>(firstDay).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeClientRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  title: { ...typography.title, color: colors.text },
  month: { ...typography.bodyStrong, color: colors.text },
  calendar: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  weekRow: { flexDirection: 'row' },
  weekday: { ...typography.caption, color: colors.textMuted, width: '14.285%', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.285%', minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  selectedDay: { backgroundColor: colors.primary },
  dayNumber: { ...typography.bodyStrong, color: colors.text },
  selectedDayText: { color: colors.white },
  marker: { ...typography.caption, color: colors.primary, height: 18 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  legendText: { ...typography.caption, color: colors.textMuted },
  detailCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionTitle: { ...typography.heading, color: colors.text },
  detailLabel: { ...typography.bodyStrong, color: colors.primary },
  body: { ...typography.body, color: colors.textMuted },
  flex: { flex: 1 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  saved: { ...typography.bodyStrong, color: colors.primary, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  statsCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { ...typography.heading, color: colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.background },
  sheetTitle: { ...typography.title, color: colors.text },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, ...typography.body },
  error: { ...typography.caption, color: colors.danger },
});
