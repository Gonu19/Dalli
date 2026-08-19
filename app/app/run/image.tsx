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

const imageOptions = ['활동 시간', '거리', '평균 케이던스', '경로'] as const;
type ImageOption = typeof imageOptions[number];

export default function ResultImage() {
  const router = useRouter();
  const { result, photoUri } = useRunResult();
  const record = result?.record;
  const activeDurationSec = result?.uploaded?.activeDurationSec ?? result?.activeDurationSec ?? null;
  const scrollY = useRef(new Animated.Value(0)).current;
  const cardRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);
  const [included, setIncluded] = useState<Record<ImageOption, boolean>>({
    '활동 시간': true,
    '거리': true,
    '평균 케이던스': true,
    '경로': true,
  });

  const toggleIncluded = (option: ImageOption) => {
    setIncluded((current) => ({ ...current, [option]: !current[option] }));
  };

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
        {included['경로'] ? <RunMap routeOnly style={styles.routeOnly} /> : null}
        {included['활동 시간'] || included.거리 || included['평균 케이던스'] ? <View style={styles.overlay}>
          {included['활동 시간'] ? <Stat label="활동 시간" value={activeDurationSec === null ? '—' : format(activeDurationSec)} /> : null}
          {included.거리 ? <Stat label="거리" value={record?.distanceM == null ? '—' : `${(record.distanceM / 1000).toFixed(2)} km`} /> : null}
          {included['평균 케이던스'] ? <Stat label="평균 케이던스" value={record?.avgCadence == null ? '—' : `${Math.round(record.avgCadence)} spm`} /> : null}
        </View> : null}
      </ImageBackground>
      </View>
      <Text style={styles.title}>이미지에 포함할 지표</Text>
      <View style={styles.chips}>
        {imageOptions.map((label) => <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: included[label] }}
          key={label}
          onPress={() => toggleIncluded(label)}
          style={({ pressed }) => [styles.chip, included[label] && styles.chipSelected, pressed && styles.chipPressed]}
        >
          <Ionicons color={included[label] ? colors.primary : colors.textMuted} name={included[label] ? 'checkmark-circle' : 'ellipse-outline'} size={19} />
          <Text style={[styles.chipText, !included[label] && styles.chipTextMuted]}>{label}</Text>
        </Pressable>)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return <View><Text style={styles.photoLabel}>{label}</Text><Text style={styles.photoValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', color: colors.white, fontSize: 17, fontWeight: '700', zIndex: 10 },
  content: { paddingTop: 95 - navigationHeader.contentLift, paddingHorizontal: 28, paddingBottom: 36 },
  card: { alignSelf: 'center' },
  photo: { width: 267, height: 360, alignSelf: 'center', overflow: 'hidden' },
  photoShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.22)' },
  overlay: { position: 'absolute', left: 24, bottom: 18, gap: 2 },
  routeOnly: { right: 16, bottom: 16, width: 104, height: 116 },
  photoLabel: { color: colors.white, fontSize: 12, marginTop: 6 },
  photoValue: { color: colors.white, fontSize: 17, fontWeight: '700' },
  title: { color: colors.white, fontSize: 17, fontWeight: '700', marginTop: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, marginTop: 16 },
  chip: { width: '48%', height: 40, borderWidth: 1, borderColor: 'rgba(221,224,225,.45)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8, backgroundColor: colors.background },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.background },
  chipPressed: { opacity: .72 },
  chipText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  chipTextMuted: { color: colors.textMuted },
  save: { height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 30 },
  report: { height: 52, borderRadius: 18, borderWidth: 0.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonPressed: pressFeedback,
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
