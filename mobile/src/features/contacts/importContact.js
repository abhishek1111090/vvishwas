import { Contact } from 'expo-contacts';
import { normalizePhone } from '../../utils/validation';

/**
 * Opens the OS contact picker. Only the one contact the user picks is read
 * (mirrors ContactPickerView.swift — never blanket Contacts access).
 * Resolves { name, phones: [{ number, label }] } | { cancelled: true } | { error }.
 * Every distinct number is returned so the person can choose which one
 * VISHWAS should alert; the add form is then shown pre-filled to confirm.
 */
export async function importContactFromPhone(contactApi = Contact) {
  try {
    const picked = await contactApi.presentPicker();
    if (!picked) return { cancelled: true };
    const [name, phones] = await Promise.all([picked.getFullName(), picked.getPhones()]);
    const seen = new Set();
    const unique = (phones ?? [])
      .filter((p) => p?.number && normalizePhone(p.number).replace('+', '').length > 0)
      .filter((p) => {
        const key = normalizePhone(p.number).replace(/\D/g, '').slice(-10);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((p) => ({ number: p.number.trim(), label: p.label ? String(p.label).replace(/[_$!<>]/g, '').trim() : null }));
    if (unique.length === 0) return { error: `${name || 'That contact'} has no phone number.` };
    return { name: (name || '').trim(), phones: unique };
  } catch (err) {
    const raw = String(err?.message ?? '');
    if (/PickingInProgress|picking in progress/i.test(raw)) {
      return { error: 'Your contacts are still opening from a previous tap. Close VISHWAS completely and reopen it, then try again.' };
    }
    return { error: 'Couldn’t open your contacts. Try again, or add the person manually.' };
  }
}
