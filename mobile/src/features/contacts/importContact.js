import { Contact } from 'expo-contacts';

/**
 * Opens the OS contact picker. Only the one contact the user picks is read
 * (mirrors ContactPickerView.swift — never blanket Contacts access).
 * Resolves { name, phoneNumber } | { cancelled: true } | { error }.
 */
export async function importContactFromPhone(contactApi = Contact) {
  try {
    const picked = await contactApi.presentPicker();
    if (!picked) return { cancelled: true };
    const [name, phones] = await Promise.all([picked.getFullName(), picked.getPhones()]);
    const phoneNumber = phones?.find((p) => p?.number)?.number ?? '';
    if (!phoneNumber) return { error: `${name || 'That contact'} has no phone number.` };
    return { name: (name || 'Imported Contact').trim(), phoneNumber };
  } catch (err) {
    return { error: err?.message ? `Couldn’t open contacts: ${err.message}` : 'Couldn’t open your contacts.' };
  }
}
