import { Routes, Route, Navigate } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { useAuth } from '../context/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { AppShell } from '../components/AppShell';
import { OnboardingFlow } from '../pages/onboarding/OnboardingFlow';
import { WelcomePage } from '../pages/auth/WelcomePage';
import { HomePage } from '../pages/home/HomePage';
import { ContactsListPage } from '../pages/contacts/ContactsListPage';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { HistoryPage } from '../pages/history/HistoryPage';
import { useAndroidBackButton } from '../platform/useAndroidBackButton';

function RootRedirect() {
  const { hasCompletedOnboarding } = useAppState();
  const { isAuthenticated } = useAuth();

  if (!hasCompletedOnboarding) return <Navigate to="/onboarding" replace />;
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  return <Navigate to="/home" replace />;
}

export function RootRouter() {
  useAndroidBackButton();

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/onboarding" element={<OnboardingFlow />} />
      <Route path="/auth" element={<WelcomePage />} />

      {/* Protected Mobile App Shell Routes */}
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <AppShell>
              <HomePage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/contacts"
        element={
          <ProtectedRoute>
            <AppShell>
              <ContactsListPage />
            </AppShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <AppShell>
              <ProfilePage />
            </AppShell>
          </ProtectedRoute>
        }
      />

      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <AppShell>
              <HistoryPage />
            </AppShell>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

