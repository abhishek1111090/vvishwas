import './Card.css';

// CONVERSION NOTE: CardContainer.swift read `@Environment(\.colorScheme)`
// to pick a stronger shadow in dark mode. We don't need that branch in
// React at all — `--shadow-color` is already a different value in dark
// mode via theme.css's `prefers-color-scheme` block, so the same CSS rule
// below just picks up the right one automatically.

export function Card({ children, padding, className = '', style, ...rest }) {
  return (
    <div
      className={['v-card', className].filter(Boolean).join(' ')}
      style={{ padding: padding ?? 'var(--space-md)', ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
