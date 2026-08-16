import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { FigmaButton, FigmaRadio, FigmaScreen, OnboardingTop } from '@/src/components/figma-ui';
import { useOnboarding } from '@/src/components/onboarding-provider';
import { colors } from '@/src/theme/tokens';
export default function ScheduleScreen(){const router=useRouter();const{draft,updateDraft}=useOnboarding();return <FigmaScreen><OnboardingTop step={5} onBack={()=>router.back()}/><Text style={styles.title}>한 주에 몇 번 달리기를 원하시나요</Text><View style={styles.options}>{[1,2,3,4,5].map(v=><FigmaRadio key={v} label={v===5?'주 5회 이상':`주 ${v}회`} selected={draft.weeklyGoalCount===v} onPress={()=>updateDraft({weeklyGoalCount:v})}/>)}</View><FigmaButton disabled={draft.weeklyGoalCount===undefined} onPress={()=>router.push('/onboarding/cadence')} style={styles.button}>다음</FigmaButton></FigmaScreen>}
const styles=StyleSheet.create({title:{position:'absolute',left:27,right:27,top:108,color:colors.white,fontSize:20,fontWeight:'800',textAlign:'center'},options:{position:'absolute',left:38,top:188,right:30},button:{top:604}});
