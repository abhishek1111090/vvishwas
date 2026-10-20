import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { useAuth } from '../../context/AuthContext';
import { isValidEmail, isNonEmpty } from '../../utils/validation';
import { haptics } from '../../services/hapticService';

// SignUpSheet.jsx
// ----------------
// CONVERSION NOTE: mirrors SignUpView.swift. Field-level validation
// (`!fullName.trimmingCharacters(in: .whitespaces).isEmpty`, `isValidEmail`)
// that lived in AuthViewModel.swift is reproduced here at the point of
// submit, same as the Swift version's `signUp()` guard chain.

export function SignUpSheet({ isOpen, onClose }) {
  const { signUp, isLoading, errorMessage, clearError } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);

  const displayedError = localError ?? errorMessage;

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!isNonEmpty(fullName)) {
      setLocalError('Please enter your name.');
      return;
    }
    if (!isValidEmail(email)) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    const user = await signUp({ fullName, email, password });
    if (user) {
      haptics.success();
      onClose();
      navigate('/home', { replace: true });
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <SheetHeader title="Create Account" onClose={onClose} />
      <form className="v-auth-form" onSubmit={handleSubmit}>
        <LabeledField label="Full Name" value={fullName} onChange={setFullName} autoComplete="name" />
        <LabeledField label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
        <LabeledField
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
        />
        <p className={['v-auth-hint', VFont.caption].join(' ')}>At least 8 characters</p>

        {displayedError && <p className={['v-auth-error', VFont.caption].join(' ')}>{displayedError}</p>}

        <PrimaryButton type="submit" disabled={isLoading}>
          {isLoading ? 'Creating Account…' : 'Create Account'}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
