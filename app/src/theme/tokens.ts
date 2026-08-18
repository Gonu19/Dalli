export const colors = {
  background: '#1C1A1A',
  surface: '#FFFFFF',
  surfaceMuted: 'rgba(221,224,225,0.10)',
  text: '#FFFFFF',
  textMuted: 'rgba(221,224,225,0.62)',
  ink: '#1C1A1A',
  inkMuted: 'rgba(28,26,26,0.52)',
  primary: '#FF7A59',
  primaryPressed: '#D96346',
  primarySoft: 'rgba(255,122,89,0.16)',
  accent: '#FF7A59',
  success: '#48C78E',
  border: 'rgba(221,224,225,0.34)',
  disabled: '#898989',
  danger: '#FF6B6B',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 18,
  lg: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '800' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '700' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' as const },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  captionSmall: { fontSize: 11, lineHeight: 13, fontWeight: '400' as const },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
} as const;

export const shadows = {
  card: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
} as const;

/** 모든 Pressable이 홈의 `러닝 준비하기` 버튼과 같은 눌림 피드백을 사용한다. */
export const pressFeedback = {
  opacity: 0.72,
  transform: [{ scale: 0.98 }],
};

/** 작은 아이콘·칩·탭은 터치 여부가 더 분명하도록 CTA보다 강하게 반응한다. */
export const compactPressFeedback = {
  opacity: 0.6,
  transform: [{ scale: 0.94 }],
};

/** iOS safe area 바로 아래의 표준 44pt 내비게이션 영역. */
export const navigationHeader = {
  height: 44,
  titleTop: 11,
  logoTop: 5,
  backTop: 6,
  actionTop: 2,
  compactActionTop: 4,
  contentLift: 20,
} as const;
