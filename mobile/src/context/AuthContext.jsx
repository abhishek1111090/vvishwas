import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { authService } from '../services/authService';

// AuthContext — current user + sign in/up/out with loading and error state
// (mirrors AppState.swift's session half + AuthViewModel.swift).
// `initialUser` is the session restored by the root layout before render.

const AuthContext = createContext(null);

export function AuthProvider({ children, initialUser = null, service = authService }) {
  const [currentUser, setCurrentUser] = useState(initialUser);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const run = useCallback(async (fn, onSuccess) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await fn();
      onSuccess?.(result);
      return result ?? true;
    } catch (err) {
      setErrorMessage(err?.message ?? 'Something went wrong.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signUp = useCallback((data) => run(() => service.signUp(data), setCurrentUser), [run, service]);
  const signIn = useCallback((data) => run(() => service.signIn(data), setCurrentUser), [run, service]);
  const sendPasswordReset = useCallback((data) => run(() => service.sendPasswordReset(data)), [run, service]);
  const signOut = useCallback(async () => {
    await service.signOut();
    setCurrentUser(null);
  }, [service]);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated: currentUser !== null,
      isLoading,
      errorMessage,
      clearError,
      signUp,
      signIn,
      sendPasswordReset,
      signOut,
      isLocalOnly: service.isLocalOnly,
      canResetPassword: service.canResetPassword(),
    }),
    [currentUser, isLoading, errorMessage, clearError, signUp, signIn, sendPasswordReset, signOut, service]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
