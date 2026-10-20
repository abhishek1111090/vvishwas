import {
  MapPin, Video, Mic, Bell,
  CheckCircle2, Loader, AlertCircle, RefreshCw
} from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { Card, VFont } from '../../design-system/index.js';
import { PrimaryButton } from '../../design-system/components/Button';
import { PermissionStatus } from '../../services/permissionsService';
import { haptics } from '../../services/hapticService';
import './onboarding.css';

function PermissionCard({
  icon: Icon,
  tint,
  title,
  purpose,
  status,
  onRequest
}) {
  const isRequesting = status === PermissionStatus.requesting;
  const isDenied = status === PermissionStatus.denied;
  const isGranted = status === PermissionStatus.granted;

  async function handleAction() {
    haptics.light();
    try {
      await onRequest();
    } catch {
      // never crash on permission denial
    }
  }

  return (
    <Card>
      <div className={`v-perm-item ${isGranted ? 'v-perm-item--granted' : ''} ${isDenied ? 'v-perm-item--denied' : ''}`}>
        <div className="v-perm-item__main">
          <div className="v-perm-item__icon-wrap" style={{ background: `${tint}1a` }}>
            <Icon size={20} color={tint} strokeWidth={2.2} aria-hidden="true" />
          </div>

          <div className="v-perm-item__copy">
            <div className="v-perm-item__header">
              <span className={['v-perm-item__title', VFont.headline].join(' ')}>{title}</span>
              {isGranted && (
                <span className="v-perm-tag v-perm-tag--granted">
                  <CheckCircle2 size={13} strokeWidth={2.5} />
                  Granted
                </span>
              )}
              {isDenied && (
                <span className="v-perm-tag v-perm-tag--denied">
                  <AlertCircle size={13} strokeWidth={2.5} />
                  Blocked
                </span>
              )}
              {isRequesting && (
                <span className="v-perm-tag v-perm-tag--pending">
                  <Loader size={13} className="v-perm-spinner" />
                  Asking...
                </span>
              )}
            </div>

            <p className={['v-perm-item__purpose', VFont.caption].join(' ')}>
              {purpose}
            </p>

            {isDenied && (
              <p className="v-perm-item__denied-help">
                Access blocked. Tap the lock icon in your browser address bar to allow, then tap Retry.
              </p>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="v-perm-item__action-col">
          {!isGranted && (
            <button
              type="button"
              className={`v-perm-btn ${isDenied ? 'v-perm-btn--retry' : 'v-perm-btn--allow'}`}
              onClick={handleAction}
              disabled={isRequesting}
              aria-label={`${isDenied ? 'Retry' : 'Allow'} ${title} permission`}
            >
              {isRequesting ? (
                <Loader size={15} className="v-perm-spinner" />
              ) : isDenied ? (
                'Retry'
              ) : (
                'Allow'
              )}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PermissionsSetupView({ onContinue }) {
  const {
    locationStatus, requestLocation,
    cameraStatus, requestCamera,
    microphoneStatus, requestMicrophone,
    notificationStatus, requestNotifications,
    refreshAllStatuses,
  } = usePermissions();

  const allGranted =
    locationStatus === PermissionStatus.granted &&
    cameraStatus === PermissionStatus.granted &&
    microphoneStatus === PermissionStatus.granted &&
    notificationStatus === PermissionStatus.granted;

  async function handleRefresh() {
    haptics.selection();
    try {
      await refreshAllStatuses();
    } catch {
      // safe fallback
    }
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
          VISHWAS requires these permissions to capture evidence and alert your emergency contacts in a crisis.
        </p>
      </div>

      <div className="v-permissions-setup__list">
        <PermissionCard
          icon={MapPin}
          tint="#0a84ff"
          title="Live GPS Location"
          purpose="Shares your exact live coordinates and generates a private tracking link for your trusted contacts during an emergency."
          status={locationStatus}
          onRequest={requestLocation}
        />

        <PermissionCard
          icon={Video}
          tint="#af52de"
          title="Evidence Camera"
          purpose="Silently records video evidence when SOS triggers to document surroundings and potential threats for your safety."
          status={cameraStatus}
          onRequest={requestCamera}
        />

        <PermissionCard
          icon={Mic}
          tint="var(--color-warning)"
          title="Evidence Microphone"
          purpose="Records high-fidelity ambient audio evidence during emergencies to capture background conversations."
          status={microphoneStatus}
          onRequest={requestMicrophone}
        />

        <PermissionCard
          icon={Bell}
          tint="var(--color-emergency)"
          title="Emergency Alerts"
          purpose="Sends priority notifications when safety timers expire, contacts respond, or an emergency status changes."
          status={notificationStatus}
          onRequest={requestNotifications}
        />
      </div>

      <div className="v-permissions-setup__footer">
        <p className={['v-permissions-setup__note', VFont.caption].join(' ')}>
          {allGranted
            ? 'All core protections are enabled and verified.'
            : 'You can proceed now and grant remaining permissions anytime in Account settings.'}
        </p>
        <PrimaryButton onClick={onContinue}>
          {allGranted ? 'Finish Setup & Continue →' : 'Continue to VISHWAS'}
        </PrimaryButton>
      </div>
    </div>
  );
}
