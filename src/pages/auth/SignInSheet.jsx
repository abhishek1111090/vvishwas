import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { useAuth } from '../../context/AuthContext';
import { isValidEmail } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import { ForgotPasswordSheet } from './ForgotPasswordSheet';

// SignInSheet.jsx
// ----------------
// CONVERSION NOTE: mirrors SignInView.swift, including its own nested
// `.sheet(isPresented: $showForgotPassword)` — reproduced here as a
// `showForgotPassword` state flag rendering <ForgotPasswordSheet>, a sheet
// stacked on top of a sheet, exactly like the original.

export function SignInSheet({ isOpen, onClose }) {
  const { signIn, isLoading, errorMessage, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const displayedError = localError ?? errorMessage;

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!isValidEmail(email)) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    const user = await signIn({ email, password });
    if (user) {
      haptics.success();
      onClose();
      navigate('/home', { replace: true });
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <SheetHeader title="Sign In" onClose={onClose} />
      <form className="v-auth-form" onSubmit={handleSubmit} noValidate>
        <LabeledField label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
        <LabeledField
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
        />

        <button
          type="button"
          className={['v-auth-forgot-link', VFont.caption].join(' ')}
          onClick={() => setShowForgotPassword(true)}
        >
          Forgot Password?
        </button>

        {displayedError && <p className={['v-auth-error', VFont.caption].join(' ')}>{displayedError}</p>}

        <PrimaryButton type="submit" disabled={isLoading}>
          {isLoading ? 'Signing In…' : 'Sign In'}
        </PrimaryButton>
      </form>

      <ForgotPasswordSheet isOpen={showForgotPassword} onClose={() => setShowForgotPassword(false)} />
    </BottomSheet>
  );
}
