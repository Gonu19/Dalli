import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FigmaButton, FigmaScreen, OnboardingTop } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { useOnboarding, type Gender } from '@/src/components/onboarding-provider';
import { WheelPickerModal, type WheelColumn } from '@/src/components/wheel-picker-modal';
import { colors, pressFeedback } from '@/src/theme/tokens';

const years = Array.from({ length: 76 }, (_, index) => String(1940 + index));
const months = Array.from({ length: 12 }, (_, index) => String(index + 1));
const days = Array.from({ length: 31 }, (_, index) => String(index + 1));
const heightIntegers = Array.from({ length: 91 }, (_, index) => String(130 + index));
const weightIntegers = Array.from({ length: 116 }, (_, index) => String(35 + index));
const decimals = Array.from({ length: 10 }, (_, index) => String(index));

type PickerType = 'birth' | 'height' | 'weight';

export default function BodyInfoScreen() {
  const router = useRouter();
  const { draft, updateDraft } = useOnboarding();
  const [name, setName] = useState('');
  const [birth, setBirth] = useState(draft.birthYear && draft.birthMonth && draft.birthDay ? { year: draft.birthYear, month: draft.birthMonth, day: draft.birthDay } : null);
  const [height, setHeight] = useState<number | null>(draft.heightCm ?? null);
  const [weight, setWeight] = useState<number | null>(draft.weightKg ?? null);
  const [gender, setGender] = useState<Gender | undefined>(draft.gender);
  const [picker, setPicker] = useState<PickerType | null>(null);

  const complete = Boolean(name.trim() && gender && birth && height && weight);
  const next = () => {
    if (!complete || !birth || !gender || !height || !weight) return;
    updateDraft({ name: name.trim(), birthYear: birth.year, birthMonth: birth.month, birthDay: birth.day, heightCm: height, weightKg: weight, gender });
    router.push('/onboarding/reason');
  };

  const columns = getColumns(picker, birth, height, weight);
  return <FigmaScreen>
    <OnboardingTop step={3} onBack={() => router.back()}/>
    <Text style={styles.title}>신체 정보를 입력해주세요</Text><Text style={styles.subtitle}>케이던스를 제안하는 기준으로 사용돼요</Text>
    <Text style={styles.labelGender}>성별</Text>
    <View style={styles.gender}>{([['M','남성'],['F','여성'],['O','선택하지 않음']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setGender(value)} style={({ pressed }) => [styles.genderItem, pressed && styles.pressed]}><View style={[styles.radio, gender === value && styles.radioOn]}>{gender === value ? <View style={styles.dot}/> : null}</View><Text style={[styles.genderText, gender === value && styles.selected]}>{label}</Text></Pressable>)}</View>
    <View style={[styles.field, { left: 38, top: 274, width: 124 }]}><Text style={styles.fieldLabel}>닉네임</Text><View style={styles.inputWrap}><TextInput onChangeText={setName} placeholder="입력해 주세요" placeholderTextColor="rgba(255,255,255,.35)" style={styles.input} value={name}/></View></View>
    <PickerField label="생년월일" value={birth ? `${birth.year}. ${pad(birth.month)}. ${pad(birth.day)}` : undefined} left={237} top={274} width={124} onPress={() => setPicker('birth')}/>
    <PickerField label="신장" value={height?.toString()} left={38} top={372} width={124} unit="cm" onPress={() => setPicker('height')}/>
    <PickerField label="체중" value={weight?.toString()} left={237} top={372} width={124} unit="kg" onPress={() => setPicker('weight')}/>
    <FigmaButton disabled={!complete} onPress={next} style={styles.button}>다음</FigmaButton>
    {picker ? <WheelPickerModal
      columns={columns}
      onCancel={() => setPicker(null)}
      onConfirm={(indexes) => {
        if (picker === 'birth') {
          const year = Number(years[indexes[0]]); const month = Number(months[indexes[1]]); const requestedDay = Number(days[indexes[2]]);
          setBirth({ year, month, day: Math.min(requestedDay, new Date(year, month, 0).getDate()) });
        }
        if (picker === 'height') setHeight(Number(heightIntegers[indexes[0]]));
        if (picker === 'weight') setWeight(Number(`${weightIntegers[indexes[0]]}.${decimals[indexes[1]]}`));
        setPicker(null);
      }}
      title={picker === 'birth' ? '생년월일' : picker === 'height' ? '신장' : '체중'}
      visible
    /> : null}
  </FigmaScreen>;
}

function PickerField({ label, value, left, top, width, unit, onPress }: { label: string; value?: string; left: number; top: number; width: number; unit?: string; onPress: () => void }) {
  return <View style={[styles.field, { left, top, width }]}><Text style={styles.fieldLabel}>{label}</Text><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.inputWrap, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.pickerValue, !value && styles.placeholder]}>{value ?? '선택해 주세요'}</Text>{value && unit ? <Text style={styles.unit}>{unit}</Text> : null}<Ionicons color="rgba(255,255,255,.65)" name="chevron-down" size={14} style={styles.chevron}/></Pressable></View>;
}

function getColumns(picker: PickerType | null, birth: { year: number; month: number; day: number } | null, height: number | null, weight: number | null): WheelColumn[] {
  if (picker === 'birth') return [
    { values: years, initialIndex: Math.max(0, years.indexOf(String(birth?.year ?? 2000))), suffix: '년' },
    { values: months, initialIndex: Math.max(0, months.indexOf(String(birth?.month ?? 1))), suffix: '월' },
    { values: days, initialIndex: Math.max(0, days.indexOf(String(birth?.day ?? 1))), suffix: '일' },
  ];
  if (picker === 'height') {
    const current = height ?? 170;
    return [{ values: heightIntegers, initialIndex: Math.max(0, heightIntegers.indexOf(String(Math.round(current)))), suffix: ' cm' }];
  }
  if (picker === 'weight') {
    const current = weight ?? 60;
    return [{ values: weightIntegers, initialIndex: Math.max(0, weightIntegers.indexOf(String(Math.floor(current)))), suffix: '' }, { values: decimals, initialIndex: Math.max(0, decimals.indexOf(String(Math.round((current % 1) * 10)))), prefix: '.', suffix: ' kg' }];
  }
  return [];
}

function pad(value: number) { return String(value).padStart(2, '0'); }

const styles = StyleSheet.create({
  title: { position: 'absolute', left: 27, right: 27, top: 88, color: colors.white, fontSize: 20, fontWeight: '800', textAlign: 'center' }, subtitle: { position: 'absolute', left: 27, right: 27, top: 123, color: colors.white, fontSize: 14, textAlign: 'center' }, pressed: pressFeedback,
  labelGender: { position: 'absolute', left: 38, top: 183, color: colors.white, fontSize: 17, fontWeight: '700' }, gender: { position: 'absolute', left: 38, right: 35, top: 213, flexDirection: 'row', justifyContent: 'space-between' }, genderItem: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' }, radioOn: { borderColor: colors.primary }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }, genderText: { color: colors.white, fontSize: 15, fontWeight: '700' }, selected: { color: colors.primary },
  field: { position: 'absolute' }, fieldLabel: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 14 }, inputWrap: { height: 43, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 11, flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, color: colors.white, fontSize: 15, fontWeight: '700', paddingHorizontal: 12 }, pickerValue: { flex: 1, color: colors.white, fontSize: 13, fontWeight: '700', paddingLeft: 10 }, placeholder: { color: 'rgba(255,255,255,.45)', fontSize: 12 }, unit: { color: colors.white, fontSize: 13, fontWeight: '700', marginRight: 25 }, chevron: { position: 'absolute', right: 8 }, button: { top: 586 },
});
