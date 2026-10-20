import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useEmergency } from '../../context/EmergencyContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useBattery } from '../../utils/useBattery';
import { useLocationStatus } from '../../utils/useLocationStatus';
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
  const locationStatus = useLocationStatus(permissions.locationStatus);

  const [showSOSConfirm, setShowSOSConfirm] = useState(false);

  // Triple-tap is handled once, globally, by AppShell (see AppShell.jsx) —
  // a second handler here used to fire two triggers for one gesture.

  const isProtected = contacts.length > 0 && locationStatus.state === 'ok';

  return (
    <div className="v-home">
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
          locationState={locationStatus.state}
          locationError={locationStatus.error}
          onRecheckLocation={locationStatus.recheck}
          batteryLevel={battery.level}
          isCharging={battery.charging}
          audioStatus={emergency.audioStatus}
          videoStatus={emergency.videoStatus}
        />

        <div className="v-home__sos-section">
          <SOSButton
            isActive={emergency.isActive}
            onPress={() => {
              if (emergency.isActive) return; // overlay already showing
              setShowSOSConfirm(true);
            }}
          />
          <p className={['v-home__sos-hint', VFont.caption].join(' ')}>
            Tap button for emergency · Triple-tap anywhere for instant SOS
          </p>
        </div>

        <QuickActionsGrid />
        <RecentActivityList history={emergency.history} />
      </div>

      {/* Manual button — shows confirmation first, then triggers canonically */}
      <SOSConfirmModal
        isOpen={showSOSConfirm && !emergency.isActive}
        onClose={() => setShowSOSConfirm(false)}
        contactCount={contacts.length}
        onConfirm={() => emergency.trigger('button')}
      />
    </div>
  );
}
