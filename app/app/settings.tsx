import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { FigmaButton, FigmaLogo, FigmaScreen } from '@/src/components/figma-ui';
import { HapticPressable as Pressable } from '@/src/components/haptics';
import { useProfile } from '@/src/api/queries';
import { useAuth } from '@/src/components/auth-provider';
import { useSimulationStore } from '@/src/store/simulation';
import { colors, navigationHeader, pressFeedback, typography } from '@/src/theme/tokens';

export default function Settings() {
  const router = useRouter();
  const { token } = useAuth();
  const profile = useProfile(token);
  const startSimulation = useSimulationStore((state) => state.start);

  // 시연 폴백 (`ROADMAP.md` §6). 야외 촬영이 실패하면 이 경로로 시연한다.
  // 실센서 대신 리플레이를 물릴 뿐 화면·판정·오디오는 실러닝과 같은 경로다.
  const runSimulation = () => {
    startSimulation({
      scenario: 'demo',
      referenceCadence: profile.data?.baselineCadence ?? 157,
      condition: 3,
    });
    router.push('/run/active');
  };

  return (
    <FigmaScreen>
      <FigmaLogo left={31} />
      <Text style={styles.header}>설정</Text>
      <Text style={styles.section}>개인 설정</Text>
      <Row label="개인정보 수정" onPress={() => router.push('/privacy')} />
      <View style={styles.line} />
      <Text style={[styles.section, { top: 280 - navigationHeader.contentLift }]}>앱 설정</Text>
      <Row label="러닝 가이드 방식" top={313 - navigationHeader.contentLift} onPress={() => router.push('/guide')} />
      <Pressable onPress={runSimulation} style={({ pressed }) => [styles.demo, pressed && styles.pressed]}>
        <Text style={styles.demoText}>시연 모드로 러닝 재생</Text>
      </Pressable>
      <FigmaButton onPress={() => router.back()} style={styles.button}>닫기</FigmaButton>
    </FigmaScreen>
  );
}

function Row({ label, onPress, top = 150 - navigationHeader.contentLift }: { label: string; onPress: () => void; top?: number }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { top }, pressed && styles.pressed]}>
      <Text style={styles.rowText}>{label}</Text>
      <Ionicons color={colors.white} name="chevron-forward" size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { ...typography.headline, position: 'absolute', top: navigationHeader.titleTop, alignSelf: 'center', color: colors.white },
  section: { ...typography.headline, position: 'absolute', left: 33, top: 111 - navigationHeader.contentLift, color: colors.white },
  row: { position: 'absolute', left: 30, right: 30, height: 40, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.4)', backgroundColor: 'transparent', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: pressFeedback,
  rowText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  line: { position: 'absolute', left: 33, right: 32, top: 234 - navigationHeader.contentLift, height: 1, backgroundColor: 'rgba(255,255,255,.35)' },
  demo: { position: 'absolute', left: 30, right: 30, top: 383 - navigationHeader.contentLift, height: 40, alignItems: 'center', justifyContent: 'center' },
  demoText: { color: 'rgba(255,255,255,.55)', fontSize: 13, textDecorationLine: 'underline' },
  button: { top: 697 },
});
