import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, Pressable, type StyleProp, StyleSheet, Text, TextInput, type ViewStyle, View } from 'react-native';

import type { CalendarDay } from '@/src/api/client';
import { useCalendar, useCreateManualRun, useCreatePlan, useStats, useUpdatePlan } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaScreen } from '@/src/components/figma-ui';
import { getProfilePhotoUri } from '@/src/components/profile-photo';
import { colors } from '@/src/theme/tokens';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function RecordScreen() {
  const { token } = useAuth();
  const today = new Date();
  const [viewDate, setViewDate] = useState(today);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const calendar = useCalendar(token, year, month);
  const stats = useStats(token);
  const createPlan = useCreatePlan(token);
  const updatePlan = useUpdatePlan(token);
  const createManual = useCreateManualRun(token);
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [form, setForm] = useState<'plan' | 'manual' | null>(null);
  const [minutes, setMinutes] = useState('60');
  const [distance, setDistance] = useState('');
  const [memo, setMemo] = useState('');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const modalProgress = useRef(new Animated.Value(0)).current;
  const daysByDate = useMemo(() => new Map(calendar.data?.map((day) => [day.date, day]) ?? []), [calendar.data]);
  const selected = daysByDate.get(selectedDate);

  useFocusEffect(useCallback(() => {
    let active = true;
    void getProfilePhotoUri().then((uri) => {
      if (active) setProfilePhotoUri(uri);
    });
    return () => { active = false; };
  }, []));

  useEffect(() => {
    if (!form) return;
    modalProgress.setValue(0);
    Animated.spring(modalProgress, {
      damping: 18,
      mass: 0.7,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [form, modalProgress]);

  const save = async () => {
    if (form === 'plan') await createPlan.mutateAsync({ plannedDate: selectedDate, goalType: 'TIME', goalValue: Number(minutes) * 60, memo });
    else await createManual.mutateAsync({ clientRunId: makeClientRunId(), startedAt: `${selectedDate}T09:00:00Z`, durationSec: Number(minutes) * 60, distanceM: distance ? Number(distance) * 1000 : undefined, memo });
    setForm(null); setMinutes('60'); setDistance(''); setMemo('');
  };

  return <FigmaScreen>
    <Text style={styles.heading}>누적 <Text style={styles.orange}>달리 데이</Text> {stats.data?.totalRunDays ?? 3}일</Text>
    <View style={styles.profileCard}>
      <View style={styles.avatar}>{profilePhotoUri
        ? <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage}/>
        : <Ionicons color="#1C1A1A" name="person" size={27}/>}</View>
      <View><Text style={styles.runner}>홍길동 러너님</Text><Text style={styles.profileCopy}>달리와 꾸준한 러닝을 이어가고 있어요</Text></View>
      <View style={styles.profileActions}>
        <SpringPressable onPress={() => setForm('manual')} style={styles.profileButton}><Text style={styles.profileButtonText}>+ 기록</Text></SpringPressable>
        <SpringPressable onPress={() => setForm('plan')} style={styles.profileButton}><Text style={styles.profileButtonText}>+ 계획</Text></SpringPressable>
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
          {(manualRun || planned) && <View style={[styles.dot, planned && styles.planDot]}/>}
          {holiday ? <View style={styles.holidayDot}/> : null}
        </Pressable>;
      })}</View>
      <View style={styles.legend}><Legend color={colors.primary} label="완료"/><Legend color="#1C1A1A" label="직접 기록" outline/><Legend color="#9B9B9B" label="계획"/><Legend color="#D94B4B" label="공휴일"/></View>
    </View>

    <View style={styles.detailCard}>
      <View><Text style={styles.detailDate}>{Number(selectedDate.slice(-2))}일 러닝</Text><Text style={styles.detailCopy}>{describeDay(selected)}</Text></View>
      <SpringPressable onPress={() => setForm(selected?.plan ? 'manual' : 'plan')} style={styles.addButton}><Ionicons color={colors.white} name="add" size={22}/></SpringPressable>
      {selected?.plan?.status === 'PLANNED' && <SpringPressable onPress={() => void updatePlan.mutateAsync({ planId: selected.plan!.id, status: 'DONE' })} style={styles.doneButton}><Text style={styles.doneText}>완료 처리</Text></SpringPressable>}
    </View>

    <Modal animationType="fade" transparent visible={form !== null} onRequestClose={() => setForm(null)}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setForm(null)}/><Animated.View style={[styles.modalCard,{opacity:modalProgress,transform:[{translateY:modalProgress.interpolate({inputRange:[0,1],outputRange:[34,0]})},{scale:modalProgress.interpolate({inputRange:[0,1],outputRange:[.97,1]})}]}]}>
        <View style={styles.modalTabs}>
          <Pressable onPress={() => setForm('plan')} style={({ pressed }) => [styles.modalTab, form === 'plan' && styles.activeTab, pressed && styles.buttonPressed]}><Text style={[styles.tabText, form === 'plan' && styles.activeTabText]}>계획 추가</Text></Pressable>
          <Pressable onPress={() => setForm('manual')} style={({ pressed }) => [styles.modalTab, form === 'manual' && styles.activeTab, pressed && styles.buttonPressed]}><Text style={[styles.tabText, form === 'manual' && styles.activeTabText]}>기록 추가</Text></Pressable>
        </View>
        <Text style={styles.modalTitle}>{month}월 {Number(selectedDate.slice(-2))}일 {form === 'plan' ? '러닝 계획' : '러닝 기록'}</Text>
        <Text style={styles.inputLabel}>달린 시간</Text><View style={styles.inputRow}><TextInput keyboardType="number-pad" value={minutes} onChangeText={setMinutes} style={styles.input}/><Text style={styles.unit}>분</Text></View>
        {form === 'manual' && <><Text style={styles.inputLabel}>달린 거리</Text><View style={styles.inputRow}><TextInput keyboardType="decimal-pad" value={distance} onChangeText={setDistance} placeholder="0" style={styles.input}/><Text style={styles.unit}>km</Text></View></>}
        <Text style={styles.inputLabel}>메모</Text><TextInput value={memo} onChangeText={setMemo} placeholder="오늘의 러닝을 기록해 보세요" style={styles.memo}/>
        {(createPlan.error || createManual.error) && <Text style={styles.error}>서버에 저장하지 못했어요. 다시 시도해 주세요.</Text>}
        <Pressable disabled={Number(minutes) <= 0} onPress={() => void save()} style={({ pressed }) => [styles.save, pressed && styles.buttonPressed]}><Text style={styles.saveText}>저장</Text></Pressable>
      </Animated.View></View>
    </Modal>
  </FigmaScreen>;
}

function Legend({ color, label, outline = false }: { color: string; label: string; outline?: boolean }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: outline ? 'transparent' : color, borderColor: color }]}/><Text style={styles.legendText}>{label}</Text></View>; }
function SpringPressable({ children, onPress, style }: { children: ReactNode; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const springTo = (toValue: number) => Animated.spring(scale, { damping: 14, mass: 0.45, stiffness: 360, toValue, useNativeDriver: true }).start();
  return <AnimatedPressable
    accessibilityRole="button"
    onPress={onPress}
    onPressIn={() => springTo(.9)}
    onPressOut={() => springTo(1)}
    style={[style, { transform: [{ scale }] }]}
  >{children}</AnimatedPressable>;
}
function describeDay(day?: CalendarDay) { if (day?.runs.length) return `${day.runs[0].durationSec ? Math.round(day.runs[0].durationSec / 60) : 0}분 달리기 완료`; if (day?.plan) return `${Math.round(day.plan.goalValue / 60)}분 달리기 계획`; return '아직 등록된 러닝이 없어요'; }
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
function makeClientRunId() { return globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

const styles = StyleSheet.create({
  heading: { position: 'absolute', top: 28, left: 27, color: colors.white, fontSize: 22, fontWeight: '800' }, orange: { color: colors.primary },
  profileCard: { position: 'absolute', top: 70, left: 24, right: 24, height: 111, borderRadius: 24, backgroundColor: colors.primary, padding: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, avatarImage: { width: 48, height: 48, borderRadius: 24 }, runner: { color: colors.white, fontSize: 17, fontWeight: '800', marginTop: 2 }, profileCopy: { color: 'rgba(255,255,255,.85)', fontSize: 12, marginTop: 5 }, profileActions: { position: 'absolute', right: 16, bottom: 11, flexDirection: 'row', gap: 7 }, profileButton: { width: 68, height: 32, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }, profileButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  calendarCard: { position: 'absolute', top: 194, left: 24, right: 24, height: 373, borderRadius: 25, backgroundColor: colors.white, paddingHorizontal: 17, paddingTop: 16 }, monthRow: { height: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 21 }, monthButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, month: { color: '#1C1A1A', fontSize: 17, fontWeight: '800' }, weekRow: { flexDirection: 'row', marginTop: 4 }, weekday: { width: '14.285%', textAlign: 'center', color: '#686868', fontSize: 12, fontWeight: '700' }, grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }, dayCell: { width: '14.285%', height: 44, alignItems: 'center', justifyContent: 'center' }, dayPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] }, dayCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, selectedCircle: { backgroundColor: '#1C1A1A' }, completedCircle: { backgroundColor: colors.primary }, holidayCircle: { borderWidth: 1.5, borderColor: '#D94B4B' }, dayText: { color: '#1C1A1A', fontSize: 13, fontWeight: '700' }, holidayText: { color: '#D94B4B' }, white: { color: colors.white }, dot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: '#1C1A1A' }, holidayDot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: '#D94B4B' }, planDot: { backgroundColor: '#9B9B9B' }, legend: { position: 'absolute', left: 45, right: 45, bottom: 12, flexDirection: 'row', justifyContent: 'space-between' }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1 }, legendText: { color: '#686868', fontSize: 11 },
  detailCard: { position: 'absolute', top: 581, left: 24, right: 24, height: 91, borderRadius: 22, backgroundColor: colors.white, padding: 18 }, detailDate: { color: '#1C1A1A', fontSize: 15, fontWeight: '800' }, detailCopy: { color: '#686868', fontSize: 13, marginTop: 7 }, addButton: { position: 'absolute', right: 17, top: 25, width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, doneButton: { position: 'absolute', right: 68, top: 32 }, doneText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.62)', alignItems: 'center', justifyContent: 'center' }, modalCard: { width: 346, minHeight: 465, borderRadius: 28, backgroundColor: colors.white, padding: 24 }, modalTabs: { flexDirection: 'row', height: 44, backgroundColor: '#F2F2F2', borderRadius: 13, padding: 3 }, modalTab: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, activeTab: { backgroundColor: colors.primary }, tabText: { color: '#777777', fontSize: 14, fontWeight: '800' }, activeTabText: { color: colors.white }, modalTitle: { color: '#1C1A1A', fontSize: 20, fontWeight: '800', marginTop: 24, marginBottom: 20 }, inputLabel: { color: '#1C1A1A', fontSize: 13, fontWeight: '700', marginBottom: 7, marginTop: 8 }, inputRow: { height: 44, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 12, flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, color: '#1C1A1A', paddingHorizontal: 13, fontSize: 15, fontWeight: '700' }, unit: { color: '#686868', marginRight: 14, fontSize: 13 }, memo: { height: 44, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 12, paddingHorizontal: 13, color: '#1C1A1A', fontSize: 15 }, error: { color: '#D64545', fontSize: 12, marginTop: 5 }, save: { height: 50, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24 }, saveText: { color: colors.white, fontSize: 17, fontWeight: '800' }, buttonPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
