import { RefreshCw } from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { VFont } from '../../design-system/index.js';
import { PrimaryButton } from '../../design-system/components/Button';
import { PermissionStatus } from '../../services/permissionsService';
import { haptics } from '../../services/hapticService';
import { PermissionsList, visiblePermissionItems } from './PermissionsList';
import './onboarding.css';

export function PermissionsSetupView({ onContinue }) {
  const { statuses, refreshAllStatuses } = usePermissions();

  const allGranted = visiblePermissionItems().every(
    (item) => statuses[item.kind] === PermissionStatus.granted || statuses[item.kind] === PermissionStatus.unavailable
  );

  async function handleRefresh() {
    haptics.selection();
    await refreshAllStatuses();
  }

  return (
    <div className="v-permissions-setup">
      <div className="v-permissions-setup__header">
        <div className="v-permissions-setup__title-row">
          <h2 className={['v-permissions-setup__title', VFont.title].join(' ')}>Set Up Protection</h2>
          <button
            type="button"
            className="v-permissions-setup__refresh-btn"
            onClick={handleRefresh}
            aria-label="Refresh permission statuses"
            title="Refresh status"
          >
            <RefreshCw size={15} strokeWidth={2.2} />
          </button>
        </div>
        <p className={['v-permissions-setup__subtitle', VFont.subheadline].join(' ')}>
          VISHWAS needs these to capture evidence and alert your emergency contacts in a crisis. You choose each one.
        </p>
      </div>

      <PermissionsList />

      <div className="v-permissions-setup__footer">
        <p className={['v-permissions-setup__note', VFont.caption].join(' ')}>
          {allGranted
            ? 'All available protections are enabled.'
            : 'You can continue now and grant the rest anytime in Account → Permissions.'}
        </p>
        <PrimaryButton onClick={onContinue}>
          {allGranted ? 'Finish Setup & Continue →' : 'Continue to VISHWAS'}
        </PrimaryButton>
      </div>
    </div>
  );
}
