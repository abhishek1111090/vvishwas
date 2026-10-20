import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

// AppStateContext.jsx
// --------------------
// CONVERSION NOTE: the onboarding-complete flag half of AppState.swift
// (the user/session half lives in AuthContext — see that file's comment
// for why they're split this way). `didSet { UserDefaults... }` becomes a
// plain `useState` + `useCallback` that writes through to localStorage.

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() =>
    readJSON(STORAGE_KEYS.onboardingComplete, false)
  );

  const completeOnboarding = useCallback(() => {
    setHasCompletedOnboarding(true);
    writeJSON(STORAGE_KEYS.onboardingComplete, true);
  }, []);

  const value = useMemo(
    () => ({ hasCompletedOnboarding, completeOnboarding }),
    [hasCompletedOnboarding, completeOnboarding]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within an AppStateProvider');
  return ctx;
}
