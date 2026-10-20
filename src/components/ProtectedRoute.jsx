import { Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { useAuth } from '../context/AuthContext';

// ProtectedRoute.jsx
// -------------------
// CONVERSION NOTE (SwiftUI -> React): RootRouterView.swift was a single
// `Group` that branched between OnboardingView / WelcomeAuthView / HomeView
// based on `appState.hasCompletedOnboarding` and `appState.isAuthenticated`
// — there was no real "navigation" between those three, just a conditional
// render. React Router's declarative <Route> tree needs an explicit guard
// component to get the same effect: redirect to the right screen instead of
// rendering the protected one. Wrap any route element that requires both
// onboarding-complete AND a signed-in user (i.e. everything under Home).

export function ProtectedRoute({ children }) {
  const { hasCompletedOnboarding } = useAppState();
  const { isAuthenticated } = useAuth();

  if (!hasCompletedOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }
  return children;
}
