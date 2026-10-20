import { VFont } from '../design-system/theme';
import './LabeledField.css';

/**
 * Shared labeled text field used across the auth forms.
 * Mirrors `LabeledField` (defined inline in SignUpView.swift, used by
 * SignUpView/SignInView/ForgotPasswordView).
 */
export function LabeledField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  placeholder = '',
  ...rest
}) {
  return (
    <label className="v-field">
      <span className={['v-field__label', VFont.caption].join(' ')}>{label}</span>
      <input
        className="v-field__input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoCapitalize={type === 'email' ? 'none' : 'words'}
        autoCorrect={type === 'email' ? 'off' : 'on'}
        {...rest}
      />
    </label>
  );
}
