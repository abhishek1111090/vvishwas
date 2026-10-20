import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { useAuth } from '../../context/AuthContext';
import { isValidEmail } from '../../utils/validation';

// ForgotPasswordSheet.jsx
// -------------------------
// CONVERSION NOTE: mirrors ForgotPasswordView.swift's two-state body (the
// form, then the "Check Your Email" confirmation once `resetEmailSent` is
// true). AuthViewModel.swift's `resetEmailSent` flag is local component
// state here since nothing else in the app needs to read it.

export function ForgotPasswordSheet({ isOpen, onClose }) {
  const { sendPasswordReset, isLoading, errorMessage, clearError, canResetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const displayedError = localError ?? errorMessage;

  function handleClose() {
    onClose();
    // Reset local state after the close animation has time to play, so the
    // sheet doesn't visibly flash back to the form before it's fully gone.
    setTimeout(() => {
      setResetEmailSent(false);
      setEmail('');
    }, 250);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!isValidEmail(email)) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    const sent = await sendPasswordReset({ email });
    if (sent) setResetEmailSent(true);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <SheetHeader title="" onClose={handleClose} closeLabel="Close" />

      {resetEmailSent ? (
        <div className="v-auth-form v-forgot-password__success">
          <CheckCircle2 size={44} color="var(--color-safe)" aria-hidden="true" />
          <h2 className={VFont.title}>Check Your Email</h2>
          <p className={VFont.subheadline}>
            If an account exists for {email}, we've sent password reset instructions.
          </p>
          <PrimaryButton onClick={handleClose}>Done</PrimaryButton>
        </div>
      ) : (
        <form className="v-auth-form" onSubmit={handleSubmit} noValidate>
          <div className="v-forgot-password__intro">
            <h2 className={VFont.title}>Reset Password</h2>
            <p className={VFont.subheadline}>Enter the email associated with your account.</p>
          </div>

          {!canResetPassword && (
            <p className={['v-auth-hint', VFont.caption].join(' ')}>
              Email password reset needs the VISHWAS server, which isn't set up in this build.
              Accounts are stored only on this device.
            </p>
          )}

          <LabeledField label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />

          {displayedError && <p className={['v-auth-error', VFont.caption].join(' ')}>{displayedError}</p>}

          <PrimaryButton type="submit" disabled={isLoading}>
            {isLoading ? 'Sending…' : 'Send Reset Link'}
          </PrimaryButton>
        </form>
      )}
    </BottomSheet>
  );
}
