import { CircleCheck } from 'lucide-react';
import { Card, VFont } from '../../design-system/index.js';
import { formatShortTime } from '../../utils/formatDate';
import './home.css';

// RecentActivityList.jsx
// -------------------------
// CONVERSION NOTE: mirrors RecentActivityList.swift, including its own
// header comment — Phase 1 shows the current EmergencyManager session log
// (cleared each time a new session starts, see emergencyManager.js), and
// Phase 4 swaps this for a persisted EmergencySession history store with a
// "See All" link. `log.suffix(4)` becomes `log.slice(-4)`.

export function RecentActivityList({ log }) {
  return (
    <Card>
      <div className="v-recent-activity">
        <span className={VFont.headline}>Recent Activity</span>

        {log.length === 0 ? (
          <div className="v-recent-activity__empty">
            <CircleCheck size={18} color="var(--color-text-secondary)" aria-hidden="true" />
            <span className={VFont.subheadline}>No recent activity. You're all clear.</span>
          </div>
        ) : (
          log.slice(-4).map((entry) => (
            <div className="v-recent-activity__row" key={entry.id}>
              <span className="v-recent-activity__time">{formatShortTime(entry.timestamp)}</span>
              <span className="v-recent-activity__message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
