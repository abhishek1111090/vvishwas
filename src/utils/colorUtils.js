/**
 * colorUtils.js — Safari-safe inline color helpers
 *
 * CSS `color-mix(in srgb, ...)` requires iOS 16.4+. For components that
 * compute tint backgrounds via inline JS styles (StatusPill, ContactRow,
 * IconBadge), we compute rgba() directly instead — supported on every iOS
 * Safari version since iOS 6.
 *
 * Supports:
 *   #rrggbb   #rgb   hex strings
 *   rgb(r,g,b)  rgba(r,g,b,a)  strings
 *   named CSS variables are returned as-is (caller's responsibility)
 */

export function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

/**
 * Returns a CSS rgba() string for the given color at the given opacity.
 * Falls back to color-mix() only for CSS-variable strings like var(--color-*).
 *
 * @param {string} color  - hex (#fff / #ffffff), rgb(...), or CSS var(...)
 * @param {number} alpha  - 0–1
 * @returns {string} CSS color value
 */
export function withAlpha(color, alpha) {
  if (!color) return `rgba(0,0,0,${alpha})`;

  // Hex
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }

  // rgb(...) / rgba(...)
  if (color.startsWith('rgb')) {
    const nums = color.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
    }
  }

  // Hardcoded CSS-variable fallbacks used by the design system
  const varFallbacks = {
    'var(--color-accent)':     `rgba(88,86,214,${alpha})`,
    'var(--color-emergency)':  `rgba(224,32,58,${alpha})`,
    'var(--color-safe)':       `rgba(52,199,89,${alpha})`,
    'var(--color-warning)':    `rgba(255,149,0,${alpha})`,
  };
  if (varFallbacks[color]) return varFallbacks[color];

  // Named fallback strings used directly in components
  const namedFallbacks = {
    '#0a84ff': `rgba(10,132,255,${alpha})`,
    '#af52de': `rgba(175,82,222,${alpha})`,
    '#ffcc00': `rgba(255,204,0,${alpha})`,
  };
  if (namedFallbacks[color]) return namedFallbacks[color];

  // Last resort: let the browser handle it (Safari 16.4+ color-mix)
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
