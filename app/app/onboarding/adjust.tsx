import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCompleteOnboarding } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { FigmaBack, FigmaButton, FigmaLogo, FigmaScreen } from '@/src/components/figma-ui';
import { useOnboarding } from '@/src/components/onboarding-provider';
import { colors } from '@/src/theme/tokens';
const cadenceControls = [
  { delta: -5, label: '-5' },
  { delta: -1, label: '−' },
  { delta: 1, label: '+' },
  { delta: 5, label: '+5' },
] as const;

export default function AdjustCadence(){const router=useRouter();const{token,confirmOnboarded}=useAuth();const{draft,updateDraft}=useOnboarding();const[cadence,setCadence]=useState(draft.baselineCadence||160);const mutation=useCompleteOnboarding(token);const finish=async()=>{try{const profile=await mutation.mutateAsync({runningPurpose:draft.purpose??'HABIT',experienceLevel:draft.experienceLevel??0,maxContinuousMin:draft.maxContinuousMin??5,weeklyGoalCount:draft.weeklyGoalCount??3,baselineCadence:cadence,heightCm:draft.heightCm,weightKg:draft.weightKg,birthYear:draft.birthYear,gender:draft.gender});updateDraft({baselineCadence:cadence});confirmOnboarded(profile.onboarded);router.replace('/');}catch{}};return <FigmaScreen><FigmaBack onPress={()=>router.back()}/><FigmaLogo centered top={25}/><Text style={styles.title}>케이던스를 직접 조정 할 수 있어요</Text><Text style={styles.subtitle}>원하는 케이던스를 설정해주세요</Text><View style={styles.card}><Text style={styles.cardTitle}>케이던스 조절</Text><View style={styles.valueRow}><Text style={styles.value}>{cadence}</Text><Text style={styles.unit}>SPM</Text></View><View style={styles.controls}>{cadenceControls.map(({delta,label})=><Pressable accessibilityLabel={`케이던스 ${label}`} key={delta} onPress={()=>setCadence(c=>Math.max(120,Math.min(200,c+delta)))} style={({pressed})=>[styles.control,pressed&&styles.controlPressed]}><Text style={styles.controlText}>{label}</Text></Pressable>)}</View></View><FigmaButton onPress={()=>void finish()} style={styles.button}>시작하기</FigmaButton></FigmaScreen>}
const styles=StyleSheet.create({title:{position:'absolute',left:27,right:27,top:108,color:colors.white,fontSize:20,fontWeight:'800',textAlign:'center'},subtitle:{position:'absolute',left:27,right:27,top:142,color:colors.white,fontSize:14,textAlign:'center'},card:{position:'absolute',left:27,right:28,top:211,height:179,borderRadius:20,backgroundColor:colors.white,padding:18},cardTitle:{fontSize:17,fontWeight:'700',color:colors.ink},valueRow:{position:'absolute',left:0,right:0,top:60,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:7},value:{fontSize:36,fontWeight:'800',color:colors.primary},unit:{fontSize:13,fontWeight:'700',color:colors.inkMuted,marginTop:14},controls:{position:'absolute',left:18,right:18,top:119,flexDirection:'row',justifyContent:'space-between'},control:{width:54,height:34,borderWidth:1,borderColor:colors.border,borderRadius:14,alignItems:'center',justifyContent:'center'},controlPressed:{backgroundColor:'rgba(28,26,26,.12)',borderColor:'rgba(28,26,26,.28)',transform:[{scale:.96}]},controlText:{fontSize:13,fontWeight:'700',color:colors.ink},button:{top:603,backgroundColor:colors.primary}});
