import { useEffect } from 'react';
import './BottomSheet.css';

// BottomSheet.jsx
// ----------------
// CONVERSION NOTE (SwiftUI -> React): the Swift app used `.sheet(isPresented:)`
// (often with `.presentationDetents([.medium])`) for SignUpView, SignInView,
// ForgotPasswordView, AddEditContactView, the contact importer, the
// "Coming Soon" sheet, and SOSConfirmSheet — eight different call sites all
// using the same OS-level presentation pattern. This component is the one
// reusable equivalent so every one of those call sites stays a single line,
// the same way they were in Swift.

export function BottomSheet({ isOpen, onClose, dismissible = true, children }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, dismissible, onClose]);

  if (!isOpen) return null;

  return (
    <div className="v-sheet-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        className="v-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {dismissible && <div className="v-sheet__grabber" aria-hidden="true" />}
        {children}
      </div>
    </div>
  );
}
