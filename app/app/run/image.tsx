import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Animated, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { FigmaBack, FigmaLogo, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { useRunResult } from '@/src/components/run-result-provider';
import { RunMap } from '@/src/components/run-map';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { colors, navigationHeader, pressFeedback } from '@/src/theme/tokens';

const photo = require('@/assets/images/run-share-sample.png');

export default function ResultImage() {
  const router = useRouter();
  const { result, photoUri } = useRunResult();
  const record = result?.record;
  const scrollY = useRef(new Animated.Value(0)).current;
  const cardRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);

  /**
   * 카드 그대로를 사진 보관함에 저장한다.
   *
   * 권한을 거부해도 화면은 그대로 남는다 — 결과 이미지는 러닝 기록과 무관한
   * 부가 기능이라, 실패가 러닝 흐름을 막지 않아야 한다 (`ROADMAP.md` FR-031).
   */
  const savePhoto = async () => {
    if (saving || cardRef.current === null) return;
    setSaving(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('사진 보관함에 접근할 수 없어요', '설정에서 사진 접근을 허용하면 저장할 수 있어요.');
        return;
      }
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.95 });
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('사진을 저장했어요', '사진 보관함에서 확인할 수 있어요.');
    } catch {
      Alert.alert('저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return <FigmaScreen>
    <FigmaBack onPress={() => router.back()} />
    <Text style={styles.header}>결과 이미지</Text>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <View collapsable={false} ref={cardRef} style={styles.card}>
      <ImageBackground
        source={photoUri ? { uri: photoUri } : photo}
        resizeMode="cover"
        style={styles.photo}
      >
        <View style={styles.photoShade} />
        <FigmaLogo top={13} left={9} />
        {/* 종료 직후의 경로 스냅샷. 좌표는 메모리에만 있고 서버로 가지 않는다 (`ENGINE.md` §10). */}
        <View style={styles.routeCard}><RunMap style={styles.routeMap} /></View>
        <View style={styles.overlay}>
          <Text style={styles.photoLabel}>활동 시간</Text>
          <Text style={styles.photoValue}>{record ? format(record.durationSec) : '—'}</Text>
          <Text style={styles.photoLabel}>거리</Text>
          <Text style={styles.photoValue}>{record?.distanceM == null ? '—' : `${(record.distanceM / 1000).toFixed(2)} km`}</Text>
          <Text style={styles.photoLabel}>평균 케이던스</Text>
          <Text style={styles.photoValue}>{record?.avgCadence == null ? '—' : `${Math.round(record.avgCadence)} spm`}</Text>
        </View>
      </ImageBackground>
      </View>
      <Text style={styles.title}>이미지에 포함할 지표</Text>
      <View style={styles.chips}>
        {['활동 시간', '거리', '평균 케이던스', '경로'].map((label) => <View key={label} style={styles.chip}>
          <Ionicons color={colors.primary} name="checkmark-circle" size={19} />
          <Text style={styles.chipText}>{label}</Text>
        </View>)}
      </View>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => void savePhoto()} style={({ pressed }) => [styles.save, (pressed || saving) && styles.buttonPressed]}>
        <Text style={styles.buttonText}>{saving ? '사진 저장 중...' : '사진 저장'}</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/run/report')}
        style={({ pressed }) => [styles.report, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>리포트 보기</Text>
      </Pressable>
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
  </FigmaScreen>;
}

function format(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', color: colors.white, fontSize: 17, fontWeight: '700', zIndex: 10 },
  content: { paddingTop: 95 - navigationHeader.contentLift, paddingHorizontal: 28, paddingBottom: 36 },
  card: { alignSelf: 'center' },
  photo: { width: 267, height: 360, alignSelf: 'center', overflow: 'hidden' },
  photoShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.22)' },
  overlay: { position: 'absolute', left: 24, bottom: 18, gap: 2 },
  routeCard: { position: 'absolute', right: 12, top: 12, width: 96, height: 96, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.6)' },
  routeMap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%' },
  photoLabel: { color: colors.white, fontSize: 12, marginTop: 6 },
  photoValue: { color: colors.white, fontSize: 17, fontWeight: '700' },
  title: { color: colors.white, fontSize: 17, fontWeight: '700', marginTop: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, marginTop: 16 },
  chip: { width: '48%', height: 40, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8 },
  chipText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  save: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 30 },
  report: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonPressed: pressFeedback,
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
