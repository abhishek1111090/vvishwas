import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { authService } from '../services/authService';

// AuthContext.jsx
// ---------------
// CONVERSION NOTE (SwiftUI -> React): combines what AppState.swift owned
// (currentUser, isAuthenticated, signIn/signOut) with the *mechanics* of
// AuthViewModel.swift (calling AuthService, surfacing errors) into one
// Context, since in React the idiomatic place for both is the same
// provider — SwiftUI split it across `@Environment(AppState.self)` and a
// per-screen `@State private var viewModel = AuthViewModel()` partly
// because @Observable classes are cheap to scope locally; React Context
// is coarser-grained, so consolidating avoids prop-drilling a second
// object everywhere AppState already needs to be read.

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Mirrors `AppState.init()` calling `AuthService.shared.restoreSession()`
  // synchronously at launch.
  const [currentUser, setCurrentUser] = useState(() => authService.restoreSession());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const isAuthenticated = currentUser !== null;

  const clearError = useCallback(() => setErrorMessage(null), []);

  const signUp = useCallback(async ({ fullName, email, password }) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = await authService.signUp({ fullName, email, password });
      setCurrentUser(user);
      return user;
    } catch (err) {
      setErrorMessage(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = await authService.signIn({ email, password });
      setCurrentUser(user);
      return user;
    } catch (err) {
      setErrorMessage(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signInWithApple = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = await authService.signInWithApplePlaceholder();
      setCurrentUser(user);
      return user;
    } catch (err) {
      setErrorMessage(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendPasswordReset = useCallback(async ({ email }) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await authService.sendPasswordReset({ email });
      return true;
    } catch (err) {
      setErrorMessage(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    authService.signOut();
    setCurrentUser(null);
  }, []);

  // Clear any stale error whenever auth state actually changes — mirrors
  // each Swift view-model method resetting `errorMessage = nil` up front.
  useEffect(() => {
    if (currentUser) setErrorMessage(null);
  }, [currentUser]);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated,
      isLoading,
      errorMessage,
      clearError,
      signUp,
      signIn,
      signInWithApple,
      sendPasswordReset,
      signOut,
    }),
    [currentUser, isAuthenticated, isLoading, errorMessage, clearError, signUp, signIn, signInWithApple, sendPasswordReset, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
