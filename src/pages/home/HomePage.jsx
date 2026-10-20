import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEmergency } from '../../context/EmergencyContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useTripleTap } from '../../utils/useTripleTap';
import { useBattery } from '../../utils/useBattery';
import { PermissionStatus } from '../../services/permissionsService';
import { SafetyStatusCard } from './SafetyStatusCard';
import { QuickActionsGrid } from './QuickActionsGrid';
import { RecentActivityList } from './RecentActivityList';
import { SOSButton } from '../sos/SOSButton';
import { SOSConfirmModal } from '../sos/SOSConfirmModal';
import { VFont } from '../../design-system/theme';
import './home.css';

export function HomePage() {
  const emergency = useEmergency();
  const permissions = usePermissions();
  const { contacts } = useContacts();
  const battery = useBattery();

  const [showSOSConfirm, setShowSOSConfirm] = useState(false);

  // Triple-tap bypasses confirmation and triggers immediately.
  // Canonical trigger: emergencyManager.trigger('tripleTap') via EmergencyContext
  const tripleTapHandler = useTripleTap(() => {
    emergency.trigger('tripleTap');
  });

  const isProtected =
    contacts.length > 0 &&
    permissions.locationStatus === PermissionStatus.granted;

  return (
    <div className="v-home" onClick={tripleTapHandler}>
      {/* Mobile App Header */}
      <header className="v-home__topbar">
        <div className="v-home__brand">
          <div className="v-home__logo-badge">
            <ShieldAlert size={20} strokeWidth={2.4} color="var(--color-accent)" />
          </div>
          <h1 className={['v-home__title', VFont.headline].join(' ')}>VISHWAS</h1>
        </div>

        <div className="v-home__quick-status">
          <span className={`v-home__status-pill ${isProtected ? 'v-home__status-pill--safe' : 'v-home__status-pill--warn'}`}>
            <span className="v-home__status-dot" />
            {isProtected ? 'Protected' : 'Setup Needed'}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="v-home__content">
        <SafetyStatusCard
          contactCount={contacts.length}
          locationGranted={permissions.locationStatus === PermissionStatus.granted}
          batteryLevel={battery.level}
          isCharging={battery.charging}
          audioStatus={emergency.audioStatus}
          videoStatus={emergency.videoStatus}
        />

        <div className="v-home__sos-section">
          <SOSButton
            isActive={emergency.isActive}
            onPress={() => {
              if (emergency.isActive) return; // already active
              setShowSOSConfirm(true);
            }}
          />
          <p className={['v-home__sos-hint', VFont.caption].join(' ')}>
            Tap button for emergency · Triple-tap anywhere for instant SOS
          </p>
        </div>

        <QuickActionsGrid />
        <RecentActivityList log={emergency.log} />
      </div>

      {/* Manual button — shows confirmation first, then triggers canonically */}
      <SOSConfirmModal
        isOpen={showSOSConfirm}
        onClose={() => setShowSOSConfirm(false)}
        contactCount={contacts.length}
        onConfirm={() => emergency.trigger('button')}
      />
    </div>
  );
}

