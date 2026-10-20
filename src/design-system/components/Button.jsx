import { VFont } from '../theme';
import './Button.css';

// CONVERSION NOTE (SwiftUI -> React): PrimaryButtonStyle/SecondaryButtonStyle
// were Swift `ButtonStyle`s — reusable *style* objects applied to any
// `Button`'s label. React doesn't have a style-only equivalent, so these
// become small wrapper components instead. They keep the same press-state
// scale animation (CSS `:active` transform instead of SwiftUI's
// `configuration.isPressed` + spring animation).

/**
 * Full-width filled button — primary calls to action (Continue, Sign In, Save Contact…).
 */
export function PrimaryButton({
  children,
  destructive = false,
  disabled = false,
  type = 'button',
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        'v-btn',
        'v-btn--primary',
        VFont.headline,
        destructive ? 'v-btn--destructive' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Outlined, lower-emphasis button — secondary actions (Skip, Cancel, Edit…).
 */
export function SecondaryButton({ children, disabled = false, type = 'button', className = '', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={['v-btn', 'v-btn--secondary', VFont.headline, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
