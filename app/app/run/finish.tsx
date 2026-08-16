import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { FigmaBack, FigmaLogo, FigmaScreen } from '@/src/components/figma-ui';
import { useRunResult } from '@/src/components/run-result-provider';
import { colors } from '@/src/theme/tokens';

export default function Finish(){
  const router=useRouter();
  const{result,setPhotoUri}=useRunResult();
  const[picking,setPicking]=useState(false);
  if(!result)return <FigmaScreen/>;
  const r=result.record;
  const minutes=Math.round(r.durationSec/60);
  const avg=r.avgCadence??160;

  const openPhoto = async (source: 'camera' | 'library') => {
    if (picking) return;
    setPicking(true);
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          source === 'camera' ? '카메라 권한이 필요해요' : '사진 접근 권한이 필요해요',
          '설정에서 권한을 허용하면 사진을 결과 이미지에 넣을 수 있어요.',
          [{ text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => void Linking.openSettings() }],
        );
        return;
      }
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [9, 16], mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [9, 16], mediaTypes: ['images'], quality: 0.9 });
      if (picked.canceled || !picked.assets[0]?.uri) return;
      setPhotoUri(picked.assets[0].uri);
      router.push('/run/image');
    } catch {
      Alert.alert('사진을 불러오지 못했어요', '러닝 기록은 그대로 저장되어 있어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPicking(false);
    }
  };

  return <FigmaScreen><FigmaBack onPress={()=>router.dismissTo('/')}/><FigmaLogo centered top={25}/><Ionicons color={colors.primary} name="checkmark" size={54} style={styles.check}/><Text style={styles.title}>오늘의 러닝 완료!</Text><Text style={styles.copy}>무리하지 않고 나만의 리듬으로{`\n`}끝까지 완주해냈어요.</Text><View style={styles.summary}><Row label="총 달린 시간" value={`${minutes}분`}/><Row label="평균 케이던스" value={`${avg} SPM`} accent/><Row label="목표 리듬 유지율" value="100%"/></View><Text style={styles.photoTitle}>사진으로 오늘의 러닝 남기기</Text><Text style={styles.photoCopy}>직접 찍거나 고른 사진이 결과 이미지의 배경이 됩니다.</Text><Pressable disabled={picking} onPress={()=>void openPhoto('camera')} style={({pressed})=>[styles.camera,(pressed||picking)&&styles.pressed]}><Text style={styles.smallButton}>사진 찍기</Text></Pressable><Pressable disabled={picking} onPress={()=>void openPhoto('library')} style={({pressed})=>[styles.gallery,(pressed||picking)&&styles.pressed]}><Text style={styles.smallButton}>사진 선택</Text></Pressable><Pressable onPress={()=>router.push('/run/report')} style={({pressed})=>[styles.report,pressed&&styles.buttonPressed]}><Text style={styles.reportText}>사진 없이 리포트 보기</Text></Pressable></FigmaScreen>
}
function Row({label,value,accent=false}:{label:string;value:string;accent?:boolean}){return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.rowValue,accent&&{color:colors.primary}]}>{value}</Text></View>}
const styles=StyleSheet.create({check:{position:'absolute',top:135,alignSelf:'center'},title:{position:'absolute',top:217,alignSelf:'center',color:colors.white,fontSize:28,fontWeight:'800'},copy:{position:'absolute',top:271,alignSelf:'center',color:colors.textMuted,fontSize:16,lineHeight:22,textAlign:'center'},summary:{position:'absolute',left:55,right:52,top:358,height:158,borderRadius:30,borderWidth:.5,borderColor:'rgba(221,224,225,.5)',backgroundColor:'rgba(221,224,225,.1)',paddingHorizontal:22,paddingVertical:16},row:{height:39,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},label:{color:colors.white,fontSize:15},rowValue:{color:colors.white,fontSize:15,fontWeight:'700'},photoTitle:{position:'absolute',left:50,top:546,color:colors.white,fontSize:17,fontWeight:'700'},photoCopy:{position:'absolute',left:50,top:572,color:'rgba(221,224,225,.65)',fontSize:12},camera:{position:'absolute',left:50,top:598,width:142,height:43,borderRadius:14,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},gallery:{position:'absolute',right:52,top:598,width:142,height:43,borderRadius:14,borderWidth:.5,borderColor:'rgba(221,224,225,.5)',alignItems:'center',justifyContent:'center'},pressed:{opacity:.65,transform:[{scale:.97}]},buttonPressed:{opacity:.72,transform:[{scale:.98}]},smallButton:{color:colors.white,fontSize:15,fontWeight:'700'},report:{position:'absolute',left:50,right:52,top:679,height:52,borderRadius:18,borderWidth:.5,borderColor:colors.white,alignItems:'center',justifyContent:'center'},reportText:{color:colors.white,fontSize:17,fontWeight:'700'}});
