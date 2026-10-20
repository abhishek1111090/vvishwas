import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronUp, MapPin, Trash2, History } from 'lucide-react';
import { useEmergency } from '../../context/EmergencyContext';
import { Card } from '../../design-system/index.js';
import { VFont } from '../../design-system/theme';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { formatDateTime, formatStandardTime, formatDuration } from '../../utils/formatDate';
import { mapsUrl } from '../../services/locationService';
import { ALERT_STATUS_LABEL } from '../../services/alertService';
import { getPlayableUrl } from '../../services/recordingStore';
import { SESSION_STATUS_LABEL } from '../home/RecentActivityList';
import './history.css';

const RECORDING_STATUS = {
  saved: 'Saved privately on this device',
  ready: 'Captured in browser (not saved after closing)',
  error: 'Not saved',
  idle: 'Not recorded',
};

function RecordingRow({ label, recording }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  if (!recording) return null;

  async function handlePlay() {
    setError(null);
    try {
      const playable = await getPlayableUrl(recording);
      if (!playable) setError('Recording file not available.');
      setUrl(playable);
    } catch (err) {
      setError(err?.message ?? 'Could not open recording.');
    }
  }

  const canPlay = recording.status === 'saved' || (recording.status === 'ready' && recording.url);
  const isVideo = label === 'Video';

  return (
    <div className="v-history__recording">
      <div className="v-history__recording-head">
        <span className={VFont.subheadline}>{label}</span>
        <span className="v-history__muted">
          {RECORDING_STATUS[recording.status] ?? recording.status}
          {recording.bytes ? ` · ${Math.max(1, Math.round(recording.bytes / 1024))} KB` : ''}
          {recording.interrupted ? ' · interrupted' : ''}
        </span>
      </div>
      {recording.error && <span className="v-history__error">{recording.error}</span>}
      {canPlay && !url && (
        <button type="button" className="v-history__link-btn" onClick={handlePlay}>Play</button>
      )}
      {url && (isVideo
        ? <video className="v-history__media" src={url} controls playsInline />
        : <audio className="v-history__media" src={url} controls />)}
      {error && <span className="v-history__error">{error}</span>}
    </div>
  );
}

function SessionCard({ session, onDelete }) {
  const [open, setOpen] = useState(false);
  const status = SESSION_STATUS_LABEL[session.status] ?? { text: session.status, color: 'inherit' };
  const alerts = session.alerts;

  return (
    <Card>
      <div className="v-history__session">
        <button type="button" className="v-history__summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="v-history__summary-main">
            <span className={VFont.headline}>SOS via {TRIGGER_SOURCE[session.triggerSource] ?? session.triggerSource}</span>
            <span className="v-history__muted">
              {formatDateTime(session.startedAt)}
              {session.endedAt ? ` · ${formatDuration(session.startedAt, session.endedAt)}` : ''}
            </span>
          </span>
          <span className="v-history__status" style={{ color: status.color }}>{status.text}</span>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>

        {open && (
          <div className="v-history__details">
            <section>
              <h3 className="v-history__section-title">CONTACT ALERTS</h3>
              {!alerts && <p className="v-history__muted">No alert was attempted.</p>}
              {alerts?.recipients?.length === 0 && (
                <p className="v-history__muted">{ALERT_STATUS_LABEL[alerts.status] ?? alerts.status}</p>
              )}
              {alerts?.recipients?.map((r) => (
                <div className="v-history__row" key={r.phoneNumber}>
                  <span>{r.name}</span>
                  <span className="v-history__muted">{ALERT_STATUS_LABEL[r.status] ?? r.status}{r.error ? ` — ${r.error}` : ''}</span>
                </div>
              ))}
            </section>

            <section>
              <h3 className="v-history__section-title">LAST LOCATION</h3>
              {session.location ? (
                <a className="v-history__link-btn" href={mapsUrl(session.location)} target="_blank" rel="noopener noreferrer">
                  <MapPin size={14} aria-hidden="true" /> {session.location.latitude.toFixed(5)}, {session.location.longitude.toFixed(5)} (±{session.location.accuracy}m)
                </a>
              ) : (
                <p className="v-history__muted">No location fix was obtained.</p>
              )}
            </section>

            <section>
              <h3 className="v-history__section-title">EVIDENCE</h3>
              {session.recordings ? (
                <>
                  <RecordingRow label="Audio" recording={session.recordings.audio} />
                  <RecordingRow label="Video" recording={session.recordings.video} />
                </>
              ) : (
                <p className="v-history__muted">No recordings.</p>
              )}
            </section>

            <section>
              <h3 className="v-history__section-title">TIMELINE</h3>
              {session.log.map((entry) => (
                <div className={`v-history__log v-history__log--${entry.level ?? 'info'}`} key={entry.id}>
                  <span className="v-history__log-time">{formatStandardTime(entry.timestamp)}</span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </section>

            <button type="button" className="v-history__delete" onClick={() => onDelete(session)}>
              <Trash2 size={16} aria-hidden="true" /> Remove from history
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const { history, deleteHistoryItem } = useEmergency();

  function handleDelete(session) {
    const ok = window.confirm(
      'Remove this emergency from history?\n\nThe timeline entry is removed. Saved recordings stay in the app\'s private storage.'
    );
    if (ok) deleteHistoryItem(session.id);
  }

  return (
    <div className="v-history">
      <header className="v-history__topbar">
        <button type="button" className="v-home__icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={20} strokeWidth={2.25} />
        </button>
        <h1 className={['v-home__title', VFont.headline].join(' ')}>Emergency History</h1>
        <span className="v-history__spacer" aria-hidden="true" />
      </header>

      <div className="v-history__list">
        {history.length === 0 ? (
          <div className="v-history__empty">
            <History size={40} color="var(--color-text-secondary)" aria-hidden="true" />
            <p className={VFont.subheadline}>No emergencies yet. Ended SOS sessions appear here.</p>
          </div>
        ) : (
          history.map((s) => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)
        )}
      </div>
    </div>
  );
}
