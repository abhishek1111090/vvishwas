import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { SecondaryButton, VText } from '../components/ui';
import { SignUpSheet, SignInSheet } from '../features/auth/AuthSheets';
import { useTheme, spacing } from '../theme/theme';

// Welcome / auth screen — mirrors WelcomeAuthView.swift. "Sign in with
// Apple" is not shown: it needs an Apple Developer team and a dev build,
// and the old placeholder created an unauthenticated session.

export default function Welcome() {
  const { colors } = useTheme();
  const router = useRouter();
  const { isLocalOnly, isAuthenticated } = useAuth();
  const { hasCompletedOnboarding } = useAppState();
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  if (!hasCompletedOnboarding) return <Redirect href="/onboarding" />;
  if (isAuthenticated && !showSignIn && !showSignUp) return <Redirect href="/home" />;

  function goHome() {
    setShowSignIn(false);
    setShowSignUp(false);
    router.replace('/home');
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.brand}>
        <ShieldCheck size={64} color={colors.accent} strokeWidth={1.75} />
        <VText variant="display">VISHWAS</VText>
        <VText variant="subheadline" secondary>Women’s Safety &amp; Emergency Response</VText>
      </View>

      <View style={styles.actions}>
        <SecondaryButton onPress={() => setShowSignUp(true)}>Continue with Email</SecondaryButton>
        <Pressable accessibilityRole="button" onPress={() => setShowSignIn(true)} style={styles.existing}>
          <VText variant="subheadline" color={colors.accent}>I already have an account</VText>
        </Pressable>
        {isLocalOnly && (
          <VText variant="caption" secondary style={{ textAlign: 'center' }}>
            Your account is stored securely on this phone only.
          </VText>
        )}
      </View>

      <SignUpSheet isOpen={showSignUp} onClose={() => setShowSignUp(false)} onSuccess={goHome} />
      <SignInSheet isOpen={showSignIn} onClose={() => setShowSignIn(false)} onSuccess={goHome} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl * 1.5 },
  actions: { gap: spacing.md, paddingBottom: spacing.md },
  existing: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
