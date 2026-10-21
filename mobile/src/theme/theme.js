import { useColorScheme } from 'react-native';

// theme.js
// --------
// The VISHWAS design tokens (same values as the web app's theme.css, which
// itself mirrored the original iOS Asset Catalog). React Native has no CSS
// variables, so light/dark palettes are plain objects and useTheme()
// picks one from the OS appearance setting.

const light = {
  accent: '#5856d6',
  emergency: '#e0203a',
  safe: '#34c759',
  warning: '#ff9500',
  info: '#0a84ff',
  purple: '#af52de',
  gold: '#ffcc00',
  background: '#ffffff',
  backgroundSecondary: '#f2f2f7',
  backgroundTertiary: '#ffffff',
  textPrimary: '#000000',
  textSecondary: 'rgba(60,60,67,0.6)',
  separator: 'rgba(60,60,67,0.29)',
  scrim: 'rgba(0,0,0,0.4)',
  shadow: 'rgba(0,0,0,0.08)',
  navBg: 'rgba(255,255,255,0.96)',
};

const dark = {
  ...light,
  accent: '#7d7aff',
  emergency: '#ff375f',
  safe: '#30d158',
  warning: '#ff9f0a',
  background: '#0a0b10',
  backgroundSecondary: '#16171f',
  backgroundTertiary: '#22232e',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(235,235,245,0.65)',
  separator: 'rgba(84,84,88,0.5)',
  scrim: 'rgba(0,0,0,0.7)',
  shadow: 'rgba(0,0,0,0.45)',
  navBg: 'rgba(16,17,24,0.96)',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { small: 10, medium: 16, large: 24, pill: 999 };

/** Typography scale — mirrors VFont (display, title, headline, …). */
export const font = {
  display: { fontSize: 34, fontWeight: '800', lineHeight: 40 },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  headline: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 23 },
  subheadline: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  sosLabel: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
};

export const palettes = { light, dark };

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? dark : light;
  return { colors, spacing, radius, font, isDark: scheme === 'dark' };
}

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)' (used for tinted badge backgrounds). */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
