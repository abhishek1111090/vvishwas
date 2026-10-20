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
  error = null,
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
        autoCapitalize={type === 'text' ? 'words' : 'none'}
        autoCorrect={type === 'text' ? 'on' : 'off'}
        spellCheck={type === 'text'}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error && <span className="v-field__error" role="alert">{error}</span>}
    </label>
  );
}
