import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FigmaButton, FigmaRadio, FigmaScreen, OnboardingTop } from '@/src/components/figma-ui';
import { useOnboarding, type RunningPurpose } from '@/src/components/onboarding-provider';
import { colors } from '@/src/theme/tokens';

const options: [RunningPurpose, string][] = [['COMPLETE','완주'],['HABIT','습관 형성'],['WEIGHT','체중 관리'],['FITNESS','체력 향상'],['PERFORMANCE','기록 향상']];
export default function PurposeScreen() { const router=useRouter(); const {draft,updateDraft}=useOnboarding(); return <FigmaScreen><OnboardingTop step={2} onBack={()=>router.back()}/><Text style={styles.title}>러닝의 목적을 선택해주세요</Text><Text style={styles.subtitle}>추천 목표를 정하는 기준으로 사용돼요</Text><View style={styles.options}>{options.map(([value,label])=><FigmaRadio key={value} label={label} selected={draft.purpose===value} onPress={()=>updateDraft({purpose:value})}/>)}</View><FigmaButton disabled={draft.purpose===undefined} onPress={()=>router.push('/onboarding/body')} style={styles.button}>다음</FigmaButton></FigmaScreen>; }
const styles=StyleSheet.create({title:{position:'absolute',left:27,right:27,top:88,color:colors.white,fontSize:20,fontWeight:'800',textAlign:'center'},subtitle:{position:'absolute',left:27,right:27,top:123,color:colors.white,fontSize:14,textAlign:'center'},options:{position:'absolute',left:38,top:168,right:30},button:{top:586}});
