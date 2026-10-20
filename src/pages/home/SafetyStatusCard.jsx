import {
  Users, MapPin, ShieldCheck, TriangleAlert,
  BatteryCharging, BatteryWarning, BatteryLow, BatteryMedium, BatteryFull,
  AudioLines,
} from 'lucide-react';
import { Card, StatusPill } from '../../design-system/index.js';
import './home.css';

function batteryIcon(level, isCharging) {
  if (isCharging)   return BatteryCharging;
  if (level < 0.2)  return BatteryWarning;
  if (level < 0.5)  return BatteryLow;
  if (level < 0.8)  return BatteryMedium;
  return BatteryFull;
}

function StatusItem({ icon: Icon, label, tint }) {
  return (
    <div className="v-status-item">
      <Icon size={18} strokeWidth={2.25} color={tint} aria-hidden="true" />
      <span className="v-status-item__label">{label}</span>
    </div>
  );
}

export function SafetyStatusCard({
  contactCount,
  locationGranted,
  batteryLevel,
  isCharging,
  audioStatus,
  videoStatus,
}) {
  const isFullyProtected = contactCount > 0 && locationGranted;
  const safeBatteryLevel = Math.max(batteryLevel ?? 0, 0);

  const isRecording = audioStatus === 'recording' || videoStatus === 'recording';

  return (
    <Card>
      <div className="v-safety-status">
        {isRecording ? (
          <StatusPill
            text="Recording Active"
            color="var(--color-emergency)"
            icon={AudioLines}
          />
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
            label={locationGranted ? 'GPS Ready' : 'GPS Off'}
            tint={locationGranted ? 'var(--color-safe)' : 'var(--color-warning)'}
          />
          <StatusItem
            icon={batteryIcon(safeBatteryLevel, isCharging)}
            label={batteryLevel === null ? '—' : `${Math.round(safeBatteryLevel * 100)}%`}
            tint={
              safeBatteryLevel < 0.2 && !isCharging
                ? 'var(--color-warning)'
                : 'var(--color-text-secondary)'
            }
          />
        </div>
      </div>
    </Card>
  );
}
