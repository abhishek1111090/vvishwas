// theme.js
// --------
// VISHWAS design system: "Lime Studio" — light lime canvas, stone-grey
// cards, black pills, red only for SOS / danger, green for "safe", amber for
// "needs attention". Archivo Black for headings, Inter for everything else.
//
// The legacy key names (accent, emergency, backgroundSecondary, …) are kept
// as aliases so older call sites keep working.

// "Lime Studio" — the app's look, taken from the reference video: a soft
// lime-green canvas with slowly drifting light, pale stone-grey cards with
// big radii, heavy black wide headings, black pill / round buttons, and a
// neon-lime accent. Red stays reserved for SOS.
const light = {
  ink: '#0B0B0B',            // primary actions, active tab, black pills
  onInk: '#FFFFFF',
  background: '#EEF6E6',     // app canvas (under the drifting lime light)
  surface: '#E8EBE4',        // cards — pale stone grey like the reference device
  surfaceMuted: '#DCE1D6',   // inputs, icon wells, segmented controls
  border: 'rgba(11,14,8,0.08)',
  separator: 'rgba(11,14,8,0.07)',
  textPrimary: '#0B0B0B',
  textSecondary: '#555A50',
  textTertiary: '#8B9184',
  danger: '#FF2E3A',
  dangerDeep: '#B3121C',
  dangerTint: '#FFE2E3',
  safe: '#2E9E3F',           // readable green for text on light surfaces
  safeTint: '#D9F3CB',
  lime: '#8EE65B',           // neon accent (the reference's green)
  limeSoft: '#C8F2A6',
  warning: '#B86A00',
  warningTint: '#FBEACC',
  scrim: 'rgba(11,14,8,0.38)',
  shadow: 'rgba(30,50,20,0.14)',
  navBg: 'rgba(255,255,255,0.72)',
};

// "Sentinel Night" — used only by the emergency screen, so an active SOS
// reads as a different, unmistakable mode.
const dark = {
  ink: '#FFFFFF',
  onInk: '#0A0A0B',
  background: '#08080A',
  surface: '#131316',
  surfaceMuted: '#1D1D22',
  border: '#26262D',
  separator: '#1F1F25',
  textPrimary: '#F6F6F7',
  textSecondary: '#9C9CA6',
  textTertiary: '#62626C',
  danger: '#FF2E3A',
  dangerDeep: '#A50F19',
  dangerTint: '#2B0D10',
  safe: '#2DD46B',
  safeTint: '#0D2A18',
  warning: '#F5A524',
  warningTint: '#2E220C',
  scrim: 'rgba(0,0,0,0.72)',
  shadow: 'rgba(0,0,0,0.6)',
  navBg: '#0C0C0F',
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
export const radius = { small: 12, medium: 18, large: 28, pill: 999 };

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  display: 'ArchivoBlack_400Regular', // wide heavy grotesk for headings (reference video)
};

/** Type scale. Custom fonts carry their own weight — never combine with fontWeight. */
export const font = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.6, textTransform: 'uppercase' },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.3, textTransform: 'uppercase' },
  headline: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  subheadline: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' },
  sosLabel: { fontFamily: fonts.heavy, fontSize: 34, letterSpacing: 1.5 },
};

export const elevation = {
  card: { shadowColor: '#2F4A1E', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  glow: (color) => ({ shadowColor: color, shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 10 }),
  raised: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
};

/** The app's look is "Lime Studio" (light). The SOS screen uses `palettes.dark` directly. */
export function useTheme() {
  return { colors: palettes.light, spacing, radius, font, fonts, elevation, isDark: false };
}

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)' */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
