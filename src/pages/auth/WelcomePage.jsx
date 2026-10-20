import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SecondaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { SignUpSheet } from './SignUpSheet';
import { SignInSheet } from './SignInSheet';
import { haptics } from '../../services/hapticService';
import './auth.css';

// WelcomePage.jsx
// ----------------
// CONVERSION NOTE (SwiftUI -> React): mirrors WelcomeAuthView.swift. The
// two `.sheet(isPresented:)` modals (SignUpView/SignInView) become local
// `showSignUp`/`showSignIn` state rendering <SignUpSheet>/<SignInSheet> —
// same pattern as the original, just without NavigationStack wrapping each
// sheet in its own nav bar (we use <SheetHeader> for that instead).
//
// The "Sign In with Apple" button here is explicitly a UI placeholder —
// see authService.js's `signInWithApplePlaceholder` for why a real
// implementation needs Apple's own "Sign in with Apple JS" SDK and a
// registered Services ID, neither of which exist in this generated project.

export function WelcomePage() {
  const { signInWithApple, errorMessage, isLoading } = useAuth();
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const navigate = useNavigate();

  async function handleAppleSignIn() {
    const user = await signInWithApple();
    if (user) {
      haptics.success();
      navigate('/home', { replace: true });
    }
  }

  return (
    <div className="v-welcome">
      <div className="v-welcome__brand">
        <ShieldCheck size={56} strokeWidth={1.75} color="var(--color-accent)" aria-hidden="true" />
        <h1 className={VFont.display}>VISHWAS</h1>
        <p className={VFont.subheadline}>Women's Safety &amp; Emergency Response</p>
      </div>

      {errorMessage && <p className={['v-welcome__error', VFont.caption].join(' ')}>{errorMessage}</p>}

      <div className="v-welcome__actions">
        <button
          type="button"
          className="v-apple-signin-btn"
          onClick={handleAppleSignIn}
          disabled={isLoading}
        >
          <KeyRound size={18} strokeWidth={2.25} aria-hidden="true" />
          {isLoading ? 'Signing in…' : 'Sign in with Apple'}
        </button>

        <SecondaryButton onClick={() => setShowSignUp(true)}>Continue with Email</SecondaryButton>

        <button type="button" className={['v-welcome__existing-account', VFont.subheadline].join(' ')} onClick={() => setShowSignIn(true)}>
          I already have an account
        </button>
      </div>

      <SignUpSheet isOpen={showSignUp} onClose={() => setShowSignUp(false)} />
      <SignInSheet isOpen={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}
