import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text } from 'react-native';

import { FigmaButton, FigmaLogo, FigmaScreen } from '@/src/components/figma-ui';
import { colors } from '@/src/theme/tokens';

const runner = require('@/assets/images/onboarding-runner.png');

export default function OnboardingIntro() {
  const router = useRouter();
  return <FigmaScreen>
    <FigmaLogo centered top={45} />
    <Text style={styles.title}>달리와 처음 만나는 시간</Text>
    <Text style={styles.copy}><Text style={styles.bold}>몇 가지 질문</Text>에 답해주시면</Text>
    <Text style={styles.copy2}>나에게 맞는 <Text style={styles.accent}>러닝</Text>을 준비해 드릴게요!</Text>
    <Image resizeMode="cover" source={runner} style={styles.runner} />
    <FigmaButton onPress={() => router.push('/onboarding/experience')} style={styles.button}>시작하기</FigmaButton>
  </FigmaScreen>;
}

const styles = StyleSheet.create({
  title: { position: 'absolute', left: 27, right: 27, top: 108, color: colors.white, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  copy: { position: 'absolute', left: 27, right: 27, top: 168, color: colors.white, fontSize: 16, textAlign: 'center' },
  copy2: { position: 'absolute', left: 27, right: 27, top: 198, color: colors.white, fontSize: 16, textAlign: 'center' },
  bold: { fontWeight: '700' }, accent: { color: colors.primary, fontWeight: '700' },
  runner: { position: 'absolute', left: 0, right: 0, top: 244, width: '100%', height: 304 },
  button: { top: 608 },
});
