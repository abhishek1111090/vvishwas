import {
  Users, MapPin, ShieldCheck, TriangleAlert,
  BatteryCharging, BatteryWarning, BatteryLow, BatteryMedium, BatteryFull, Battery,
  AudioLines,
} from 'lucide-react';
import { Card, StatusPill } from '../../design-system/index.js';
import './home.css';

function batteryIcon(level, isCharging) {
  if (level === null) return Battery;
  if (isCharging)   return BatteryCharging;
  if (level < 0.2)  return BatteryWarning;
  if (level < 0.5)  return BatteryLow;
  if (level < 0.8)  return BatteryMedium;
  return BatteryFull;
}

const LOCATION_LABEL = {
  ok: 'Location OK',
  checking: 'Locating…',
  error: 'No Location',
  off: 'Location Off',
};

function StatusItem({ icon: Icon, label, tint, title, onClick }) {
  const content = (
    <>
      <Icon size={18} strokeWidth={2.25} color={tint} aria-hidden="true" />
      <span className="v-status-item__label">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="v-status-item v-status-item--button" title={title} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="v-status-item" title={title}>{content}</div>;
}

export function SafetyStatusCard({
  contactCount,
  locationState,
  locationError,
  onRecheckLocation,
  batteryLevel,
  isCharging,
  audioStatus,
  videoStatus,
}) {
  const locationOk = locationState === 'ok';
  const isFullyProtected = contactCount > 0 && locationOk;
  const isRecording = audioStatus === 'recording' || videoStatus === 'recording';

  return (
    <Card>
      <div className="v-safety-status">
        {isRecording ? (
          <StatusPill text="Recording Active" color="var(--color-emergency)" icon={AudioLines} />
        ) : (
          <StatusPill
            text={isFullyProtected ? 'Protected' : 'Setup Needed'}
            color={isFullyProtected ? 'var(--color-safe)' : 'var(--color-warning)'}
            icon={isFullyProtected ? ShieldCheck : TriangleAlert}
          />
        )}

        <div className="v-safety-status__row">
          <StatusItem
            icon={Users}
            label={`${contactCount} Contact${contactCount === 1 ? '' : 's'}`}
            tint={contactCount > 0 ? '#0a84ff' : 'var(--color-warning)'}
          />
          <StatusItem
            icon={MapPin}
            label={LOCATION_LABEL[locationState] ?? 'Location'}
            title={locationError ?? undefined}
            tint={locationOk ? 'var(--color-safe)' : locationState === 'checking' ? 'var(--color-text-secondary)' : 'var(--color-warning)'}
            onClick={locationState === 'error' ? onRecheckLocation : undefined}
          />
          <StatusItem
            icon={batteryIcon(batteryLevel, isCharging)}
            label={batteryLevel === null ? '—' : `${Math.round(batteryLevel * 100)}%`}
            title={batteryLevel === null ? 'Battery level not available on this device' : undefined}
            tint={
              batteryLevel !== null && batteryLevel < 0.2 && !isCharging
                ? 'var(--color-warning)'
                : 'var(--color-text-secondary)'
            }
          />
        </div>
        {locationState === 'error' && locationError && (
          <p className="v-safety-status__hint">{locationError} Tap “No Location” to retry.</p>
        )}
      </div>
    </Card>
  );
}
