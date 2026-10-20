import { X } from 'lucide-react';
import { VFont } from '../design-system/theme';
import './SheetHeader.css';

export function SheetHeader({ title, onClose, closeLabel = 'Cancel' }) {
  return (
    <div className="v-sheet-header">
      <button type="button" className="v-sheet-header__close" onClick={onClose} aria-label={closeLabel}>
        <X size={18} strokeWidth={2} />
        <span>{closeLabel}</span>
      </button>
      <h2 className={VFont.headline}>{title}</h2>
      <span className="v-sheet-header__spacer" aria-hidden="true" />
    </div>
  );
}
