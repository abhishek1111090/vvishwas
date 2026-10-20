import {
  MapPin, Video, Mic, Bell, MessageSquareText,
  CheckCircle2, Loader, AlertCircle, MinusCircle,
} from 'lucide-react';
import { usePermissions } from '../../context/PermissionsContext';
import { Card, VFont } from '../../design-system/index.js';
import { PermissionStatus } from '../../services/permissionsService';
import { haptics } from '../../services/hapticService';
import { isAndroid, isNative } from '../../platform/platform';
import './onboarding.css';

/**
 * PermissionsList — one card per permission, used in onboarding AND in
 * Account settings ("grant remaining permissions anytime in Account").
 *
 * Each card explains WHY VISHWAS needs it, shows the real OS status, and
 * offers the right action:
 *   not asked → "Allow" (shows the OS dialog)
 *   denied    → "Settings" on native (the OS won't show the dialog again),
 *               "Retry" in a browser
 *   unavailable → no action, explains why
 */

export const PERMISSION_ITEMS = [
  {
    kind: 'location',
    icon: MapPin,
    tint: '#0a84ff',
    title: 'Live GPS Location',
    purpose: 'Puts your exact coordinates in the alert to your trusted contacts and tracks you while an emergency is active. Not used in the background.',
  },
  {
    kind: 'camera',
    icon: Video,
    tint: '#af52de',
    title: 'Evidence Camera',
    purpose: 'Records video evidence when SOS triggers. Recordings stay in VISHWAS’s private storage on this phone.',
  },
  {
    kind: 'microphone',
    icon: Mic,
    tint: 'var(--color-warning)',
    title: 'Evidence Microphone',
    purpose: 'Records ambient audio evidence during an emergency. Never used outside an active SOS.',
  },
  {
    kind: 'notifications',
    icon: Bell,
    tint: 'var(--color-emergency)',
    title: 'Emergency Status Alerts',
    purpose: 'Shows an ongoing notification while an emergency is active so you can return to the SOS screen in one tap.',
  },
  {
    kind: 'sms',
    icon: MessageSquareText,
    tint: 'var(--color-safe)',
    title: 'Automatic SMS Alerts',
    purpose: 'Lets VISHWAS text your emergency contacts automatically when SOS triggers (standard SMS charges apply). Without it, you send the prefilled text yourself.',
    androidOnly: true,
  },
];

function deniedHelp(canOpenSettings) {
  return canOpenSettings
    ? 'Blocked. Android/iOS won’t ask again — tap Settings, open Permissions, and allow it.'
    : 'Blocked. Tap the lock icon in your browser address bar to allow, then tap Retry.';
}

function PermissionCard({ item, status, onRequest, onOpenSettings, canOpenSettings }) {
  const { icon: Icon, tint, title, purpose } = item;
  const isRequesting = status === PermissionStatus.requesting;
  const isDenied = status === PermissionStatus.denied;
  const isGranted = status === PermissionStatus.granted;
  const isUnavailable = status === PermissionStatus.unavailable;

  async function handleAction() {
    haptics.light();
    if (isDenied && canOpenSettings) {
      await onOpenSettings();
      return;
    }
    await onRequest();
  }

  let actionLabel = 'Allow';
  if (isDenied) actionLabel = canOpenSettings ? 'Settings' : 'Retry';

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
              {isUnavailable && (
                <span className="v-perm-tag v-perm-tag--pending">
                  <MinusCircle size={13} strokeWidth={2.5} />
                  Not available
                </span>
              )}
            </div>

            <p className={['v-perm-item__purpose', VFont.caption].join(' ')}>{purpose}</p>

            {isDenied && <p className="v-perm-item__denied-help">{deniedHelp(canOpenSettings)}</p>}
            {isUnavailable && (
              <p className="v-perm-item__denied-help">Not supported on this device or browser.</p>
            )}
          </div>
        </div>

        <div className="v-perm-item__action-col">
          {!isGranted && !isUnavailable && (
            <button
              type="button"
              className={`v-perm-btn ${isDenied ? 'v-perm-btn--retry' : 'v-perm-btn--allow'}`}
              onClick={handleAction}
              disabled={isRequesting}
              aria-label={`${actionLabel} ${title} permission`}
            >
              {isRequesting ? <Loader size={15} className="v-perm-spinner" /> : actionLabel}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function visiblePermissionItems() {
  return PERMISSION_ITEMS.filter((item) => !item.androidOnly || (isNative() && isAndroid()));
}

export function PermissionsList() {
  const { statuses, request, openAppSettings, canOpenSettings, lastError } = usePermissions();

  return (
    <div className="v-permissions-setup__list">
      {visiblePermissionItems().map((item) => (
        <PermissionCard
          key={item.kind}
          item={item}
          status={statuses[item.kind]}
          onRequest={() => request(item.kind)}
          onOpenSettings={openAppSettings}
          canOpenSettings={canOpenSettings}
        />
      ))}
      {lastError && <p className="v-perm-item__denied-help" role="alert">{lastError}</p>}
    </div>
  );
}
