import { BrowserRouter } from 'react-router-dom';
import { AppStateProvider } from '../context/AppStateContext';
import { AuthProvider } from '../context/AuthContext';
import { PermissionsProvider } from '../context/PermissionsContext';
import { ContactsProvider } from '../context/ContactsContext';
import { EmergencyProvider } from '../context/EmergencyContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { RootRouter } from './RootRouter';

// App.jsx
// --------
// CONVERSION NOTE (SwiftUI -> React): mirrors VISHWASApp.swift's @main struct.
// WindowGroup { RootRouterView().environment(appState)... } becomes nested
// Context Providers — same "inject once at the top, read anywhere below" shape.
//
// Provider order matters only at the edges:
//   • AppStateProvider + AuthProvider outermost — ProtectedRoute reads both
//   • EmergencyProvider innermost — depends on nothing else
//
// ErrorBoundary wraps the entire tree so any future runtime error shows a
// recovery screen instead of a blank white page (the symptom we just fixed
// in emergencyManager.js — see that file's header comment for the full story).

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppStateProvider>
          <AuthProvider>
            <PermissionsProvider>
              <ContactsProvider>
                <EmergencyProvider>
                  <RootRouter />
                </EmergencyProvider>
              </ContactsProvider>
            </PermissionsProvider>
          </AuthProvider>
        </AppStateProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
