import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { isOfflineError, type CalendarDay } from '@/src/api/client';
import { useCalendar, useCreateManualRun, useCreatePlan, useDeletePlan, useDeleteRun, useProfile, useRunDetail, useStats, useUpdatePlan } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { getProfilePhotoUri } from '@/src/components/profile-photo';
import { Screen } from '@/src/components/screen';
import { StatePanel } from '@/src/components/state-panel';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

export default function RecordScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const today = new Date();
  const [viewDate, setViewDate] = useState(today);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const calendar = useCalendar(token, year, month);
  const stats = useStats(token);
  const profile = useProfile(token);
  const createPlan = useCreatePlan(token);
  const updatePlan = useUpdatePlan(token);
  const deletePlan = useDeletePlan(token);
  const createManual = useCreateManualRun(token);
  const deleteRun = useDeleteRun(token);
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [form, setForm] = useState<'plan' | 'manual' | null>(null);
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [memo, setMemo] = useState('');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const modalProgress = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const isModalOpen = form !== null;
  const daysByDate = useMemo(() => new Map(calendar.data?.map((day) => [day.date, day]) ?? []), [calendar.data]);
  const selected = daysByDate.get(selectedDate);
  const selectedRun = selected?.runs[0] ?? null;
  const runDetail = useRunDetail(token, selectedRun?.id ?? null);
  const isSaving = createPlan.isPending || createManual.isPending;
  const profileLabel = profile.data?.name?.trim() || formatUserLabel(profile.data?.id);

  useFocusEffect(useCallback(() => {
    let active = true;
    void getProfilePhotoUri().then((uri) => {
      if (active) setProfilePhotoUri(uri);
    });
    return () => { active = false; };
  }, []));

  useEffect(() => {
    if (!isModalOpen) {
      modalProgress.setValue(0);
      return;
    }

    modalProgress.setValue(0);
    const animation = Animated.spring(modalProgress, {
      damping: 18,
      mass: 0.7,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [isModalOpen, modalProgress]);

  const save = async () => {
    if (Number(minutes) <= 0 || isSaving) return;
    try {
      if (form === 'plan') await createPlan.mutateAsync({ plannedDate: selectedDate, goalType: 'TIME', goalValue: Number(minutes) * 60, memo });
      else await createManual.mutateAsync({ clientRunId: makeClientRunId(), startedAt: `${selectedDate}T09:00:00Z`, durationSec: Number(minutes) * 60, distanceM: distance ? Number(distance) * 1000 : undefined, memo });
      setForm(null); setMinutes(''); setDistance(''); setMemo('');
    } catch {
      // The mutation error is rendered in the modal; preserve the entered values.
    }
  };

  if (calendar.isPending || stats.isPending) return <Screen includeBottomSafeArea={false}><StatePanel loading title="기록을 불러오는 중이에요" body="캘린더와 누적 활동일을 확인하고 있어요." /></Screen>;
  if (calendar.error || stats.error) return <Screen includeBottomSafeArea={false}><StatePanel title={isOfflineError(calendar.error ?? stats.error) ? '오프라인 상태예요' : '기록을 불러오지 못했어요'} body="저장된 기록은 보존되어 있어요. 연결을 확인한 뒤 다시 시도해 주세요." actionLabel="다시 시도" onAction={() => { void calendar.refetch(); void stats.refetch(); }} /></Screen>;

  return <Screen includeBottomSafeArea={false} padded={false} scroll={false}>
    <View style={styles.frame}>
    <View pointerEvents="none" style={styles.headerSurface} />
    <Text style={styles.header}>누적 <Text style={styles.headerAccent}>달리 데이</Text> {stats.data?.dalliDays ?? '—'}일</Text>
    <Animated.ScrollView
      contentContainerStyle={styles.scrollContent}
      directionalLockEnabled
      nestedScrollEnabled
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
    <View style={styles.screenContent}>
      <View style={styles.profileCard}>
      <View style={styles.avatar}>{profilePhotoUri
        ? <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage}/>
        : <Ionicons color="#1C1A1A" name="person" size={27}/>}</View>
      <View><Text style={styles.runner}>{profileLabel}</Text><Text style={styles.profileCopy}>저장된 러닝과 계획을 확인할 수 있어요</Text></View>
      <View style={styles.profileActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="개인정보 수정"
          onPress={() => router.push('/privacy')}
          style={({ pressed }) => [styles.profileButton, pressed && styles.buttonPressed]}
        >
          <Ionicons color={colors.primary} name="create-outline" size={18} />
        </Pressable>
      </View>
      </View>

      <View style={styles.calendarCard}>
      <View style={styles.monthRow}>
        <Pressable accessibilityLabel="이전 달" onPress={() => setViewDate(new Date(year, month - 2, 1))} style={({ pressed }) => [styles.monthButton, pressed && styles.buttonPressed]}><Ionicons name="chevron-back" size={17}/></Pressable>
        <Text style={styles.month}>{year}년 {month}월</Text>
        <Pressable accessibilityLabel="다음 달" onPress={() => setViewDate(new Date(year, month, 1))} style={({ pressed }) => [styles.monthButton, pressed && styles.buttonPressed]}><Ionicons name="chevron-forward" size={17}/></Pressable>
      </View>
      <View style={styles.weekRow}>{weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.grid}>{buildMonth(year, month).map((day, index) => {
        if (day === null) return <View key={`blank-${index}`} style={styles.dayCell}/>;
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const datum = daysByDate.get(date);
        const appRun = datum?.runs.some((run) => run.source === 'APP');
        const manualRun = datum?.runs.some((run) => run.source === 'MANUAL');
        const planned = datum?.plan?.status === 'PLANNED';
        const isSelected = date === selectedDate;
        const holiday = getHolidayName(year, month, day);
        return <Pressable key={day} onPress={() => setSelectedDate(date)} style={({ pressed }) => [styles.dayCell, pressed && styles.dayPressed]}>
          <View style={[styles.dayCircle, isSelected && styles.selectedCircle, appRun && styles.completedCircle, holiday && styles.holidayCircle]}><Text style={[styles.dayText, holiday && styles.holidayText, (isSelected || appRun) && styles.white]}>{day}</Text></View>
          {manualRun && <View style={[styles.dot, styles.manualDot]}/>}
          {planned && <View style={[styles.dot, styles.planDot]}/>}
          {holiday ? <View style={styles.holidayDot}/> : null}
        </Pressable>;
      })}</View>
      <View style={styles.legend}><Legend color={colors.primary} label="완료"/><Legend color="#FFC2B3" label="직접 기록"/><Legend color={colors.primary} label="예정 계획" outline/></View>
      </View>

      <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <View style={[styles.detailMarker, selectedRun?.source === 'MANUAL' && styles.manualMarker, selected?.plan && !selectedRun && styles.planMarker]}/>
        <Text numberOfLines={1} style={styles.detailDate}>{selectedDate} 계획 및 기록</Text>
        {selectedRun ? <Text style={styles.detailMeta}>{selectedRun.source === 'MANUAL' ? '수기 기록 · 달리 데이 제외' : '앱 기록 · 달리 데이 포함'}</Text> : null}
      </View>

      {selected?.plan ? <View style={styles.planSummary}>
        <Text style={styles.runTitle}>러닝 계획</Text>
        <Text style={styles.runMetrics}>{formatPlanGoal(selected.plan)}</Text>
        <Text style={styles.detailCopy}>{selected.plan.status === 'PLANNED' ? '예정된 러닝이에요' : selected.plan.status === 'DONE' ? '완료된 계획이에요' : '건너뛴 계획이에요'}</Text>
        <View style={styles.planActions}>
          <Pressable
            accessibilityRole="button"
            disabled={deletePlan.isPending}
            onPress={() => Alert.alert('계획을 삭제할까요?', '삭제한 계획은 복구할 수 없어요.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => void deletePlan.mutateAsync(selected.plan!.id) },
            ])}
            style={({ pressed }) => [styles.deleteButton, deletePlan.isPending && styles.buttonDisabled, pressed && !deletePlan.isPending && styles.buttonPressed]}
          >
            <Text style={styles.deleteText}>{deletePlan.isPending ? '삭제 중' : '계획 삭제'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={updatePlan.isPending}
            onPress={() => void updatePlan.mutateAsync({ planId: selected.plan!.id, status: selected.plan!.status === 'DONE' ? 'PLANNED' : 'DONE' })}
            style={({ pressed }) => [styles.doneButton, selected.plan!.status === 'DONE' && styles.undoButton, updatePlan.isPending && styles.buttonDisabled, pressed && !updatePlan.isPending && styles.buttonPressed]}
          ><Text style={[styles.doneText, selected.plan.status === 'DONE' && styles.undoText]}>{updatePlan.isPending ? '처리 중' : selected.plan.status === 'DONE' ? '완료 취소' : '완료 처리'}</Text></Pressable>
        </View>
      </View> : null}
      {selectedRun ? <View style={[styles.runSummary, selected?.plan && styles.runSummaryWithPlan]}>
        <Text numberOfLines={1} style={styles.runTitle}>{runDetail.data?.memo?.trim() || (selectedRun.source === 'MANUAL' ? '직접 기록한 러닝' : '달리와 함께한 러닝')}</Text>
        <Text style={styles.runMetrics}>{formatMinutes(selectedRun.durationSec)} <Text style={styles.metricDivider}>|</Text> {formatDistance(runDetail.data?.distanceM)} <Text style={styles.metricDivider}>|</Text> {formatCadence(runDetail.data?.avgCadence)}</Text>
        <Text numberOfLines={1} style={styles.detailCopy}>{describeRunCondition(runDetail.data?.condition, selectedRun.source)}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={deleteRun.isPending}
          onPress={() => Alert.alert('기록을 삭제할까요?', '삭제한 러닝 기록과 분석은 복구할 수 없어요.', [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => void deleteRun.mutateAsync(selectedRun.id) },
          ])}
          style={({ pressed }) => [styles.deleteButton, styles.runDeleteButton, deleteRun.isPending && styles.buttonDisabled, pressed && !deleteRun.isPending && styles.buttonPressed]}
        >
          <Text style={styles.deleteText}>{deleteRun.isPending ? '삭제 중' : '기록 삭제'}</Text>
        </Pressable>
      </View> : null}
      {!selectedRun && !selected?.plan ? <View style={styles.emptyDetail}>
        <Text style={[styles.detailCopy, styles.emptyDetailCopy]}>아직 등록된 일정이나 기록이 없어요</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setForm('plan')}
          style={({ pressed }) => [styles.detailActionButton, styles.emptyActionButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.detailActionText}>+ 계획/기록</Text>
        </Pressable>
      </View> : null}
      {selectedRun || selected?.plan ? <Pressable
        accessibilityRole="button"
        onPress={() => setForm('plan')}
        style={({ pressed }) => [styles.detailActionButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.detailActionText}>+ 계획/기록</Text>
      </Pressable> : null}
      </View>
    </View>
    </Animated.ScrollView>
    <Modal animationType="fade" transparent visible={isModalOpen} onRequestClose={() => setForm(null)}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setForm(null)}/><Animated.View style={[styles.modalCard,{opacity:modalProgress,transform:[{translateY:modalProgress.interpolate({inputRange:[0,1],outputRange:[34,0]})},{scale:modalProgress.interpolate({inputRange:[0,1],outputRange:[.97,1]})}]}]}>
        <View style={styles.modalTabs}>
          <Pressable onPress={() => setForm('plan')} style={({ pressed }) => [styles.modalTab, form === 'plan' && styles.activeTab, pressed && styles.buttonPressed]}><Text style={[styles.tabText, form === 'plan' && styles.activeTabText]}>계획 추가</Text></Pressable>
          <Pressable onPress={() => setForm('manual')} style={({ pressed }) => [styles.modalTab, form === 'manual' && styles.activeTab, pressed && styles.buttonPressed]}><Text style={[styles.tabText, form === 'manual' && styles.activeTabText]}>기록 추가</Text></Pressable>
        </View>
        <Text style={styles.modalTitle}>{month}월 {Number(selectedDate.slice(-2))}일 {form === 'plan' ? '러닝 계획' : '러닝 기록'}</Text>
        <Text style={styles.inputLabel}>달린 시간</Text><View style={styles.inputRow}><TextInput keyboardType="number-pad" placeholder="시간을 입력해 주세요" value={minutes} onChangeText={setMinutes} style={styles.input}/><Text style={styles.unit}>분</Text></View>
        {form === 'manual' && <><Text style={styles.inputLabel}>달린 거리</Text><View style={styles.inputRow}><TextInput keyboardType="decimal-pad" value={distance} onChangeText={setDistance} placeholder="0" style={styles.input}/><Text style={styles.unit}>km</Text></View></>}
        <Text style={styles.inputLabel}>메모</Text><TextInput value={memo} onChangeText={setMemo} placeholder="오늘의 러닝을 기록해 보세요" style={styles.memo}/>
        {(createPlan.error || createManual.error) && <Text style={styles.error}>{isOfflineError(createPlan.error ?? createManual.error) ? '오프라인 상태예요. 연결 후 다시 시도해 주세요.' : '서버에 저장하지 못했어요. 다시 시도해 주세요.'}</Text>}
        <Pressable disabled={Number(minutes) <= 0 || isSaving} onPress={() => void save()} style={({ pressed }) => [styles.save, (pressed || isSaving) && styles.buttonPressed, (Number(minutes) <= 0 || isSaving) && styles.buttonDisabled]}><Text style={styles.saveText}>{isSaving ? '저장 중...' : '저장'}</Text></Pressable>
      </Animated.View></View>
    </Modal>
    </View>
  </Screen>;
}

function Legend({ color, label, outline = false }: { color: string; label: string; outline?: boolean }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: outline ? 'transparent' : color, borderColor: color }]}/><Text style={styles.legendText}>{label}</Text></View>; }
function formatMinutes(durationSec: number) { return `${Math.round(durationSec / 60)} min`; }
function formatDistance(distanceM: number | null | undefined) { return distanceM == null ? '— km' : `${Number((distanceM / 1000).toFixed(2))} km`; }
function formatCadence(cadence: number | null | undefined) { return cadence == null ? '— spm' : `${Math.round(cadence)} spm`; }
function formatPlanGoal(plan: NonNullable<CalendarDay['plan']>) { return plan.goalType === 'TIME' ? `${Math.round(plan.goalValue / 60)} min` : `${Number((plan.goalValue / 1000).toFixed(2))} km`; }
function describeRunCondition(condition: 1 | 3 | 5 | null | undefined, source: 'APP' | 'MANUAL') {
  if (condition === 1) return '피곤한 컨디션으로 시작한 러닝이에요';
  if (condition === 3) return '보통 컨디션으로 시작한 러닝이에요';
  if (condition === 5) return '가벼운 컨디션으로 시작한 러닝이에요';
  return source === 'MANUAL' ? '앱 밖에서 달린 기록이에요' : '오늘의 러닝을 기록했어요';
}
function getHolidayName(year: number, month: number, day: number) {
  const fixed: Record<string, string> = { '1-1': '신정', '3-1': '삼일절', '5-5': '어린이날', '6-6': '현충일', '8-15': '광복절', '10-3': '개천절', '10-9': '한글날', '12-25': '성탄절' };
  const lunar: Record<number, Record<string, string>> = {
    2025: { '1-28': '설날 연휴', '1-29': '설날', '1-30': '설날 연휴', '5-5': '부처님오신날', '10-5': '추석 연휴', '10-6': '추석', '10-7': '추석 연휴' },
    2026: { '2-16': '설날 연휴', '2-17': '설날', '2-18': '설날 연휴', '5-24': '부처님오신날', '9-24': '추석 연휴', '9-25': '추석', '9-26': '추석 연휴' },
    2027: { '2-6': '설날 연휴', '2-7': '설날', '2-8': '설날 연휴', '5-13': '부처님오신날', '9-14': '추석 연휴', '9-15': '추석', '9-16': '추석 연휴' },
  };
  return lunar[year]?.[`${month}-${day}`] ?? fixed[`${month}-${day}`] ?? null;
}
function buildMonth(year: number, month: number) { const first = new Date(year, month - 1, 1).getDay(); const count = new Date(year, month, 0).getDate(); return [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]; }
function toDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatUserLabel(id: string | undefined) {
  const compactId = id?.replaceAll('-', '').slice(0, 6);
  return `user-${compactId || '000000'}`;
}
function makeClientRunId() { return globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

const styles = StyleSheet.create({
  frame: { flex: 1, position: 'relative' },
    scrollContent: { minHeight: 980 }, screenContent: { position: 'relative', height: 980 },
  header: { position: 'absolute', top: navigationHeader.titleTop, left: 27, zIndex: 10, color: colors.white, fontSize: 25, lineHeight: 32, fontWeight: '800' }, headerAccent: { color: colors.primary },
  headerSurface: { position: 'absolute', top: 0, left: 0, right: 0, height: navigationHeader.height + 8, zIndex: 8, backgroundColor: 'rgba(28,26,26,.76)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.08)' },
  profileCard: { position: 'absolute', top: 84, left: 24, right: 24, height: 88, borderRadius: 22, backgroundColor: colors.primary, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, avatarImage: { width: 42, height: 42, borderRadius: 21 }, runner: { color: colors.white, fontSize: 16, fontWeight: '800' }, profileCopy: { color: 'rgba(255,255,255,.85)', fontSize: 11.5, marginTop: 4 }, profileActions: { position: 'absolute', right: 16, top: 28 }, profileButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  calendarCard: { position: 'absolute', top: 200, left: 24, right: 24, height: 373, borderRadius: 25, backgroundColor: colors.white, paddingHorizontal: 17, paddingTop: 16 }, monthRow: { height: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 21 }, monthButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, month: { color: '#1C1A1A', fontSize: 17, fontWeight: '800' }, weekRow: { flexDirection: 'row', marginTop: 4 }, weekday: { width: '14.285%', textAlign: 'center', color: '#686868', fontSize: 12, fontWeight: '700' }, grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }, dayCell: { width: '14.285%', height: 44, alignItems: 'center', justifyContent: 'center' }, dayPressed: pressFeedback, dayCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, selectedCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary }, completedCircle: { backgroundColor: colors.primary }, holidayCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#D94B4B' }, dayText: { color: '#1C1A1A', fontSize: 13, fontWeight: '700' }, holidayText: { color: '#D94B4B' }, white: { color: colors.white }, dot: { position: 'absolute', bottom: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: '#1C1A1A' }, manualDot: { backgroundColor: '#FFC2B3' }, holidayDot: { position: 'absolute', bottom: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: '#D94B4B' }, planDot: { width: 6, height: 6, bottom: 2, borderRadius: 3, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary, borderStyle: 'solid' }, legend: { position: 'absolute', left: 45, right: 45, bottom: 12, flexDirection: 'row', justifyContent: 'space-between' }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1 }, legendText: { color: '#686868', fontSize: 11 },
  detailCard: { position: 'absolute', top: 601, left: 24, right: 24, borderRadius: 22, backgroundColor: colors.white, paddingHorizontal: 18, paddingVertical: 17 }, detailHeader: { flexDirection: 'row', alignItems: 'center' }, detailMarker: { width: 10, height: 10, borderRadius: 5, marginRight: 8, backgroundColor: colors.primary }, manualMarker: { backgroundColor: '#FFC2B3' }, planMarker: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.primary }, detailDate: { flexShrink: 1, color: '#1C1A1A', fontSize: 16, lineHeight: 21, fontWeight: '800' }, detailMeta: { marginLeft: 'auto', paddingLeft: 8, color: '#858585', fontSize: 10.5, fontWeight: '500' }, planSummary: { position: 'relative', marginTop: 15 }, planActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }, runSummary: { marginTop: 15 }, runSummaryWithPlan: { marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#ECECEC' }, runTitle: { color: '#1C1A1A', fontSize: 14, lineHeight: 19, fontWeight: '600' }, runMetrics: { color: '#1C1A1A', fontSize: 15, fontWeight: '800', marginTop: 6 }, metricDivider: { color: '#686868', fontWeight: '500' }, detailCopy: { color: '#858585', fontSize: 12, lineHeight: 17, marginTop: 5 }, emptyDetailCopy: { flex: 1, marginTop: 0 }, deleteButton: { alignSelf: 'flex-start', minWidth: 72, height: 32, borderRadius: 11, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 0 }, runDeleteButton: { marginTop: 12 }, deleteText: { color: colors.primary, fontSize: 12, fontWeight: '800' }, emptyDetail: { minHeight: 90, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, emptyActionButton: { marginTop: 0 }, detailActionButton: { alignSelf: 'flex-end', minWidth: 104, height: 32, borderRadius: 10, paddingHorizontal: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 15 }, detailActionText: { color: colors.white, fontSize: 13, fontWeight: '800' }, doneButton: { minWidth: 72, height: 32, borderRadius: 11, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, undoButton: { backgroundColor: colors.white }, doneText: { color: colors.white, fontSize: 12, fontWeight: '800' }, undoText: { color: colors.primary }, buttonDisabled: { opacity: 0.55 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.62)', alignItems: 'center', justifyContent: 'center' }, modalCard: { width: 346, minHeight: 465, borderRadius: 28, backgroundColor: colors.white, padding: 24 }, modalTabs: { flexDirection: 'row', height: 44, backgroundColor: '#F2F2F2', borderRadius: 13, padding: 3 }, modalTab: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, activeTab: { backgroundColor: colors.primary }, tabText: { color: '#777777', fontSize: 14, fontWeight: '800' }, activeTabText: { color: colors.white }, modalTitle: { color: '#1C1A1A', fontSize: 20, fontWeight: '800', marginTop: 24, marginBottom: 20 }, inputLabel: { color: '#1C1A1A', fontSize: 13, fontWeight: '700', marginBottom: 7, marginTop: 8 }, inputRow: { height: 44, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 12, flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, color: '#1C1A1A', paddingHorizontal: 13, fontSize: 15, fontWeight: '700' }, unit: { color: '#686868', marginRight: 14, fontSize: 13 }, memo: { height: 44, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 12, paddingHorizontal: 13, color: '#1C1A1A', fontSize: 15 }, error: { color: '#D64545', fontSize: 12, marginTop: 5 }, save: { height: 50, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24 }, saveText: { color: colors.white, fontSize: 17, fontWeight: '800' }, buttonPressed: pressFeedback,
});
