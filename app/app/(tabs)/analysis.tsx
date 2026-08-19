import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Pressable as NativePressable, StyleSheet, Text, View } from 'react-native';

import { isOfflineError, type RunListItem } from '@/src/api/client';
import { useDeleteRun, useRuns } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaLogo } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { Screen } from '@/src/components/screen';
import { colors, compactPressFeedback, navigationHeader, pressFeedback } from '@/src/theme/tokens';

export default function Analysis({ active = true, onCardTouchChange }: { active?: boolean; onCardTouchChange?: (active: boolean) => void }) {
  const router = useRouter();
  const { token } = useAuth();
  const runs = useRuns(token);
  const remove = useDeleteRun(token);
  const [cardTouchActive, setCardTouchActive] = useState(false);
  const [dismissSignal, setDismissSignal] = useState(0);
  const appRuns = runs.data?.filter((run) => run.source === 'APP') ?? [];

  const confirm = (run: RunListItem, onCancel?: () => void) => Alert.alert(
    '이 러닝을 삭제할까요?',
    '캘린더와 누적 활동일에서도 함께 사라져요.',
    [
      { text: '취소', style: 'cancel', onPress: onCancel },
      { text: '삭제', style: 'destructive', onPress: () => void remove.mutateAsync(run.id) },
    ],
  );

  const openDetail = (run: RunListItem) => {
    if (run.source !== 'APP') {
      Alert.alert('상세 분석을 지원하지 않는 기록이에요', '직접 추가한 기록은 러닝 시간만 확인할 수 있어요.');
      return;
    }
    router.push({ pathname: '/run/report', params: { runId: run.id } });
  };
  const handleCardTouchChange = (activeTouch: boolean) => {
    setCardTouchActive(activeTouch);
    onCardTouchChange?.(activeTouch);
  };

  return <Screen includeBottomSafeArea={false} padded={false} scroll={false}>
    <View style={styles.frame}>
      <View pointerEvents="none" style={styles.headerSurface} />
      <FigmaLogo left={24} />
      <Pressable onPress={() => router.push('/settings')} style={({ pressed }) => [styles.settings, pressed && styles.iconPressed]}>
        <Ionicons color={colors.white} name="settings-outline" size={26} />
      </Pressable>
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={!cardTouchActive}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.section}>나의 총 러닝 분석</Text>
        {runs.isLoading
          ? <View style={styles.emptySummary}><Text style={styles.emptyText}>러닝 기록을 불러오는 중이에요</Text></View>
          : runs.error
            ? <Pressable onPress={() => void runs.refetch()} style={({ pressed }) => [styles.emptySummary, pressed && styles.buttonPressed]}><Text style={styles.emptyText}>{isOfflineError(runs.error) ? '오프라인 상태예요 · 다시 시도' : '기록을 불러오지 못했어요 · 다시 시도'}</Text></Pressable>
          : runs.data?.length === 0
          ? <View style={styles.emptySummary}><Text style={styles.emptyText}>아직 러닝 기록이 없어요</Text></View>
          : <View style={styles.summary}>
              <Summary value={String(appRuns.filter((run) => run.completed).length)} label="앱 완주 횟수" accent />
              <Summary value={String(appRuns.length)} label="앱 측정 러닝" />
              <Summary value={String(runs.data?.filter((run) => run.source === 'MANUAL').length ?? 0)} label="수기 기록" />
            </View>}
        <Text style={[styles.section, { marginTop: 28 }]}>러닝 분석</Text>
        {runs.data?.length === 0
          ? <View style={styles.empty}>
              <FigmaLogo centered top={83} />
              <Text style={styles.emptyLine}>첫 러닝을 완료하면 분석이 생겨요!</Text>
              <Text style={styles.emptyLine2}>달리와 함께 달려볼까요?</Text>
              <Pressable onPress={() => router.push('/')} style={({ pressed }) => [styles.prepare, pressed && styles.buttonPressed]}>
                <Text style={styles.prepareText}>러닝 준비하기</Text>
              </Pressable>
            </View>
          : runs.data?.map((run) => <SwipeableRunCard key={run.id} active={active} dismissSignal={dismissSignal} onConfirmDelete={() => confirm(run)} onDelete={(onCancel) => confirm(run, onCancel)} onOpen={() => openDetail(run)} onCardTouchChange={handleCardTouchChange} run={run} />)}
        <NativePressable accessibilityLabel="열린 기록 카드 닫기" onPress={() => { setDismissSignal((value) => value + 1); handleCardTouchChange(false); }} style={styles.dismissArea} />
      </Animated.ScrollView>
    </View>
  </Screen>;
}

function Summary({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <View style={styles.summaryItem}>
    <Text style={[styles.summaryValue, accent && { color: colors.primary }]}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>;
}

function SwipeableRunCard({ active, dismissSignal, run, onConfirmDelete, onDelete, onOpen, onCardTouchChange }: { active: boolean; dismissSignal: number; run: RunListItem; onConfirmDelete: () => void; onDelete: (onCancel?: () => void) => void; onOpen: () => void; onCardTouchChange?: (active: boolean) => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const deleteRef = useRef(onDelete);
  const [, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const gestureStartOffset = useRef(0);
  const longSwipeTriggered = useRef(false);
  const cardTouchChangeRef = useRef(onCardTouchChange);
  deleteRef.current = onDelete;
  cardTouchChangeRef.current = onCardTouchChange;
  useEffect(() => {
    if (!active) {
      revealedRef.current = false;
      setRevealed(false);
      opacity.setValue(1);
      Animated.spring(translateX, { damping: 22, mass: 0.7, stiffness: 180, toValue: 0, useNativeDriver: true }).start();
    }
  }, [active, opacity, translateX]);
  useEffect(() => {
    if (dismissSignal > 0) {
      updateRevealed(false);
      cardTouchChangeRef.current?.(false);
      opacity.setValue(1);
      Animated.spring(translateX, { damping: 20, mass: 0.55, stiffness: 300, toValue: 0, useNativeDriver: true }).start();
    }
  }, [dismissSignal, opacity, translateX]);
  const updateRevealed = (value: boolean) => {
    revealedRef.current = value;
    setRevealed(value);
  };
  const animateTo = (toValue: number) => Animated.spring(translateX, {
    damping: 22,
    mass: 0.7,
    stiffness: 180,
    toValue,
    useNativeDriver: true,
  }).start();
  const restoreCard = () => {
    opacity.setValue(1);
    Animated.spring(translateX, { damping: 20, mass: 0.55, stiffness: 300, toValue: 0, useNativeDriver: true }).start();
  };
  const animateDelete = () => {
    onCardTouchChange?.(false);
    updateRevealed(false);
    Animated.parallel([
      Animated.timing(translateX, { duration: 240, toValue: -420, useNativeDriver: true }),
      Animated.timing(opacity, { duration: 240, toValue: 0, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) deleteRef.current(restoreCard);
    });
  };
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const isDeleteSwipe = gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
      const isCloseSwipe = revealedRef.current && gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
      if (isDeleteSwipe || isCloseSwipe) onCardTouchChange?.(true);
      return isDeleteSwipe || isCloseSwipe;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      gestureStartOffset.current = revealedRef.current ? -100 : 0;
      longSwipeTriggered.current = false;
    },
    onPanResponderMove: (_, gesture) => {
      const totalX = gestureStartOffset.current + gesture.dx;
      if (totalX < -150 && !longSwipeTriggered.current) {
        longSwipeTriggered.current = true;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      translateX.setValue(Math.max(-300, Math.min(0, totalX)));
    },
    onPanResponderRelease: (_, gesture) => {
      const totalX = gestureStartOffset.current + gesture.dx;
      const shouldConfirmDelete = totalX < -150;
      const shouldRevealDelete = totalX < -80;
      if (shouldConfirmDelete) {
        animateDelete();
      } else if (shouldRevealDelete) {
        updateRevealed(true);
        animateTo(-100);
      } else {
        updateRevealed(false);
        animateTo(0);
      }
    },
    onPanResponderTerminate: () => {
      onCardTouchChange?.(false);
      restoreCard();
    },
  })).current;

  return <View
    {...panResponder.panHandlers}
    onTouchCancel={() => onCardTouchChange?.(false)}
    onTouchEnd={() => onCardTouchChange?.(false)}
    onTouchStart={() => { if (revealedRef.current) onCardTouchChange?.(true); }}
    style={styles.swipeArea}
  >
    <Pressable accessibilityLabel="러닝 기록 삭제" onPress={() => { onCardTouchChange?.(false); updateRevealed(false); animateTo(0); onConfirmDelete(); }} style={({ pressed }) => [styles.deleteReveal, pressed && styles.deleteRevealPressed]}>
      <Ionicons color={colors.white} name="trash-outline" size={22} /><Text style={styles.deleteRevealText}>삭제</Text>
    </Pressable>
    <Animated.View style={[styles.card, { opacity, transform: [{ translateX }] }]}>
      <Text style={styles.date}>{run.startedAt.slice(0, 10)}</Text>
      <Text style={styles.day}>{formatDay(run.startedAt)} 러닝</Text>
      <View style={[styles.sourceBadge, run.source === 'MANUAL' && styles.manualBadge]}>
        <Text style={styles.sourceBadgeText}>{run.source === 'MANUAL' ? '수기 기록' : '앱 측정'}</Text>
      </View>
      <Pressable
        accessibilityLabel="러닝 상세보기"
        accessibilityRole="button"
        disabled={run.source === 'MANUAL'}
        onPress={onOpen}
        style={({ pressed }) => [styles.detail, run.source === 'MANUAL' && styles.detailDisabled, pressed && run.source === 'APP' && styles.detailPressed]}
      >
        <Text style={styles.detailText}>상세보기</Text>
      </Pressable>
      <View style={styles.line} />
      <View style={styles.metrics}>
        <Metric value={run.distanceM === null ? '—' : (run.distanceM / 1000).toFixed(2)} label="KM" />
        <Metric value={run.rhythmScore === null ? '—' : `${Math.round(run.rhythmScore * 100)}%`} label="안정 구간" />
        <Metric value={formatTime(run.activeDurationSec)} label="시간" />
      </View>
    </Animated.View>
  </View>;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(new Date(value));
}

function formatTime(value: number) {
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  frame: { flex: 1, position: 'relative' },
  headerSurface: { position: 'absolute', top: 0, left: 0, right: 0, height: navigationHeader.height + 8, zIndex: 8, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.08)' },
  settings: { position: 'absolute', right: 25, top: navigationHeader.actionTop, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  iconPressed: compactPressFeedback,
  content: { paddingTop: 84, paddingHorizontal: 27, paddingBottom: 40 },
  dismissArea: { height: 140 },
  section: { color: colors.white, fontSize: 17, fontWeight: '700', marginLeft: 10 },
  summary: { height: 86, borderRadius: 20, backgroundColor: colors.white, marginTop: 15, flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: colors.ink },
  summaryLabel: { fontSize: 12, color: '#747474', marginTop: 6 },
  emptySummary: { height: 86, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', marginTop: 15, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#9A9A9A', fontSize: 15 },
  empty: { height: 439, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', marginTop: 15, position: 'relative' },
  emptyLine: { position: 'absolute', top: 176, alignSelf: 'center', color: '#9A9A9A', fontSize: 15 },
  emptyLine2: { position: 'absolute', top: 212, alignSelf: 'center', color: '#9A9A9A', fontSize: 15 },
  prepare: { position: 'absolute', left: 37, right: 39, top: 264, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,122,89,.85)', alignItems: 'center', justifyContent: 'center' },
  prepareText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  buttonPressed: pressFeedback,
  swipeArea: { height: 136, borderRadius: 20, backgroundColor: colors.danger, marginTop: 13, overflow: 'hidden' },
  deleteReveal: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 28, gap: 4 },
    deleteRevealPressed: { opacity: 0.72 },
  deleteRevealText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  card: { height: 136, borderRadius: 20, backgroundColor: colors.white, padding: 26, position: 'relative' },
  date: { fontSize: 13, fontWeight: '700', color: colors.ink },
  day: { fontSize: 13, color: '#747474', marginTop: 6 },
  sourceBadge: { position: 'absolute', right: 132, top: 20, height: 24, paddingHorizontal: 9, borderRadius: 8, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  manualBadge: { backgroundColor: '#E9E9E9' },
  sourceBadgeText: { fontSize: 11, fontWeight: '700', color: colors.inkMuted },
  detail: { position: 'absolute', right: 26, top: 16, width: 93, height: 36, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  detailDisabled: { opacity: 0.4 },
  detailPressed: compactPressFeedback,
  detailText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  line: { position: 'absolute', left: 26, right: 26, top: 65, height: 1, backgroundColor: colors.border },
  metrics: { position: 'absolute', left: 26, right: 20, top: 77, flexDirection: 'row' },
  metric: { flex: 1 },
  metricValue: { fontSize: 17, fontWeight: '700', color: colors.ink },
  metricLabel: { fontSize: 13, color: '#747474', marginTop: 4 },
});
