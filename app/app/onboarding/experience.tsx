import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FigmaButton, FigmaRadio, FigmaScreen, OnboardingTop } from '@/src/components/figma-ui';
import { useOnboarding, type ExperienceLevel } from '@/src/components/onboarding-provider';
import { colors } from '@/src/theme/tokens';

const options: { label: string; level: ExperienceLevel; minutes: number }[] = [
  { label: '처음이에요', level: 0, minutes: 5 }, { label: '가끔 달려요 (월 1~2번)', level: 0, minutes: 10 },
  { label: '꾸준히 달려요 (주 1~2번)', level: 1, minutes: 20 }, { label: '자주 달려요 (주 3~4번)', level: 2, minutes: 30 },
  { label: '러닝을 즐겨요 (주 5번 이상)', level: 2, minutes: 30 },
];

export default function ExperienceScreen() {
  const router = useRouter(); const { draft, updateDraft } = useOnboarding(); const selected = draft.experienceChoice;
  return <FigmaScreen><OnboardingTop step={1} onBack={() => router.back()} />
    <Text style={styles.title}>현재 러닝 경험을 선택해주세요</Text>
    <View style={styles.options}>{options.map((item, index) => <FigmaRadio key={item.label} label={item.label} selected={selected === index} onPress={() => updateDraft({ experienceChoice: index, experienceLevel: item.level, maxContinuousMin: item.minutes })} />)}</View>
    <FigmaButton disabled={selected === undefined} onPress={() => router.push('/onboarding/purpose')} style={styles.button}>다음</FigmaButton>
    <Text onPress={() => { updateDraft({ purpose: 'COMPLETE', experienceLevel: 0, maxContinuousMin: 10, weeklyGoalCount: 3 }); router.replace('/onboarding/cadence'); }} style={styles.skip}>전체 건너뛰기</Text>
  </FigmaScreen>;
}
const styles=StyleSheet.create({title:{position:'absolute',left:27,right:27,top:88,color:colors.white,fontSize:20,fontWeight:'800',textAlign:'center'},options:{position:'absolute',left:38,top:165,right:30},button:{top:586},skip:{position:'absolute',top:659,alignSelf:'center',color:'#A0A0A0',fontSize:13,textDecorationLine:'underline'}});
