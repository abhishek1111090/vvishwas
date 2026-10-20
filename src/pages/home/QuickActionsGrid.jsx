import { useState } from 'react';
import { quickActions } from './quickActionsData';
import { IconBadge, VFont } from '../../design-system/index.js';
import { ComingSoonModal } from '../../components/ComingSoonModal';
import './home.css';

// QuickActionsGrid.jsx
// ----------------------
// CONVERSION NOTE: mirrors QuickActionsGrid.swift's `LazyVGrid` of two
// flexible columns + `.sheet(item: $selectedAction)`. `selectedAction` as
// an optional Swift enum (nil = no sheet) becomes `selectedAction` as
// `null | actionObject` here — same nil-driven-sheet pattern.

export function QuickActionsGrid() {
  const [selectedAction, setSelectedAction] = useState(null);

  return (
    <>
      <div className="v-quick-actions">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.id}
              className="v-quick-action-tile"
              onClick={() => setSelectedAction(action)}
            >
              <IconBadge icon={Icon} tint={action.tint} />
              <span className={VFont.headline}>{action.title}</span>
              <span className="v-quick-action-tile__subtitle">{action.subtitle}</span>
            </button>
          );
        })}
      </div>

      <ComingSoonModal
        isOpen={selectedAction !== null}
        onClose={() => setSelectedAction(null)}
        featureName={selectedAction?.title ?? ''}
        phase={2}
      />
    </>
  );
}
