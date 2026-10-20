import { Download, MapPin } from 'lucide-react';
import { useEmergency } from '../../context/EmergencyContext';
import { PrimaryButton, SecondaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import { formatShortTime, formatStandardTime } from '../../utils/formatDate';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import './sos.css';

/**
 * EmergencyActiveOverlay — shown as a fixed full-screen overlay during active SOS.
 *
 * Shows:
 *  • Session info (started via, time)
 *  • Live GPS coordinates with accuracy
 *  • Real-time recording status indicators (audio + video)
 *  • Download links for audio/video once recording stops
 *  • Activity log
 *  • "I'm Safe" and "False Alarm" action buttons
 *
 * Cannot be dismissed by swipe — equivalent to SwiftUI's .interactiveDismissDisabled().
 */

function RecordingBadge({ status, label, url, mime, error }) {
  const isRecording = status === 'recording';
  const isStopped   = status === 'stopped';
  const isError     = status === 'error';
  const isRequesting = status === 'requesting';

  let color = 'var(--color-text-secondary)';
  if (isRecording) color = '#ff3b30';
  if (isStopped)   color = 'var(--color-safe)';
  if (isError)     color = 'var(--color-warning)';

  // Derive a file extension from the MIME type for the download filename
  function mimeToExt(m) {
    if (!m) return '';
    if (m.includes('mp4')) return '.mp4';
    if (m.includes('webm')) return '.webm';
    if (m.includes('ogg')) return '.ogg';
    return '';
  }

  return (
    <div className="v-eo-badge" style={{ borderColor: color }}>
      <span className={`v-eo-badge__dot ${isRecording ? 'v-eo-badge__dot--pulse' : ''}`}
            style={{ background: color }} />
      <span className="v-eo-badge__label" style={{ color }}>
        {isRecording  && `${label} Recording`}
        {isRequesting && `${label} Starting…`}
        {isStopped    && `${label} Saved`}
        {isError      && `${label} Unavailable`}
        {status === 'idle' && `${label} Idle`}
      </span>
      {isStopped && url && (
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
      {isError && error && (
        <span className="v-eo-badge__error-msg">{error}</span>
      )}
    </div>
  );
}

function LocationDisplay({ location, status, error }) {
  if (status === 'error') {
    return (
      <div className="v-eo-location v-eo-location--error">
        <MapPin size={14} strokeWidth={2.25} aria-hidden="true" />
        <span>{error ?? 'GPS unavailable'}</span>
      </div>
    );
  }

  if (!location) {
    return (
      <div className="v-eo-location">
        <MapPin size={14} strokeWidth={2.25} aria-hidden="true" />
        <span>Acquiring GPS signal…</span>
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
        <a
          href={`https://maps.apple.com/?q=${latitude},${longitude}`}
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

export function EmergencyActiveOverlay() {
  const {
    activeSession, log,
    location, locationStatus, locationError,
    audioStatus, videoStatus,
    audioUrl, videoUrl, audioMime, videoMime,
    audioError, videoError,
    resolve, cancel,
  } = useEmergency();

  if (!activeSession) return null;

  function handleResolve() {
    haptics.success();
    resolve();
  }

  function handleCancel() {
    const confirmed = window.confirm(
      'Cancel this emergency?\n\nThis stops all recording and tracking immediately. Only do this if you triggered SOS by accident.'
    );
    if (confirmed) {
      haptics.warning();
      cancel();
    }
  }

  return (
    <div className="v-emergency-overlay" role="dialog" aria-modal="true" aria-label="Emergency active">
      {/* Header */}
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
        {/* Live Location */}
        <section className="v-eo-section">
          <span className="v-eo-section__title">LIVE LOCATION</span>
          <LocationDisplay
            location={location}
            status={locationStatus}
            error={locationError}
          />
        </section>

        {/* Recording Status */}
        <section className="v-eo-section">
          <span className="v-eo-section__title">EVIDENCE RECORDING</span>
          <div className="v-eo-badges">
            <RecordingBadge
              status={audioStatus}
              label="Audio"
              url={audioUrl}
              mime={audioMime}
              error={audioError}
            />
            <RecordingBadge
              status={videoStatus}
              label="Video"
              url={videoUrl}
              mime={videoMime}
              error={videoError}
            />
          </div>
        </section>

        {/* Activity Log */}
        <section className="v-eo-section v-eo-section--log">
          <span className="v-eo-section__title">ACTIVITY LOG</span>
          <div className="v-emergency-overlay__log">
            {log.length === 0 && (
              <p className="v-eo-log-empty">Starting emergency systems…</p>
            )}
            {log.map((entry) => (
              <div className="v-emergency-overlay__log-row" key={entry.id}>
                <span className="v-emergency-overlay__log-time">
                  {formatStandardTime(entry.timestamp)}
                </span>
                <span className={VFont.subheadline}>{entry.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Action buttons */}
      <div className="v-emergency-overlay__actions">
        <PrimaryButton onClick={handleResolve}>
          ✅ I'm Safe — End Emergency
        </PrimaryButton>
        <SecondaryButton onClick={handleCancel}>
          False Alarm — Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}
