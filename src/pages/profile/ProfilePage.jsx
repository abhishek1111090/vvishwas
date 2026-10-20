import {
  ShieldCheck, AlertTriangle, PhoneCall,
  MapPin, Video, Mic, Users, BatteryCharging,
  BatteryMedium, LogOut, Info, Lock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useBattery } from '../../utils/useBattery';
import { PermissionStatus } from '../../services/permissionsService';
import { Card } from '../../design-system/index.js';
import { haptics } from '../../services/hapticService';
import { VFont } from '../../design-system/theme';
import './profile.css';

export function ProfilePage() {
  const { currentUser, signOut } = useAuth();
  const permissions = usePermissions();
  const { contacts } = useContacts();
  const battery = useBattery();

  const isLocationReady = permissions.locationStatus === PermissionStatus.granted;
  const isCameraReady = permissions.cameraStatus === PermissionStatus.granted;
  const isMicReady = permissions.microphoneStatus === PermissionStatus.granted;
  const isProtected = contacts.length > 0 && isLocationReady;

  function getUserInitials() {
    if (!currentUser?.fullName) return 'V';
    return currentUser.fullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  function handleSignOut() {
    const confirmed = window.confirm('Are you sure you want to sign out of VISHWAS?');
    if (confirmed) {
      haptics.warning();
      signOut();
    }
  }

  const helplines = [
    { number: '112', title: 'National Emergency', desc: 'All-in-one emergency response (Police, Fire, Medical)' },
    { number: '1091', title: 'Women Helpline', desc: '24/7 dedicated support for women in distress' },
    { number: '100', title: 'Police Direct', desc: 'Immediate police emergency dispatch' },
  ];

  return (
    <div className="v-profile-page">
      <header className="v-profile-header">
        <h1 className={['v-profile-title', VFont.headline].join(' ')}>Account &amp; Security</h1>
      </header>

      <div className="v-profile-content">
        {/* User Card */}
        <Card>
          <div className="v-profile-user-card">
            <div className="v-profile-avatar">
              {getUserInitials()}
            </div>
            <div className="v-profile-user-info">
              <h2 className={VFont.title}>{currentUser?.fullName || 'VISHWAS User'}</h2>
              <p className={VFont.subheadline}>{currentUser?.email || 'Secured Account'}</p>
              <div className="v-profile-status-badge">
                {isProtected ? (
                  <>
                    <ShieldCheck size={14} color="var(--color-safe)" />
                    <span style={{ color: 'var(--color-safe)' }}>Protection Active</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} color="var(--color-warning)" />
                    <span style={{ color: 'var(--color-warning)' }}>Setup Needed</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Device & System Protection Readiness */}
        <section className="v-profile-section">
          <h3 className="v-profile-section__title">SYSTEM PROTECTION STATUS</h3>
          <Card>
            <div className="v-profile-status-grid">
              <div className="v-profile-status-row">
                <div className="v-profile-status-icon">
                  <MapPin size={18} color={isLocationReady ? 'var(--color-safe)' : 'var(--color-warning)'} />
                </div>
                <div className="v-profile-status-text">
                  <span className={VFont.headline}>Live GPS Location</span>
                  <span className={VFont.caption}>
                    {isLocationReady ? 'Active & accurate tracking' : 'Disabled — enable in browser settings'}
                  </span>
                </div>
                <span className={`v-profile-pill ${isLocationReady ? 'v-profile-pill--ok' : 'v-profile-pill--warn'}`}>
                  {isLocationReady ? 'READY' : 'OFF'}
                </span>
              </div>

              <div className="v-profile-status-row">
                <div className="v-profile-status-icon">
                  <Video size={18} color={isCameraReady ? 'var(--color-safe)' : 'var(--color-accent)'} />
                </div>
                <div className="v-profile-status-text">
                  <span className={VFont.headline}>Evidence Camera</span>
                  <span className={VFont.caption}>
                    {isCameraReady ? 'Camera permission granted' : 'Will request on SOS activation'}
                  </span>
                </div>
                <span className={`v-profile-pill ${isCameraReady ? 'v-profile-pill--ok' : 'v-profile-pill--neutral'}`}>
                  {isCameraReady ? 'READY' : 'ON-DEMAND'}
                </span>
              </div>

              <div className="v-profile-status-row">
                <div className="v-profile-status-icon">
                  <Mic size={18} color={isMicReady ? 'var(--color-safe)' : 'var(--color-accent)'} />
                </div>
                <div className="v-profile-status-text">
                  <span className={VFont.headline}>Evidence Audio</span>
                  <span className={VFont.caption}>
                    {isMicReady ? 'Microphone permission granted' : 'Will record when SOS triggers'}
                  </span>
                </div>
                <span className={`v-profile-pill ${isMicReady ? 'v-profile-pill--ok' : 'v-profile-pill--neutral'}`}>
                  {isMicReady ? 'READY' : 'ON-DEMAND'}
                </span>
              </div>

              <div className="v-profile-status-row">
                <div className="v-profile-status-icon">
                  <Users size={18} color={contacts.length > 0 ? '#0a84ff' : 'var(--color-warning)'} />
                </div>
                <div className="v-profile-status-text">
                  <span className={VFont.headline}>Trusted Emergency Contacts</span>
                  <span className={VFont.caption}>
                    {contacts.length > 0
                      ? `${contacts.length} contact${contacts.length === 1 ? '' : 's'} linked`
                      : 'None added yet — alert won\'t notify anyone'}
                  </span>
                </div>
                <span className={`v-profile-pill ${contacts.length > 0 ? 'v-profile-pill--ok' : 'v-profile-pill--warn'}`}>
                  {contacts.length > 0 ? `${contacts.length} LINKED` : 'ADD'}
                </span>
              </div>

              <div className="v-profile-status-row">
                <div className="v-profile-status-icon">
                  {battery.charging ? (
                    <BatteryCharging size={18} color="var(--color-safe)" />
                  ) : (
                    <BatteryMedium size={18} color="var(--color-text-secondary)" />
                  )}
                </div>
                <div className="v-profile-status-text">
                  <span className={VFont.headline}>Device Battery</span>
                  <span className={VFont.caption}>
                    {battery.level !== null
                      ? `${Math.round(battery.level * 100)}% · ${battery.charging ? 'Charging' : 'On Battery'}`
                      : 'Battery API not supported'}
                  </span>
                </div>
                <span className="v-profile-pill v-profile-pill--neutral">
                  {battery.level !== null ? `${Math.round(battery.level * 100)}%` : 'OK'}
                </span>
              </div>
            </div>
          </Card>
        </section>

        {/* Emergency Helpline Quick-Dials */}
        <section className="v-profile-section">
          <h3 className="v-profile-section__title">EMERGENCY HELPLINES (ONE-TAP CALL)</h3>
          <div className="v-profile-helplines">
            {helplines.map((item) => (
              <a
                key={item.number}
                href={`tel:${item.number}`}
                className="v-profile-helpline-card"
                onClick={() => haptics.selection()}
                aria-label={`Call ${item.title} on ${item.number}`}
              >
                <div className="v-profile-helpline-icon">
                  <PhoneCall size={20} color="var(--color-emergency)" />
                </div>
                <div className="v-profile-helpline-copy">
                  <div className="v-profile-helpline-head">
                    <span className={VFont.headline}>{item.title}</span>
                    <span className="v-profile-helpline-num">{item.number}</span>
                  </div>
                  <span className={VFont.caption}>{item.desc}</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Safety Tips Card */}
        <Card>
          <div className="v-profile-tip">
            <Info size={20} color="var(--color-accent)" flex-shrink="0" />
            <div className="v-profile-tip__text">
              <span className={VFont.headline}>Triple-Tap Emergency Shortcut</span>
              <p className={VFont.caption}>
                In any sudden danger, tap three times rapidly anywhere on the screen to trigger instant SOS without waiting for confirmation.
              </p>
            </div>
          </div>
        </Card>

        {/* Sign Out Button */}
        <div className="v-profile-actions">
          <button
            type="button"
            className="v-btn v-btn--secondary v-profile-signout-btn"
            onClick={handleSignOut}
          >
            <LogOut size={18} strokeWidth={2.2} />
            Sign Out
          </button>
        </div>

        <div className="v-profile-footer">
          <div className="v-profile-version">
            <Lock size={12} />
            <span>VISHWAS Safety Engine v1.0.0 · Local Secure Storage</span>
          </div>
        </div>
      </div>
    </div>
  );
}
