import { BottomSheet } from './BottomSheet';
import { PrimaryButton } from '../design-system/components/Button';
import { VFont } from '../design-system/theme';
import { Sparkles } from 'lucide-react';
import './ComingSoonModal.css';

// ComingSoonModal.jsx
// --------------------
// CONVERSION NOTE: mirrors the inline "Coming in Phase X" sheet each
// QuickActionsGrid tile in HomeView.swift presented in place of a feature
// that hasn't been built yet (Safety Timer, Fake Call, Check-In, Safe
// Route — all deferred to Phase 2/4 of the iOS roadmap, same here).

export function ComingSoonModal({ isOpen, onClose, featureName, phase }) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="v-coming-soon">
        <span className="v-coming-soon__icon">
          <Sparkles size={28} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 className={VFont.title}>{featureName}</h2>
        <p className={['v-coming-soon__copy', VFont.body].join(' ')}>
          This feature is coming in Phase {phase} of VISHWAS. We wanted you to see where
          it'll live before it's fully built out.
        </p>
        <PrimaryButton onClick={onClose}>Got it</PrimaryButton>
      </div>
    </BottomSheet>
  );
}
