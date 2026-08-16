import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useProfile, useUpdateProfile } from '@/src/api/queries';
import type { RunningPurpose } from '@/src/api/client';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaScreen } from '@/src/components/figma-ui';
import { getProfilePhotoUri, setProfilePhotoUri } from '@/src/components/profile-photo';
import { PurposePickerModal, purposeLabel } from '@/src/components/purpose-picker-modal';
import { ScrollHeaderScrim } from '@/src/components/scroll-header-scrim';
import { WheelPickerModal, type WheelColumn } from '@/src/components/wheel-picker-modal';
import { colors } from '@/src/theme/tokens';

const years = Array.from({ length: 76 }, (_, index) => String(1940 + index));
const months = Array.from({ length: 12 }, (_, index) => String(index + 1));
const days = Array.from({ length: 31 }, (_, index) => String(index + 1));
const heightIntegers = Array.from({ length: 91 }, (_, index) => String(130 + index));
const weightIntegers = Array.from({ length: 116 }, (_, index) => String(35 + index));
const decimals = Array.from({ length: 10 }, (_, index) => String(index));
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type BirthDate = { year: number; month: number; day: number };
type PickerType = 'birth' | 'height' | 'weight';
type Gender = 'M' | 'F' | 'O';

export default function Privacy() {
  const router = useRouter();
  const { token } = useAuth();
  const profile = useProfile(token);

  if (!profile.data) return <FigmaScreen />;
  return <PrivacyForm profile={profile.data} token={token} onClose={() => router.back()} />;
}

function PrivacyForm({ profile, token, onClose }: {
  profile: NonNullable<ReturnType<typeof useProfile>['data']>;
  token: string | null;
  onClose: () => void;
}) {
  const update = useUpdateProfile(token);
  const [name, setName] = useState('홍길동');
  const [gender, setGender] = useState<Gender | null>(profile.gender);
  const [birth, setBirth] = useState<BirthDate | null>(profile.birthYear ? { year: profile.birthYear, month: 1, day: 1 } : null);
  const [height, setHeight] = useState<number | null>(profile.heightCm);
  const [weight, setWeight] = useState<number | null>(profile.weightKg);
  const [purpose, setPurpose] = useState<RunningPurpose>(profile.runningPurpose ?? 'HABIT');
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPicking, setPhotoPicking] = useState(false);
  const [picker, setPicker] = useState<PickerType | null>(null);
  const saveScale = useRef(new Animated.Value(1)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const columns = getColumns(picker, birth, height, weight);

  useEffect(() => {
    let mounted = true;
    void getProfilePhotoUri().then((uri) => {
      if (mounted && uri) setPhotoUri(uri);
    });
    return () => { mounted = false; };
  }, []);

  const animateSave = (toValue: number) => Animated.spring(saveScale, {
    damping: 14,
    mass: 0.45,
    stiffness: 360,
    toValue,
    useNativeDriver: true,
  }).start();

  const save = () => update.mutateAsync({
    runningPurpose: purpose,
    experienceLevel: profile.experienceLevel!,
    maxContinuousMin: profile.maxContinuousMin!,
    weeklyGoalCount: profile.weeklyGoalCount!,
    baselineCadence: profile.baselineCadence!,
    heightCm: height ?? undefined,
    weightKg: weight ?? undefined,
    birthYear: birth?.year,
    gender: gender ?? undefined,
  });

  const pickProfilePhoto = async () => {
    if (photoPicking) return;
    setPhotoPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 접근 권한이 필요해요', '설정에서 사진 접근을 허용하면 프로필 사진을 변경할 수 있어요.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const directory = `${FileSystem.documentDirectory}profile/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const extension = asset.fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const nextUri = `${directory}avatar-${Date.now()}.${extension}`;
      await FileSystem.copyAsync({ from: asset.uri, to: nextUri });
      const previousUri = await getProfilePhotoUri();
      await setProfilePhotoUri(nextUri);
      setPhotoUri(nextUri);
      if (previousUri?.startsWith(directory) && previousUri !== nextUri) {
        await FileSystem.deleteAsync(previousUri, { idempotent: true });
      }
    } catch {
      Alert.alert('사진을 변경하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setPhotoPicking(false);
    }
  };

  return <FigmaScreen>
    <Animated.ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        accessibilityLabel="프로필 사진 변경"
        accessibilityRole="button"
        disabled={photoPicking}
        onPress={() => void pickProfilePhoto()}
        style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
      >
        {photoUri
          ? <Image source={{ uri: photoUri }} style={styles.avatarImage} />
          : <><View style={styles.head} /><View style={styles.body} /></>}
        <View style={styles.cameraBadge}>
          <Ionicons color={colors.white} name={photoPicking ? 'hourglass-outline' : 'camera'} size={15} />
        </View>
      </Pressable>
      <Text style={styles.nameLabel}>성함</Text>
      <TextInput value={name} onChangeText={setName} style={styles.name} />
      <Text style={styles.genderTitle}>성별</Text>
      <View style={styles.genders}>{([['M', '남성'], ['F', '여성'], ['O', '선택하지 않음']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setGender(value)} style={({ pressed }) => [styles.gender, pressed && styles.pressed]}><View style={[styles.radio, gender === value && styles.radioOn]}>{gender === value ? <View style={styles.dot} /> : null}</View><Text style={[styles.genderText, gender === value && styles.selected]}>{label}</Text></Pressable>)}</View>
      <View style={styles.line} />
      <PickerField label="생년월일" value={birth ? `${birth.year}. ${pad(birth.month)}. ${pad(birth.day)}` : undefined} top={327} onPress={() => setPicker('birth')} />
      <PickerField label="신장" value={height?.toString()} top={428} unit="cm" onPress={() => setPicker('height')} />
      <PickerField label="체중" value={weight?.toString()} top={529} unit="kg" onPress={() => setPicker('weight')} />
      <View style={styles.purposeField}>
        <Text style={styles.fieldLabel}>러닝 목적</Text>
        <Pressable accessibilityRole="button" onPress={() => setPurposeOpen(true)} style={({ pressed }) => [styles.purposeSelect, pressed && styles.pressed]}>
          <Text style={styles.purposeValue}>{purposeLabel(purpose)}</Text>
          <Ionicons color="rgba(255,255,255,.65)" name="chevron-down" size={14} />
        </Pressable>
      </View>
    </Animated.ScrollView>
    <ScrollHeaderScrim scrollY={scrollY} />
    <FigmaBack onPress={onClose} />
    <Text style={styles.header}>개인정보 수정</Text>
    <AnimatedPressable
      accessibilityRole="button"
      disabled={update.isPending}
      onPress={() => void save()}
      onPressIn={() => animateSave(0.9)}
      onPressOut={() => animateSave(1)}
      style={[styles.save, update.isPending && styles.savePending, { transform: [{ scale: saveScale }] }]}
    ><Text style={styles.saveText}>{update.isPending ? '저장 중' : '저장'}</Text></AnimatedPressable>
    {picker ? <WheelPickerModal
      columns={columns}
      onCancel={() => setPicker(null)}
      onConfirm={(indexes) => {
        if (picker === 'birth') {
          const year = Number(years[indexes[0]]);
          const month = Number(months[indexes[1]]);
          const requestedDay = Number(days[indexes[2]]);
          setBirth({ year, month, day: Math.min(requestedDay, new Date(year, month, 0).getDate()) });
        }
        if (picker === 'height') setHeight(Number(`${heightIntegers[indexes[0]]}.${decimals[indexes[1]]}`));
        if (picker === 'weight') setWeight(Number(`${weightIntegers[indexes[0]]}.${decimals[indexes[1]]}`));
        setPicker(null);
      }}
      title={picker === 'birth' ? '생년월일' : picker === 'height' ? '신장' : '체중'}
      visible
    /> : null}
    <PurposePickerModal
      onChange={setPurpose}
      onClose={() => setPurposeOpen(false)}
      value={purpose}
      visible={purposeOpen}
    />
  </FigmaScreen>;
}

function PickerField({ label, value, top, unit, onPress }: { label: string; value?: string; top: number; unit?: string; onPress: () => void }) {
  return <View style={[styles.field, { top }]}><Text style={styles.fieldLabel}>{label}</Text><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.inputWrap, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.pickerValue, !value && styles.placeholder]}>{value ?? '선택해 주세요'}</Text>{value && unit ? <Text style={styles.unit}>{unit}</Text> : null}<Ionicons color="rgba(255,255,255,.65)" name="chevron-down" size={14} style={styles.chevron} /></Pressable></View>;
}

function getColumns(picker: PickerType | null, birth: BirthDate | null, height: number | null, weight: number | null): WheelColumn[] {
  if (picker === 'birth') return [
    { values: years, initialIndex: Math.max(0, years.indexOf(String(birth?.year ?? 2000))), suffix: '년' },
    { values: months, initialIndex: Math.max(0, months.indexOf(String(birth?.month ?? 1))), suffix: '월' },
    { values: days, initialIndex: Math.max(0, days.indexOf(String(birth?.day ?? 1))), suffix: '일' },
  ];
  if (picker === 'height') {
    const current = height ?? 170;
    return [{ values: heightIntegers, initialIndex: Math.max(0, heightIntegers.indexOf(String(Math.floor(current)))) }, { values: decimals, initialIndex: decimalIndex(current), prefix: '.', suffix: ' cm' }];
  }
  if (picker === 'weight') {
    const current = weight ?? 60;
    return [{ values: weightIntegers, initialIndex: Math.max(0, weightIntegers.indexOf(String(Math.floor(current)))) }, { values: decimals, initialIndex: decimalIndex(current), prefix: '.', suffix: ' kg' }];
  }
  return [];
}

function decimalIndex(value: number) {
  return Math.abs(Math.round(value * 10)) % 10;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  content: { minHeight: 810, paddingBottom: 125 },
  header: { position: 'absolute', top: 23, alignSelf: 'center', zIndex: 10, color: colors.white, fontSize: 17, fontWeight: '700' },
  avatar: { position: 'absolute', left: 40, top: 93, width: 90, height: 90, borderRadius: 45, backgroundColor: colors.primary, alignItems: 'center' },
  avatarPressed: { opacity: 0.78, transform: [{ scale: 0.95 }] },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  cameraBadge: { position: 'absolute', right: -2, bottom: 1, width: 29, height: 29, borderRadius: 15, borderWidth: 2, borderColor: colors.black, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  head: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.black, marginTop: 19 },
  body: { width: 38, height: 23, borderRadius: 19, backgroundColor: colors.black, marginTop: 5 },
  nameLabel: { position: 'absolute', left: 180, top: 118, color: colors.white, fontSize: 13 },
  name: { position: 'absolute', left: 180, right: 58, top: 141, height: 34, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.7)', color: colors.white, fontSize: 15, fontWeight: '700', padding: 0 },
  genderTitle: { position: 'absolute', left: 40, top: 199, color: colors.white, fontSize: 17, fontWeight: '700' },
  genders: { position: 'absolute', left: 40, right: 40, top: 232, flexDirection: 'row', justifyContent: 'space-between' },
  gender: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  genderText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  selected: { color: colors.primary },
  line: { position: 'absolute', left: 33, right: 32, top: 281, height: 1, backgroundColor: 'rgba(255,255,255,.3)' },
  field: { position: 'absolute', left: 39, width: 160 },
  fieldLabel: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  inputWrap: { height: 43, borderWidth: 1, borderColor: 'rgba(255,255,255,.7)', borderRadius: 11, flexDirection: 'row', alignItems: 'center' },
  pickerValue: { flex: 1, color: colors.white, fontSize: 14, fontWeight: '700', paddingLeft: 12 },
  placeholder: { color: 'rgba(255,255,255,.45)', fontSize: 12 },
  unit: { color: colors.white, fontSize: 13, fontWeight: '700', marginRight: 28 },
  chevron: { position: 'absolute', right: 10 },
  purposeField: { position: 'absolute', left: 39, width: 160, top: 630 },
  purposeSelect: { height: 43, borderWidth: 1, borderColor: 'rgba(255,255,255,.7)', borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purposeValue: { color: colors.white, fontSize: 14, fontWeight: '700' },
  save: { position: 'absolute', left: 27, right: 27, bottom: 24, height: 52, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 8 },
  savePending: { opacity: 0.55 },
  saveText: { color: colors.white, fontSize: 17, fontWeight: '700' },
});
