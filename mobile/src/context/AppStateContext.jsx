import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

// AppStateContext — the onboarding-complete flag (mirrors AppState.swift).
// Storage is already loaded by the root layout, so the read is synchronous.

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() =>
    readJSON(STORAGE_KEYS.onboardingComplete, false)
  );

  const completeOnboarding = useCallback(() => {
    setHasCompletedOnboarding(true);
    writeJSON(STORAGE_KEYS.onboardingComplete, true);
  }, []);

  const value = useMemo(() => ({ hasCompletedOnboarding, completeOnboarding }), [hasCompletedOnboarding, completeOnboarding]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within an AppStateProvider');
  return ctx;
}
