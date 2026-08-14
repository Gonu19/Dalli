export const colors = {
  background: '#F7F8F6',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF3F0',
  text: '#17211C',
  textMuted: '#66736C',
  primary: '#1E6B4E',
  primaryPressed: '#17533D',
  primarySoft: '#DCECE4',
  accent: '#E76F51',
  border: '#D8E0DB',
  disabled: '#AEB8B2',
  danger: '#B54434',
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
  md: 16,
  lg: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 44, fontWeight: '700' as const },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' as const },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  button: { fontSize: 17, lineHeight: 24, fontWeight: '700' as const },
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
