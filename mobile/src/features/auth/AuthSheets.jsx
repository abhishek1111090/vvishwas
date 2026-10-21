import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { BottomSheet, SheetHeader } from '../../components/BottomSheet';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton, VText } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { isValidEmail, isNonEmpty, isStrongEnoughPassword, LIMITS } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import { useTheme } from '../../theme/theme';

// Sign Up / Sign In / Forgot Password sheets — mirrors SignUpView.swift,
// SignInView.swift and ForgotPasswordView.swift. Validation runs before
// any request so users get specific messages, then service errors
// (duplicate email, wrong password, storage full) are shown as-is.

function ErrorText({ children }) {
  const { colors } = useTheme();
  if (!children) return null;
  return <VText variant="caption" color={colors.emergency} accessibilityRole="alert">{children}</VText>;
}

export function SignUpSheet({ isOpen, onClose, onSuccess }) {
  const { signUp, isLoading, errorMessage, clearError } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);

  async function submit() {
    setLocalError(null);
    clearError();
    if (!isNonEmpty(fullName)) return setLocalError('Please enter your name.');
    if (!isValidEmail(email)) return setLocalError('Please enter a valid email address.');
    if (!isStrongEnoughPassword(password)) return setLocalError('Password must be 8–128 characters.');
    const user = await signUp({ fullName, email, password });
    if (user) {
      haptics.success();
      onSuccess();
    } else {
      haptics.error();
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} testID="signup-sheet">
      <SheetHeader title="Create Account" onClose={onClose} />
      <LabeledField label="Full Name" kind="name" value={fullName} onChangeText={setFullName} maxLength={LIMITS.nameMax} />
      <LabeledField label="Email" kind="email" value={email} onChangeText={setEmail} />
      <LabeledField label="Password" kind="newPassword" value={password} onChangeText={setPassword} maxLength={LIMITS.passwordMax} onSubmitEditing={submit} returnKeyType="go" />
      <VText variant="caption" secondary>At least 8 characters</VText>
      <ErrorText>{localError ?? errorMessage}</ErrorText>
      <PrimaryButton onPress={submit} loading={isLoading}>{isLoading ? 'Creating Account…' : 'Create Account'}</PrimaryButton>
    </BottomSheet>
  );
}

export function SignInSheet({ isOpen, onClose, onSuccess }) {
  const { colors } = useTheme();
  const { signIn, isLoading, errorMessage, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const [showForgot, setShowForgot] = useState(false);

  async function submit() {
    setLocalError(null);
    clearError();
    if (!isValidEmail(email)) return setLocalError('Please enter a valid email address.');
    const user = await signIn({ email, password });
    if (user) {
      haptics.success();
      onSuccess();
    } else {
      haptics.error();
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} testID="signin-sheet">
      <SheetHeader title="Sign In" onClose={onClose} />
      <LabeledField label="Email" kind="email" value={email} onChangeText={setEmail} />
      <LabeledField label="Password" kind="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} returnKeyType="go" />
      <Pressable accessibilityRole="button" onPress={() => setShowForgot(true)} hitSlop={8} style={styles.link}>
        <VText variant="caption" color={colors.accent}>Forgot Password?</VText>
      </Pressable>
      <ErrorText>{localError ?? errorMessage}</ErrorText>
      <PrimaryButton onPress={submit} loading={isLoading}>{isLoading ? 'Signing In…' : 'Sign In'}</PrimaryButton>
      <ForgotPasswordSheet isOpen={showForgot} onClose={() => setShowForgot(false)} />
    </BottomSheet>
  );
}

export function ForgotPasswordSheet({ isOpen, onClose }) {
  const { colors } = useTheme();
  const { sendPasswordReset, isLoading, errorMessage, clearError, canResetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState(null);
  const [sent, setSent] = useState(false);

  function close() {
    onClose();
    setSent(false);
    setEmail('');
  }

  async function submit() {
    setLocalError(null);
    clearError();
    if (!isValidEmail(email)) return setLocalError('Please enter a valid email address.');
    if (await sendPasswordReset({ email })) setSent(true);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close} testID="forgot-sheet">
      <SheetHeader title="" onClose={close} closeLabel="Close" />
      {sent ? (
        <View style={styles.center}>
          <CheckCircle2 size={44} color={colors.safe} />
          <VText variant="title">Check Your Email</VText>
          <VText variant="subheadline" secondary style={{ textAlign: 'center' }}>
            If an account exists for {email}, the server has sent reset instructions.
          </VText>
          <PrimaryButton onPress={close}>Done</PrimaryButton>
        </View>
      ) : (
        <>
          <VText variant="title">Reset Password</VText>
          <VText variant="subheadline" secondary>Enter the email associated with your account.</VText>
          {!canResetPassword && (
            <VText variant="caption" secondary>
              Email password reset needs the VISHWAS server, which isn’t set up in this build. Accounts are stored only on this phone.
            </VText>
          )}
          <LabeledField label="Email" kind="email" value={email} onChangeText={setEmail} />
          <ErrorText>{localError ?? errorMessage}</ErrorText>
          <PrimaryButton onPress={submit} loading={isLoading}>{isLoading ? 'Sending…' : 'Send Reset Link'}</PrimaryButton>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' },
  center: { alignItems: 'center', gap: 12 },
});
