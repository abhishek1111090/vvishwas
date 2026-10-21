import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { ShieldCheck, Mail, Lock } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { PrimaryButton, SecondaryButton, VText } from '../components/ui';
import { SignUpSheet, SignInSheet } from '../features/auth/AuthSheets';
import { useTheme, radius, spacing } from '../theme/theme';

// Welcome / auth screen — mirrors WelcomeAuthView.swift. "Sign in with
// Apple" is not shown: it needs an Apple Developer team and a dev build,
// and the old placeholder created an unauthenticated session.

function PulsingShield() {
  const { colors } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(v);
  }, [v]);
  const ring = useAnimatedStyle(() => ({ opacity: (1 - v.value) * 0.35, transform: [{ scale: 1 + v.value * 0.6 }] }));
  return (
    <View style={styles.shieldStage}>
      <Animated.View style={[styles.shieldRing, { backgroundColor: colors.ink }, ring]} />
      <View style={[styles.shield, { backgroundColor: colors.ink }]}>
        <ShieldCheck size={44} color={colors.onInk} strokeWidth={1.9} />
      </View>
    </View>
  );
}

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
      <Animated.View entering={FadeIn.duration(500)} style={styles.brand}>
        <PulsingShield />
        <VText variant="display" style={{ fontSize: 38, letterSpacing: 1 }}>VISHWAS</VText>
        <VText variant="subheadline" secondary>Women’s Safety &amp; Emergency Response</VText>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(500).delay(200)} style={styles.actions}>
        <PrimaryButton icon={Mail} onPress={() => setShowSignUp(true)}>Continue with Email</PrimaryButton>
        <SecondaryButton onPress={() => setShowSignIn(true)}>I already have an account</SecondaryButton>
        {isLocalOnly && (
          <View style={styles.note}>
            <Lock size={12} color={colors.textTertiary} />
            <VText variant="caption" tertiary>Your account is stored securely on this phone only.</VText>
          </View>
        )}
      </Animated.View>

      <SignUpSheet isOpen={showSignUp} onClose={() => setShowSignUp(false)} onSuccess={goHome} />
      <SignInSheet isOpen={showSignIn} onClose={() => setShowSignIn(false)} onSuccess={goHome} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl * 1.6 },
  shieldStage: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  shieldRing: { position: 'absolute', width: 100, height: 100, borderRadius: 32 },
  shield: { width: 100, height: 100, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 12, paddingBottom: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, borderRadius: radius.pill },
});
