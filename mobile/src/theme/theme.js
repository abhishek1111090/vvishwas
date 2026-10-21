import { useColorScheme } from 'react-native';

// theme.js
// --------
// VISHWAS "Kinetic Sentinel" design system: monochrome (ink black on
// white) with colour used only as a signal — red for SOS / danger, green
// for "safe", amber for "needs attention". Inter type throughout.
//
// The legacy key names (accent, emergency, backgroundSecondary, …) are kept
// as aliases so older call sites keep working.

const light = {
  ink: '#0A0A0A',            // primary actions, active tab, badges
  onInk: '#FFFFFF',
  background: '#F6F6F7',     // app canvas
  surface: '#FFFFFF',        // cards
  surfaceMuted: '#F0F0F2',   // inputs, icon wells, segmented controls
  border: '#E7E7EA',
  separator: '#E7E7EA',
  textPrimary: '#0A0A0A',
  textSecondary: '#6B6B73',
  textTertiary: '#A1A1A8',
  danger: '#E5282E',
  dangerDeep: '#B5161C',
  dangerTint: '#FDECEC',
  safe: '#16A34A',
  safeTint: '#E7F6EC',
  warning: '#D97706',
  warningTint: '#FDF3E3',
  scrim: 'rgba(10,10,10,0.45)',
  shadow: 'rgba(10,10,10,0.06)',
  navBg: '#FFFFFF',
};

const dark = {
  ink: '#FFFFFF',
  onInk: '#0A0A0A',
  background: '#0A0A0B',
  surface: '#151517',
  surfaceMuted: '#1F1F23',
  border: '#2A2A2F',
  separator: '#2A2A2F',
  textPrimary: '#F5F5F6',
  textSecondary: '#A1A1A8',
  textTertiary: '#6B6B73',
  danger: '#FF3B40',
  dangerDeep: '#C8141B',
  dangerTint: '#3A1314',
  safe: '#22C55E',
  safeTint: '#10301C',
  warning: '#F59E0B',
  warningTint: '#33240C',
  scrim: 'rgba(0,0,0,0.7)',
  shadow: 'rgba(0,0,0,0.5)',
  navBg: '#0F0F11',
};

function withAliases(p) {
  return {
    ...p,
    accent: p.ink,
    emergency: p.danger,
    backgroundSecondary: p.surfaceMuted,
    backgroundTertiary: p.surface,
    info: p.ink,
    gold: '#F5B400',
  };
}

export const palettes = { light: withAliases(light), dark: withAliases(dark) };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { small: 12, medium: 16, large: 22, pill: 999 };

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
};

/** Type scale. Custom fonts carry their own weight — never combine with fontWeight. */
export const font = {
  display: { fontFamily: fonts.heavy, fontSize: 32, lineHeight: 38, letterSpacing: -0.9 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  headline: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  subheadline: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' },
  sosLabel: { fontFamily: fonts.heavy, fontSize: 34, letterSpacing: 1.5 },
};

export const elevation = {
  card: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  raised: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
};

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? palettes.dark : palettes.light, spacing, radius, font, fonts, elevation, isDark };
}

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)' */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
