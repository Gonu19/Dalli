import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';

import { isOfflineError } from '@/src/api/client';
import { useCalendar, useCreatePlan, useProfile, useRunReport, useRuns, useUpdatePlan } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { useRunResult } from '@/src/components/run-result-provider';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import {
  defaultPlanTitle,
  suggestDistanceM,
  suggestPlanDate,
} from '@/src/store/routine-suggestion';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

export default function AIReport() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId?: string }>();
  const { token } = useAuth();
  const { result } = useRunResult();
  const fetched = useRunReport(token, params.runId || null);
  const report = result?.report ?? fetched.data;
  const evidence = Array.isArray(report?.evidence)
    ? report.evidence.filter((item): item is string => typeof item === 'string')
    : [];
  const scrollY = useRef(new Animated.Value(0)).current;

  // 다음 루틴 제안 — 리포트가 말한 목표를 날짜가 붙은 계획으로 옮긴다.
  const profile = useProfile(token);
  const runs = useRuns(token);
  const now = new Date();
  const calendar = useCalendar(token, now.getFullYear(), now.getMonth() + 1);
  const createPlan = useCreatePlan(token);
  const updatePlan = useUpdatePlan(token);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [planDistanceM, setPlanDistanceM] = useState<number | null>(null);
  const [savedDate, setSavedDate] = useState<string | null>(null);
  const [savedOverwrote, setSavedOverwrote] = useState(false);

  /**
   * 날짜별로 이미 잡힌 계획. 하루에 계획은 하나뿐이라(`CONTRACT.md` §/plans) 같은 날에
   * 또 만들면 409다. 날짜를 몰래 비켜가지 않고, 고른 날에 계획이 있으면 덮어쓸지 묻는다.
   */
  const plannedByDate = useMemo(
    () => new Map((calendar.data ?? [])
      .filter((day) => day.plan?.status === 'PLANNED')
      .map((day) => [day.date, day.plan!] as const)),
    [calendar.data],
  );
  const suggestedDistanceM = useMemo(
    () => suggestDistanceM((runs.data ?? []).slice(0, 3).map((run) => run.distanceM)),
    [runs.data],
  );
  const targetCadence = report ? Math.round((report.nextTargetMin + report.nextTargetMax) / 2) : null;
  const heavy = (report?.metrics.fatigueIndex ?? 0) >= 0.6;

  /** 고른 날에 이미 있는 계획. 있으면 새로 만들지 않고 그 계획을 고쳐 쓴다. */
  const existingPlan = planDate === null ? undefined : plannedByDate.get(planDate);
  const saving = createPlan.isPending || updatePlan.isPending;
  const saveError = createPlan.error ?? updatePlan.error;

  const openSheet = () => {
    setPlanDate(suggestPlanDate(new Date(), profile.data?.weeklyGoalCount, report?.metrics.fatigueIndex ?? null));
    setPlanDistanceM(suggestedDistanceM);
    setSheetOpen(true);
  };

  const shiftPlanDate = (days: number) => {
    setPlanDate((current) => {
      if (current === null) return current;
      const next = new Date(current + 'T00:00:00');
      next.setDate(next.getDate() + days);
      const key = dateKey(next);
      return key < dateKey(new Date()) ? current : key;
    });
  };

  const savePlan = async () => {
    if (planDate === null || planDistanceM === null || saving) return;
    const goal = {
      goalType: 'DISTANCE',
      goalValue: planDistanceM,
      title: defaultPlanTitle(planDistanceM),
      targetCadence,
    } as const;
    try {
      if (existingPlan) await updatePlan.mutateAsync({ planId: existingPlan.id, ...goal });
      else await createPlan.mutateAsync({ plannedDate: planDate, ...goal });
      setSavedDate(planDate);
      setSavedOverwrote(existingPlan !== undefined);
      setSheetOpen(false);
    } catch {
      // The mutation error is rendered in the sheet; the entered values stay.
    }
  };

  return <FigmaScreen>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {fetched.isLoading && !report ? <View style={styles.state}><Text style={styles.stateTitle}>리포트를 불러오는 중이에요</Text><Text style={styles.stateCopy}>분석 결과가 준비되면 바로 보여드릴게요.</Text></View> : null}
      {fetched.error && !report ? <View style={styles.state}><Text style={styles.stateTitle}>{isOfflineError(fetched.error) ? '오프라인 상태예요' : '리포트를 불러오지 못했어요'}</Text><Text style={styles.stateCopy}>러닝 기록은 보존되어 있어요. 연결을 확인한 뒤 다시 시도해 주세요.</Text><Pressable onPress={() => void fetched.refetch()} style={({ pressed }) => [styles.retry, pressed && styles.buttonPressed]}><Text style={styles.retryText}>다시 시도</Text></Pressable></View> : null}
      {!fetched.isLoading && !fetched.error && !report ? <View style={styles.state}><Text style={styles.stateTitle}>아직 표시할 리포트가 없어요</Text><Text style={styles.stateCopy}>앱으로 측정한 러닝을 저장하면 서버가 리포트를 만들어요.</Text></View> : null}
      {report ? <>
        <View style={styles.verdict}><Text style={styles.orange}>{report.isFallback ? '기본 분석' : 'AI 한줄평'}</Text><Text style={styles.verdictText}>“{report.verdict}”</Text></View>
        {report.isFallback ? <Text style={styles.fallbackCopy}>외부 분석 대신 계약된 기본 분석 결과를 표시하고 있어요.</Text> : null}
        {report.limitation ? <View style={styles.limitation}><Text style={styles.limitationTitle}>분석 안내</Text><Text style={styles.limitationText}>{report.limitation}</Text></View> : null}
        <View style={styles.fiTitle}><Text style={styles.fiLabel}>피로도 지수 (FI)</Text><Text style={styles.fiValue}>{fatiguePercent(report.metrics.fatigueIndex)}</Text></View>
        {report.metrics.fatigueIndex === null
          ? <Text style={styles.fiCopy}>분석할 데이터가 충분하지 않아 피로도를 표시하지 않아요.</Text>
          : <>
              <View style={styles.fiTrack}><View style={[styles.fiFill, { width: `${Math.round(Math.max(0, Math.min(1, report.metrics.fatigueIndex)) * 100)}%` }]} /></View>
              <Text style={styles.fiCopy}>{fatigueCopy(report.metrics.fatigueIndex)}</Text>
            </>}
        <View style={styles.card}><Text style={styles.cardTitle}>분석 근거</Text>{evidence.length ? evidence.map((item, index)=><Text key={`${item}-${index}`} style={styles.evidence}>• {item}</Text>) : <Text style={styles.cardBody}>표시할 근거가 없어요.</Text>}</View>
        {report.hypothesis ? <Card title="가능한 원인" body={report.hypothesis} /> : null}
        {report.prescription ? <Card orange title="다음 러닝 제안" body={report.prescription} /> : null}
        {report.recoveryNote ? <Card title="회복 안내" body={report.recoveryNote} /> : null}
        <View style={styles.next}><Text style={styles.nextTitle}>다음 목표</Text><Text style={styles.nextValue}>{report.nextGoalText}</Text></View>
      </> : null}
      <View style={styles.actions}>
        {report && savedDate !== null
          ? <Text style={styles.planDone}>{formatDateLabel(savedDate)} 계획에 {savedOverwrote ? '바꿔 넣었어요' : '추가했어요'}.</Text>
          : report && suggestedDistanceM !== null
            ? <Pressable onPress={openSheet} style={({ pressed }) => [styles.suggest, pressed && styles.buttonPressed]}><Text style={styles.suggestText}>이 목표로 다음 러닝 예약하기</Text></Pressable>
            : null}
        <Pressable onPress={() => router.dismissTo('/')} style={({ pressed }) => [styles.home, pressed && styles.buttonPressed]}><Text style={styles.homeText}>홈으로 돌아가기</Text></Pressable>
      </View>
    </Animated.ScrollView>
    <Modal animationType="slide" onRequestClose={() => setSheetOpen(false)} transparent visible={sheetOpen}>
      <Pressable onPress={() => setSheetOpen(false)} style={styles.backdrop} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>다음 러닝 예약</Text>
        <SheetRow label="날짜" value={planDate === null ? '—' : formatDateLabel(planDate)} onMinus={() => shiftPlanDate(-1)} onPlus={() => shiftPlanDate(1)} />
        <SheetRow
          label="목표 거리"
          value={planDistanceM === null ? '—' : `${Number((planDistanceM / 1000).toFixed(2))} km`}
          onMinus={() => setPlanDistanceM((current) => current === null ? current : Math.max(1000, current - 500))}
          onPlus={() => setPlanDistanceM((current) => current === null ? current : current + 500)}
        />
        <View style={styles.sheetRow}><Text style={styles.sheetLabel}>목표 리듬</Text><Text style={styles.sheetValue}>{targetCadence ?? '—'} spm</Text></View>
        {heavy ? <Text style={styles.sheetNote}>오늘 부담이 있어서 하루 더 쉬는 날짜로 잡았어요.</Text> : null}
        {existingPlan ? <Text style={styles.sheetNote}>이날은 이미 {existingPlan.title?.trim() || '다른 계획'}이 있어요. 덮어쓸까요?</Text> : null}
        {saveError ? <Text style={styles.sheetError}>{isOfflineError(saveError) ? '오프라인 상태예요. 연결 후 다시 시도해 주세요.' : '계획을 저장하지 못했어요. 다시 시도해 주세요.'}</Text> : null}
        <Pressable disabled={saving} onPress={() => void savePlan()} style={({ pressed }) => [styles.sheetPrimary, (pressed || saving) && styles.buttonPressed]}><Text style={styles.sheetPrimaryText}>{saving ? '저장 중...' : existingPlan ? '덮어쓰기' : '캘린더에 추가'}</Text></Pressable>
        <Pressable onPress={() => setSheetOpen(false)} style={({ pressed }) => [styles.sheetSecondary, pressed && styles.buttonPressed]}><Text style={styles.sheetSecondaryText}>취소</Text></Pressable>
      </View>
    </Modal>
    <ScrollHeaderScrim scrollY={scrollY} />
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>AI 상세 리포트</Text>
  </FigmaScreen>;
}

/** 피로도는 0~1로 오지만 화면에는 퍼센트로 쓴다. 숫자 하나가 바와 같은 값을 가리켜야 한다. */
function fatiguePercent(value: number | null) {
  if (value === null) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)} %`;
}

/** 구간 경계는 부담 라벨과 같은 값이다 (여유로움 0.35 / 보통 0.6). */
function fatigueCopy(value: number) {
  if (value < 0.35) return '피로 누적이 적고 몸에 무리가 거의 없는 안정적인 상태예요.';
  if (value < 0.6) return '피로가 조금 쌓였지만 무리한 수준은 아니에요.';
  return '피로가 꽤 쌓였어요. 다음 러닝은 여유 있게 가는 편이 좋아요.';
}

function SheetRow({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return <View style={styles.sheetRow}>
    <Text style={styles.sheetLabel}>{label}</Text>
    <View style={styles.sheetControls}>
      <Pressable accessibilityLabel={`${label} 줄이기`} onPress={onMinus} style={({ pressed }) => [styles.sheetStep, pressed && styles.buttonPressed]}><Text style={styles.sheetStepText}>-</Text></Pressable>
      <Text style={styles.sheetValue}>{value}</Text>
      <Pressable accessibilityLabel={`${label} 늘리기`} onPress={onPlus} style={({ pressed }) => [styles.sheetStep, pressed && styles.buttonPressed]}><Text style={styles.sheetStepText}>+</Text></Pressable>
    </View>
  </View>;
}

/** `YYYY-MM-DD` (기기 로컬 기준). 서버의 `planned_date`와 같은 축이다. */
function dateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-DD` -> `9월 21일 (토)`. */
function formatDateLabel(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

function Card({ title, body, orange = false }: { title: string; body: string; orange?: boolean }) {
  return <View style={styles.card}><Text style={[styles.cardTitle, orange && { color: colors.primary }]}>{title}</Text><Text style={styles.cardBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  content: { minHeight: 890, paddingTop: 80 - navigationHeader.contentLift, paddingHorizontal: 25, paddingBottom: 30 },
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', zIndex: 10, color: colors.white, fontSize: 17, fontWeight: '700' },
  verdict: { minHeight: 136, borderRadius: 30, borderWidth: 0.5, borderColor: 'rgba(221,224,225,.3)', backgroundColor: 'rgba(255,255,255,.1)', padding: 21, justifyContent: 'center' },
  orange: { fontSize: 17, fontWeight: '700', color: colors.primary },
  verdictText: { fontSize: 20, fontWeight: '800', color: colors.white, marginTop: 15, lineHeight: 26 },
  state: { minHeight: 180, borderRadius: 28, backgroundColor: colors.white, padding: 24, justifyContent: 'center' },
  stateTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  stateCopy: { color: colors.inkMuted, fontSize: 13, marginTop: 9 },
  fallbackCopy: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12, paddingHorizontal: 7 },
  retry: { height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  retryText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  limitation: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 17, marginTop: 20 },
  limitationTitle: { color: colors.white, fontSize: 14, fontWeight: '700' },
  limitationText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  fiTitle: { marginTop: 29, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 7 },
  fiLabel: { color: colors.white, fontSize: 17, fontWeight: '700' },
  fiValue: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  fiCopy: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12, paddingHorizontal: 7 },
  fiTrack: { height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,.14)', marginTop: 16, marginHorizontal: 7, overflow: 'hidden' },
  fiFill: { height: '100%', borderRadius: 7, backgroundColor: colors.primary },
  card: { minHeight: 116, borderRadius: 28, backgroundColor: colors.white, marginTop: 29, padding: 22 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  cardBody: { fontSize: 15, color: colors.ink, lineHeight: 21, marginTop: 10 },
  evidence: { fontSize: 14, color: colors.ink, lineHeight: 20, marginTop: 8 },
  next: { height: 145, marginTop: 35, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 17 },
  nextTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  nextValue: { color: colors.white, fontSize: 28, fontWeight: '800', marginTop: 6 },
  nextMeta: { color: colors.white, fontSize: 12, marginTop: 7 },
  actions: { marginTop: 35, gap: 12 },
  suggest: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  suggestText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  planDone: { color: colors.primary, fontSize: 14, fontWeight: '700', paddingHorizontal: 7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 34 },
  sheetTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: 18 },
  sheetRow: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  sheetControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetStep: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  sheetStepText: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  sheetValue: { color: colors.ink, fontSize: 16, fontWeight: '800', minWidth: 96, textAlign: 'center' },
  sheetNote: { color: colors.inkMuted, fontSize: 12, marginTop: 6 },
  sheetError: { color: '#D64545', fontSize: 12, marginTop: 8 },
  sheetPrimary: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  sheetPrimaryText: { color: colors.white, fontSize: 17, fontWeight: '800' },
  sheetSecondary: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  sheetSecondaryText: { color: colors.inkMuted, fontSize: 15, fontWeight: '700' },
  home: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: pressFeedback,
  homeText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
