import { Redirect } from 'expo-router';
import { useAppState } from '../context/AppStateContext';
import { useAuth } from '../context/AuthContext';

// Entry redirect — mirrors RootRouterView.swift's branching:
// onboarding → welcome/auth → home.
export default function Index() {
  const { hasCompletedOnboarding } = useAppState();
  const { isAuthenticated } = useAuth();
  if (!hasCompletedOnboarding) return <Redirect href="/onboarding" />;
  if (!isAuthenticated) return <Redirect href="/auth" />;
  return <Redirect href="/home" />;
}
