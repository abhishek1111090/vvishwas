import { Download, MapPin, MessageSquare, RotateCcw } from 'lucide-react';
import { useEmergency } from '../../context/EmergencyContext';
import { PrimaryButton, SecondaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { formatShortTime, formatStandardTime } from '../../utils/formatDate';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import { mapsUrl } from '../../services/locationService';
import { AlertStatus, ALERT_STATUS_LABEL } from '../../services/alertService';
import './sos.css';

/**
 * EmergencyActiveOverlay — full-screen while an SOS session is active.
 *
 * Shows (all from real service state):
 *  • Session info (trigger source, start time)
 *  • Live GPS coordinates — only from a real fix
 *  • Recording status per device, with honest saved/not-saved wording
 *  • Contact alert outcome per contact (sent / failed / composer opened …)
 *  • Timeline
 *  • "I'm Safe" and "False Alarm" — the only ways out (back button is
 *    disabled while active; see useAndroidBackButton)
 */

const RECORDING_TEXT = {
  idle: 'Idle',
  requesting: 'Starting…',
  recording: 'Recording',
  stopping: 'Saving…',
  saved: 'Saved on device',
  ready: 'Captured (download before closing)',
  error: 'Unavailable',
};

function mimeToExt(m) {
  if (!m) return '';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('webm')) return '.webm';
  if (m.includes('ogg')) return '.ogg';
  return '';
}

function RecordingBadge({ label, state }) {
  const { status, url, mime, error, interrupted } = state;
  let color = 'var(--color-text-secondary)';
  if (status === 'recording') color = '#ff3b30';
  if (status === 'saved' || status === 'ready') color = 'var(--color-safe)';
  if (status === 'error') color = 'var(--color-warning)';

  return (
    <div className="v-eo-badge" style={{ borderColor: color }}>
      <span
        className={`v-eo-badge__dot ${status === 'recording' ? 'v-eo-badge__dot--pulse' : ''}`}
        style={{ background: color }}
      />
      <span className="v-eo-badge__label" style={{ color }}>
        {label} {RECORDING_TEXT[status] ?? status}
      </span>
      {status === 'ready' && url && (
        <a
          href={url}
          download={`vishwas-emergency-${label.toLowerCase()}${mimeToExt(mime)}`}
          className="v-eo-badge__download"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Download ${label} recording`}
        >
          <Download size={14} strokeWidth={2.25} />
          Save
        </a>
      )}
      {interrupted && <span className="v-eo-badge__error-msg">Interrupted by the system</span>}
      {status === 'error' && error && <span className="v-eo-badge__error-msg">{error}</span>}
    </div>
  );
}

function LocationDisplay({ location, status, error }) {
  if (!location) {
    return (
      <div className={`v-eo-location ${status === 'error' ? 'v-eo-location--error' : ''}`}>
        <MapPin size={14} strokeWidth={2.25} aria-hidden="true" />
        <span>{status === 'error' ? (error ?? 'GPS unavailable') : 'Acquiring GPS signal…'}</span>
      </div>
    );
  }

  const { latitude, longitude, accuracy, speed, timestamp } = location;

  return (
    <div className="v-eo-location v-eo-location--active">
      <MapPin size={14} strokeWidth={2.25} aria-hidden="true" />
      <div className="v-eo-location__details">
        <span className="v-eo-location__coords">
          {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </span>
        <span className="v-eo-location__meta">
          ±{accuracy}m
          {speed != null && speed > 0.5 ? ` · ${(speed * 3.6).toFixed(1)} km/h` : ''}
          {timestamp ? ` · ${formatShortTime(timestamp)}` : ''}
        </span>
        {status === 'error' && error && <span className="v-eo-location__stale">Last known position — {error}</span>}
        <a
          href={mapsUrl(location)}
          target="_blank"
          rel="noopener noreferrer"
          className="v-eo-location__maps-link"
          onClick={(e) => e.stopPropagation()}
        >
          Open in Maps ↗
        </a>
      </div>
    </div>
  );
}

function AlertsDisplay({ alerts }) {
  if (!alerts) return <p className="v-eo-log-empty">Preparing alert…</p>;
  if (alerts.status === AlertStatus.noContacts) {
    return <p className="v-eo-alert-warning">No emergency contacts saved — nobody was alerted.</p>;
  }
  return (
    <div className="v-eo-alerts">
      {alerts.recipients.map((r) => {
        const ok = [AlertStatus.sent, AlertStatus.delivered, AlertStatus.accepted].includes(r.status);
        const bad = r.status === AlertStatus.failed || r.status === AlertStatus.manualRequired;
        return (
          <div className="v-eo-alert-row" key={r.phoneNumber}>
            <span className="v-eo-alert-row__name">{r.name}</span>
            <span
              className="v-eo-alert-row__status"
              style={{ color: ok ? 'var(--color-safe)' : bad ? 'var(--color-emergency)' : 'var(--color-warning)' }}
            >
              {ALERT_STATUS_LABEL[r.status] ?? r.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function EmergencyActiveOverlay() {
  const {
    activeSession, log, alerts, isEnding,
    location, locationStatus, locationError,
    audio, video,
    resolve, cancel, openSmsComposer, restartRecording,
  } = useEmergency();

  if (!activeSession) return null;

  const canTextContacts =
    !!alerts &&
    alerts.status !== AlertStatus.noContacts &&
    alerts.recipients.some((r) => ![AlertStatus.sent, AlertStatus.delivered, AlertStatus.accepted, AlertStatus.sending].includes(r.status));

  const isLive = (s) => s === 'recording' || s === 'requesting';
  const recordingDown = !isEnding && (!isLive(audio.status) || !isLive(video.status));

  function handleResolve() {
    haptics.success();
    resolve();
  }

  function handleCancel() {
    const confirmed = window.confirm(
      'Cancel this emergency?\n\nThis stops recording and location sharing now. Only do this if you triggered SOS by accident. Anything already recorded is kept.'
    );
    if (confirmed) {
      haptics.warning();
      cancel();
    }
  }

  return (
    <div className="v-emergency-overlay" role="dialog" aria-modal="true" aria-label="Emergency active">
      <div className="v-emergency-overlay__header">
        <div className="v-eo-header-pulse" aria-hidden="true" />
        <h1 className={VFont.title}>🚨 Emergency Active</h1>
        <p className={VFont.caption}>
          {TRIGGER_SOURCE[activeSession.triggerSource] ?? activeSession.triggerSource}
          {' · '}
          {formatShortTime(activeSession.startedAt)}
        </p>
      </div>

      <div className="v-emergency-overlay__body">
        <section className="v-eo-section">
          <span className="v-eo-section__title">LIVE LOCATION</span>
          <LocationDisplay location={location ?? activeSession.location} status={locationStatus} error={locationError} />
        </section>

        <section className="v-eo-section">
          <span className="v-eo-section__title">CONTACT ALERTS</span>
          <AlertsDisplay alerts={alerts} />
          {canTextContacts && !isEnding && (
            <SecondaryButton onClick={openSmsComposer}>
              <MessageSquare size={16} strokeWidth={2.25} aria-hidden="true" /> Text contacts
            </SecondaryButton>
          )}
        </section>

        <section className="v-eo-section">
          <span className="v-eo-section__title">EVIDENCE RECORDING</span>
          <div className="v-eo-badges">
            <RecordingBadge label="Audio" state={audio} />
            <RecordingBadge label="Video" state={video} />
          </div>
          {recordingDown && !isEnding && (
            <SecondaryButton onClick={restartRecording}>
              <RotateCcw size={16} strokeWidth={2.25} aria-hidden="true" /> Restart recording
            </SecondaryButton>
          )}
        </section>

        <section className="v-eo-section v-eo-section--log">
          <span className="v-eo-section__title">ACTIVITY LOG</span>
          <div className="v-emergency-overlay__log" aria-live="polite">
            {log.length === 0 && <p className="v-eo-log-empty">Starting emergency systems…</p>}
            {log.map((entry) => (
              <div className={`v-emergency-overlay__log-row v-eo-log--${entry.level ?? 'info'}`} key={entry.id}>
                <span className="v-emergency-overlay__log-time">{formatStandardTime(entry.timestamp)}</span>
                <span className={VFont.subheadline}>{entry.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="v-emergency-overlay__actions">
        <PrimaryButton onClick={handleResolve} disabled={isEnding}>
          {isEnding ? 'Ending emergency…' : "✅ I'm Safe — End Emergency"}
        </PrimaryButton>
        <SecondaryButton onClick={handleCancel} disabled={isEnding}>
          False Alarm — Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}
