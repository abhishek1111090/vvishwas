import { useEffect, useRef } from 'react';
import { pushBackHandler } from '../platform/backButton';
import './BottomSheet.css';

// BottomSheet.jsx
// ----------------
// CONVERSION NOTE (SwiftUI -> React): the Swift app used `.sheet(isPresented:)`
// (often with `.presentationDetents([.medium])`) for SignUpView, SignInView,
// ForgotPasswordView, AddEditContactView, the contact importer, the
// "Coming Soon" sheet, and SOSConfirmSheet. This component is the one
// reusable equivalent so every call site stays a single line.
//
// MOBILE: while open it registers with the Android back-button stack
// (back closes the sheet instead of leaving the screen), and it scrolls a
// focused field into view once the on-screen keyboard has resized the
// viewport.

export function BottomSheet({ isOpen, onClose, dismissible = true, children }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && dismissible) onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    // Non-dismissible sheets still swallow back presses so they aren't bypassed.
    const removeBack = pushBackHandler(() => { if (dismissible) onCloseRef.current(); });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      removeBack();
    };
  }, [isOpen, dismissible]);

  function handleFocus(e) {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select')) return;
    // Wait for the keyboard animation / viewport resize before scrolling.
    setTimeout(() => {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old WebView */ }
    }, 300);
  }

  if (!isOpen) return null;

  return (
    <div className="v-sheet-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        className="v-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onFocus={handleFocus}
      >
        {dismissible && <div className="v-sheet__grabber" aria-hidden="true" />}
        {children}
      </div>
    </div>
  );
}
