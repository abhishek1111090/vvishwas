import { VFont } from '../theme';
import { withAlpha } from '../../utils/colorUtils';
import './StatusPill.css';

/**
 * StatusPill — small colored status indicator
 * StatusPill.css uses color-mix() for the background. This component also
 * sets an inline `color` style; the CSS picks that up via `currentColor`.
 * On browsers without color-mix (iOS < 16.4) the CSS fallback rgba() kicks in.
 */
export function StatusPill({ text, color, icon: Icon }) {
  return (
    <span className={['v-status-pill', VFont.caption].join(' ')} style={{ color }}>
      <span className="v-status-pill__dot" style={{ background: color }} aria-hidden="true" />
      {Icon ? <Icon size={12} strokeWidth={2.75} aria-hidden="true" /> : null}
      {text}
    </span>
  );
}

/**
 * IconBadge — circular icon tile
 * Replaces color-mix() inline style with withAlpha() (Safari-safe rgba).
 */
export function IconBadge({ icon: Icon, tint = 'var(--color-accent)', size = 44 }) {
  return (
    <span
      className="v-icon-badge"
      style={{
        width: size,
        height: size,
        color: tint,
        background: withAlpha(tint, 0.14),     // rgba() instead of color-mix()
        borderRadius: Math.round(size * 0.28),
      }}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}
