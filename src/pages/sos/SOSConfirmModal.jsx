import { TriangleAlert } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { PrimaryButton, SecondaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import './sos.css';

/**
 * SOSConfirmModal — manual-trigger-only confirmation sheet.
 *
 * This is the ONLY path where the user sees a confirmation before SOS fires.
 * Triple-tap and (Phase 2+) voice/Siri bypass this and call trigger() directly.
 *
 * Haptics: EmergencyContext.trigger() fires haptics.emergencyTrigger() internally,
 * so we don't call haptics here to avoid double-firing.
 */
export function SOSConfirmModal({ isOpen, onClose, contactCount, onConfirm }) {
  function handleConfirm() {
    onConfirm(); // → emergency.trigger('button') → haptics + real recording start
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="v-sos-confirm">
        <TriangleAlert size={40} color="var(--color-emergency)" aria-hidden="true" />

        <div className="v-sos-confirm__copy">
          <h2 className={VFont.title}>Trigger Emergency?</h2>
          <p className={VFont.subheadline}>
            This starts audio + video recording and live location, and alerts{' '}
            {contactCount > 0
              ? `${contactCount} emergency contact${contactCount === 1 ? '' : 's'}`
              : 'your emergency contacts (none saved yet)'}
            . The emergency screen shows exactly which alerts were sent.
          </p>
        </div>

        <div className="v-sos-confirm__actions">
          <PrimaryButton destructive onClick={handleConfirm}>
            Yes — Send Alert
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </div>
    </BottomSheet>
  );
}
