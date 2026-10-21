import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShieldCheck } from 'lucide-react-native';
import { initStorage } from '../utils/storage';
import { authService } from '../services/authService';
import { emergencyManager } from '../services/emergencyManager';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppStateProvider } from '../context/AppStateContext';
import { AuthProvider } from '../context/AuthContext';
import { PermissionsProvider } from '../context/PermissionsContext';
import { ContactsProvider } from '../context/ContactsContext';
import { EmergencyProvider } from '../context/EmergencyContext';
import { useTheme } from '../theme/theme';

// Root layout — loads local storage and the saved session BEFORE any screen
// renders, so screens can read state synchronously (mirrors
// VISHWASApp.swift's @main + AppState.init()).

export default function RootLayout() {
  const { colors } = useTheme();
  const [boot, setBoot] = useState({ ready: false, user: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user = null;
      try {
        await initStorage();
        emergencyManager.hydrate();
        user = await authService.restoreSession();
      } catch (err) {
        console.warn('[VISHWAS] startup storage error', err?.message);
      }
      if (!cancelled) setBoot({ ready: true, user });
    })();
    return () => { cancelled = true; };
  }, []);

  if (!boot.ready) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.accent }]}>
        <ShieldCheck size={64} color="#fff" strokeWidth={1.75} />
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppStateProvider>
          <AuthProvider initialUser={boot.user}>
            <PermissionsProvider>
              <ContactsProvider>
                <EmergencyProvider>
                  <StatusBar style="auto" />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
                </EmergencyProvider>
              </ContactsProvider>
            </PermissionsProvider>
          </AuthProvider>
        </AppStateProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
