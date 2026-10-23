import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { importContactFromPhone } from '../features/contacts/importContact';
import { AddEditContactSheet } from '../features/contacts/AddEditContactSheet';
import { ContactsProvider } from '../context/ContactsContext';
import { contactsService } from '../services/contactsService';
import { initStorage } from '../utils/storage';

// The native contacts module isn't loadable in Jest; these tests pass a fake picker.
jest.mock('expo-contacts', () => ({ Contact: { presentPicker: jest.fn() } }));
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : () => null) }));
beforeEach(async () => { await initStorage(); });

// Add a contact from the phone's contact book: pick → form pre-filled →
// choose the number → Save.

function fakePicked(name, phones) {
  return { presentPicker: jest.fn(async () => ({ getFullName: async () => name, getPhones: async () => phones })) };
}

describe('importContactFromPhone', () => {
  it('returns every distinct number with its label', async () => {
    const res = await importContactFromPhone(fakePicked('Asha Verma', [
      { label: 'mobile', number: '+91 98765 43210' },
      { label: '_$!<Home>!$_', number: '0141 222 3333' },
      { label: 'work', number: '9876543210' }, // same as the mobile → dropped
    ]));
    expect(res).toEqual({ name: 'Asha Verma', phones: [{ label: 'mobile', number: '+91 98765 43210' }, { label: 'Home', number: '0141 222 3333' }] });
  });

  it('cancel and contacts without numbers are reported, not added', async () => {
    expect(await importContactFromPhone({ presentPicker: jest.fn(async () => null) })).toEqual({ cancelled: true });
    expect(await importContactFromPhone(fakePicked('No Number', []))).toEqual({ error: 'No Number has no phone number.' });
  });

  it('turns the iOS "picking in progress" failure into a clear instruction', async () => {
    const stuck = { presentPicker: jest.fn(async () => { throw new Error("Calling the 'presentPicker' function has failed → Caused by: ContactPickingInProgressException"); }) };
    expect((await importContactFromPhone(stuck)).error).toMatch(/Close VISHWAS completely and reopen it/);
  });
});

describe('add form pre-filled from the contact book', () => {
  it('lets the person choose which number and saves it', async () => {
    const onClose = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ContactsProvider>
        <AddEditContactSheet
          isOpen
          contact={null}
          onClose={onClose}
          prefill={{ name: 'Asha Verma', phones: [{ label: 'mobile', number: '+91 98765 43210' }, { label: 'Home', number: '+91 14122 23333' }] }}
        />
      </ContactsProvider>
      </SafeAreaProvider>
    );
    expect(screen.getByText('From your contact book — check the details, then Save.')).toBeTruthy();
    expect(screen.getByDisplayValue('Asha Verma')).toBeTruthy();
    expect(screen.getByDisplayValue('+91 98765 43210')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Home +91 14122 23333'));
    expect(screen.getByDisplayValue('+91 14122 23333')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(contactsService.getAll().map((c) => [c.name, c.phoneNumber])).toContainEqual(['Asha Verma', '+911412223333']);
  });
});
