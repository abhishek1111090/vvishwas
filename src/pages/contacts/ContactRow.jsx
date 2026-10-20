import { Star, Trash2, Phone, MessageSquare } from 'lucide-react';
import { VFont } from '../../design-system/theme';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { withAlpha } from '../../utils/colorUtils';
import { haptics } from '../../services/hapticService';
import './contacts.css';

function priorityColor(priority) {
  if (priority === PRIORITY.primary)   return 'var(--color-emergency)';
  if (priority === PRIORITY.secondary) return '#0a84ff';
  return 'var(--color-text-secondary)';
}

function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function ContactRow({ contact, onEdit, onToggleFavorite, onDelete }) {
  const tint = priorityColor(contact.priority);

  return (
    <div className="v-contact-row">
      <button type="button" className="v-contact-row__tap-area" onClick={() => onEdit(contact)}>
        {contact.profileImageDataUrl ? (
          <img className="v-contact-row__avatar-img" src={contact.profileImageDataUrl} alt="" />
        ) : (
          <span
            className="v-contact-row__avatar-fallback"
            style={{
              background: withAlpha(tint, 0.15),
              color: tint,
            }}
          >
            {initials(contact.name)}
          </span>
        )}

        <span className="v-contact-row__details">
          <span className="v-contact-row__name-line">
            <span className={VFont.headline}>{contact.name}</span>
            {contact.isFavorite && (
              <Star size={12} color="#ffcc00" fill="#ffcc00" aria-label="Favorite" />
            )}
          </span>
          <span className={[VFont.caption, 'v-contact-row__subtitle'].join(' ')}>
            {contact.relationship
              ? `${contact.relationship} · ${contact.phoneNumber}`
              : contact.phoneNumber}
          </span>
        </span>

        <span
          className="v-contact-row__priority"
          style={{
            color: tint,
            background: withAlpha(tint, 0.12),
          }}
        >
          {PRIORITY_LABEL[contact.priority]}
        </span>
      </button>

      <div className="v-contact-row__actions">
        {/* Direct Mobile Quick-Call */}
        <a
          href={`tel:${contact.phoneNumber}`}
          className="v-contact-row__action v-contact-row__action--call"
          aria-label={`Call ${contact.name}`}
          onClick={(e) => {
            e.stopPropagation();
            haptics.medium();
          }}
        >
          <Phone size={16} strokeWidth={2.2} />
        </a>

        {/* Direct Mobile Quick-SMS */}
        <a
          href={`sms:${contact.phoneNumber}`}
          className="v-contact-row__action v-contact-row__action--sms"
          aria-label={`SMS ${contact.name}`}
          onClick={(e) => {
            e.stopPropagation();
            haptics.light();
          }}
        >
          <MessageSquare size={16} strokeWidth={2.2} />
        </a>

        {/* Favorite Toggle */}
        <button
          type="button"
          className="v-contact-row__action"
          aria-label={contact.isFavorite ? 'Unfavorite' : 'Favourite'}
          onClick={(e) => {
            e.stopPropagation();
            haptics.selection();
            onToggleFavorite(contact.id);
          }}
        >
          <Star
            size={16}
            color={contact.isFavorite ? '#ffcc00' : 'var(--color-text-secondary)'}
            fill={contact.isFavorite ? '#ffcc00' : 'none'}
          />
        </button>

        {/* Delete Action */}
        <button
          type="button"
          className="v-contact-row__action"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            haptics.warning();
            onDelete(contact.id);
          }}
        >
          <Trash2 size={16} color="var(--color-emergency)" />
        </button>
      </div>
    </div>
  );
}
