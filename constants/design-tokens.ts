import { Fonts } from '@/constants/theme';

/**
 * アプリ全体のVisual Design System。チームメンバー「高沢さん」制作のドライブ記録・
 * 共有アプリ(dark theme・iOS native感・大きめ角丸・card-based)と同じプロダクトファミリーに
 * 見えるよう、色・角丸・余白・typographyをこのファイルへ集約する。画面・コンポーネントへ
 * 直接色コードを書かず、必ずここのトークンを参照すること。
 *
 * 今回はOSのlight/dark自動切替(useColorScheme)は導入せず、アプリ全体を固定darkにする
 * (ユーザー要求どおり)。将来light modeが必要になった場合も、参照側はトークン名だけに
 * 依存しているため、このファイルの値を差し替えるだけで済む設計にしている。
 */

export const Colors = {
  background: '#050506',
  surface: '#151517',
  surfaceElevated: '#1f1f22',
  surfaceSubtle: '#101012',

  textPrimary: '#f5f5f7',
  textSecondary: '#9a9aa2',
  textTertiary: '#6b6b73',

  accentBlue: '#4da3ff',
  accentBlueMuted: 'rgba(77, 163, 255, 0.16)',
  accentRed: '#ff6b5e',
  accentRedMuted: 'rgba(255, 107, 94, 0.16)',

  success: '#4cd471',
  successMuted: 'rgba(76, 212, 113, 0.14)',
  warning: '#f5b84c',
  warningMuted: 'rgba(245, 184, 76, 0.14)',
  divider: 'rgba(255, 255, 255, 0.08)',
  overlay: 'rgba(0, 0, 0, 0.55)',

  onAccent: '#03101c',
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

type TextStyleToken = {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  lineHeight: number;
};

export const Typography: Record<
  'screenTitle' | 'sectionTitle' | 'cardTitle' | 'body' | 'secondary' | 'caption' | 'button' | 'metricLarge',
  TextStyleToken
> = {
  screenTitle: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  sectionTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardTitle: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  secondary: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  button: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  metricLarge: { fontSize: 22, fontWeight: '800', lineHeight: 27 },
};

/** iOS system font中心(既存constants/theme.tsのFontsを再利用)。 */
export const FontFamily = Fonts;
