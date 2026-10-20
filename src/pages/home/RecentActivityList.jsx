import { CircleCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, VFont } from '../../design-system/index.js';
import { formatShortTime, formatShortDate } from '../../utils/formatDate';
import { TRIGGER_SOURCE } from '../../utils/constants';
import './home.css';

// RecentActivityList.jsx
// -------------------------
// CONVERSION NOTE: RecentActivityList.swift's header comment planned a
// persisted EmergencySession history store with a "See All" link for
// Phase 4. That store now exists (emergencyManager persists ended
// sessions), so this card shows the latest sessions and links to the full
// history page.

export const SESSION_STATUS_LABEL = {
  resolved: { text: 'Resolved', color: 'var(--color-safe)' },
  cancelled: { text: 'Cancelled', color: 'var(--color-text-secondary)' },
  active: { text: 'Active', color: 'var(--color-emergency)' },
  ending: { text: 'Ending', color: 'var(--color-warning)' },
};

export function RecentActivityList({ history = [] }) {
  const navigate = useNavigate();

  return (
    <Card>
      <div className="v-recent-activity">
        <div className="v-recent-activity__header">
          <span className={VFont.headline}>Recent Activity</span>
          {history.length > 0 && (
            <button type="button" className="v-recent-activity__link" onClick={() => navigate('/history')}>
              See All
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="v-recent-activity__empty">
            <CircleCheck size={18} color="var(--color-text-secondary)" aria-hidden="true" />
            <span className={VFont.subheadline}>No recent activity. You're all clear.</span>
          </div>
        ) : (
          history.slice(0, 3).map((session) => {
            const status = SESSION_STATUS_LABEL[session.status] ?? { text: session.status, color: 'inherit' };
            return (
              <div className="v-recent-activity__row" key={session.id}>
                <span className="v-recent-activity__time">
                  {formatShortDate(session.startedAt)}
                  <br />
                  {formatShortTime(session.startedAt)}
                </span>
                <span className="v-recent-activity__message">
                  SOS via {TRIGGER_SOURCE[session.triggerSource] ?? session.triggerSource}
                </span>
                <span className="v-recent-activity__status" style={{ color: status.color }}>{status.text}</span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
