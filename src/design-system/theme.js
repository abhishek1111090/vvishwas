// theme.js
// --------
// CONVERSION NOTE (SwiftUI -> React): VTheme/VFont were Swift enums of
// static tokens. Most of that lives in theme.css now (CSS handles
// dark/light automatically, which a JS object can't do on its own), but a
// few places in the app need the *values* in JS — e.g. computing concentric
// ring sizes for the pulsing SOS button, or picking a tint color
// programmatically for a quick-action tile. This file is that JS-readable
// mirror; it intentionally references the same CSS custom properties as
// theme.css rather than duplicating literal hex values, so there's exactly
// one source of truth for color.

export const VTheme = {
  colors: {
    accent: 'var(--color-accent)',
    emergency: 'var(--color-emergency)',
    safe: 'var(--color-safe)',
    warning: 'var(--color-warning)',
    background: 'var(--color-background)',
    backgroundSecondary: 'var(--color-background-secondary)',
    backgroundTertiary: 'var(--color-background-tertiary)',
    textPrimary: 'var(--color-text-primary)',
    textSecondary: 'var(--color-text-secondary)',
    separator: 'var(--color-separator)',
  },

  // 4pt grid — mirrors VTheme.Spacing
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  // mirrors VTheme.Radius
  radius: {
    small: 10,
    medium: 16,
    large: 24,
    pill: 999,
  },
};

// Typography scale — mirrors VFont. Each maps to a utility class defined
// in typography.css (Dynamic Type doesn't exist on the web, but using rem
// units + the user's browser font-size setting gets us the closest
// equivalent: text that respects the reader's own accessibility settings).
export const VFont = {
  display: 'v-font-display',
  title: 'v-font-title',
  headline: 'v-font-headline',
  body: 'v-font-body',
  subheadline: 'v-font-subheadline',
  caption: 'v-font-caption',
  sosLabel: 'v-font-sos-label',
};
