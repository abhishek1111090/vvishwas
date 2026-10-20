import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { STORAGE_KEYS } from '../utils/constants';

// The browser has no GPS in jsdom; give the Capacitor plugin a deterministic fake.
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: vi.fn(async () => ({ location: 'granted', coarseLocation: 'granted' })),
    requestPermissions: vi.fn(async () => ({ location: 'granted', coarseLocation: 'granted' })),
    getCurrentPosition: vi.fn(async () => ({ coords: { latitude: 26.9, longitude: 75.8, accuracy: 20 }, timestamp: Date.now() })),
    watchPosition: vi.fn(async (_o, cb) => {
      setTimeout(() => cb({ coords: { latitude: 26.9, longitude: 75.8, accuracy: 8 }, timestamp: Date.now() }), 0);
      return 'w1';
    }),
    clearWatch: vi.fn(async () => {}),
  },
}));

const { default: App } = await import('./App');
const { emergencyManager } = await import('../services/emergencyManager');

function go(path) {
  window.history.pushState({}, '', path);
}

function seedSignedInUser() {
  localStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
  localStorage.setItem(STORAGE_KEYS.localUsers, JSON.stringify([
    { id: 'u1', fullName: 'Priya Sharma', email: 'priya@example.com', authProvider: 'email', createdAt: '2026-01-01' },
  ]));
  localStorage.setItem(STORAGE_KEYS.sessionUserId, JSON.stringify('u1'));
}

async function endAnyEmergency() {
  if (emergencyManager.getSnapshot().isActive) {
    const { emergencyController } = await import('../services/emergencyController');
    await emergencyController.endEmergency('cancel');
  }
}

describe('VISHWAS app flows', () => {
  beforeEach(async () => {
    await endAnyEmergency();
    go('/');
  });

  it('first launch → onboarding → Skip → permissions → Continue → welcome; returning user skips onboarding', async () => {
    const { unmount } = render(<App />);
    expect(await screen.findByText(/One Tap Away/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /skip to permissions/i }));
    expect(screen.getByText('Set Up Protection')).toBeInTheDocument();
    // Permission statuses come from the platform, never auto-granted:
    expect(screen.getByText('Live GPS Location')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue to vishwas|finish setup/i }));
    expect(await screen.findByRole('button', { name: /continue with email/i })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.onboardingComplete)).toBe('true');
    unmount();

    go('/');
    render(<App />);
    expect(await screen.findByRole('button', { name: /continue with email/i })).toBeInTheDocument();
    expect(screen.queryByText(/One Tap Away/)).not.toBeInTheDocument();
  });

  it('onboarding Next walks the slides to Get Started', async () => {
    render(<App />);
    await screen.findByText(/One Tap Away/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
    expect(screen.getByText('Set Up Protection')).toBeInTheDocument();
  });

  it('sign up with validation errors, then success lands on the dashboard; session survives a restart', async () => {
    localStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /continue with email/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Account' }));
    expect(await within(dialog).findByText('Please enter your name.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Full Name'), { target: { value: 'Priya' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'bad-email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Account' }));
    expect(await within(dialog).findByText('Please enter a valid email address.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'priya@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Account' }));
    expect(await within(dialog).findByText(/8–128 characters/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Account' }));
    expect(await screen.findByRole('button', { name: /send sos emergency alert/i }, { timeout: 5000 })).toBeInTheDocument();
    unmount();

    go('/');
    render(<App />);
    expect(await screen.findByRole('button', { name: /send sos emergency alert/i })).toBeInTheDocument();
  });

  it('sign in shows a generic error for wrong credentials', async () => {
    localStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /i already have an account/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'nobody@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'whatever123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign In' }));
    expect(await within(dialog).findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('forgot password is honest that email reset needs the server', async () => {
    localStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /i already have an account/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
    const dialogs = screen.getAllByRole('dialog');
    const forgot = dialogs[dialogs.length - 1];
    fireEvent.change(within(forgot).getByLabelText('Email'), { target: { value: 'priya@example.com' } });
    fireEvent.click(within(forgot).getByRole('button', { name: 'Send Reset Link' }));
    expect(await within(forgot).findByText(/needs the VISHWAS server/, { selector: '.v-auth-error' })).toBeInTheDocument();
    expect(within(forgot).queryByText('Check Your Email')).not.toBeInTheDocument();
  });

  it('protected routes redirect to sign-in when signed out', async () => {
    localStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
    go('/contacts');
    render(<App />);
    expect(await screen.findByRole('button', { name: /continue with email/i })).toBeInTheDocument();
  });

  it('contacts: validation error, add, favorite, edit, delete', async () => {
    seedSignedInUser();
    go('/contacts');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Contact' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Full Name'), { target: { value: 'Asha' } });
    fireEvent.change(within(dialog).getByLabelText(/Phone Number/), { target: { value: '12ab' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/only contain digits/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Phone Number/), { target: { value: '+91 98765 43210' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }));
    expect(screen.getByText('Favorites')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Asha'));
    dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Relationship/), { target: { value: 'Sister' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Sister · +919876543210')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText('No Emergency Contacts Yet')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.contacts))).toEqual([]);
  });

  it('manual SOS: confirmation → active overlay → I\'m Safe → history', async () => {
    seedSignedInUser();
    go('/home');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /send sos emergency alert/i }));
    expect(screen.getByText('Trigger Emergency?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /yes — send alert/i }));

    const overlay = await screen.findByRole('dialog', { name: 'Emergency active' });
    expect(within(overlay).getByText(/Emergency Active/)).toBeInTheDocument();
    expect(within(overlay).getAllByText(/SOS Button/).length).toBeGreaterThan(0);
    // No contacts → overlay must say nobody was alerted (no fake success):
    expect(await within(overlay).findByText(/nobody was alerted/)).toBeInTheDocument();
    // jsdom has no MediaRecorder → recording must show unavailable, not "Recording":
    expect(within(overlay).getAllByText(/Unavailable/).length).toBeGreaterThan(0);
    // Real (fake-plugin) GPS fix appears:
    expect(await within(overlay).findByText('26.900000, 75.800000')).toBeInTheDocument();

    fireEvent.click(within(overlay).getByRole('button', { name: /i'm safe/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Emergency active' })).not.toBeInTheDocument());
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.emergencyHistory))[0].status).toBe('resolved');
  });

  it('triple-tap anywhere triggers SOS immediately (no confirmation) and only once', async () => {
    seedSignedInUser();
    go('/home');
    render(<App />);
    const title = await screen.findByText('Recent Activity');
    fireEvent.click(title);
    fireEvent.click(title);
    fireEvent.click(title);
    const overlay = await screen.findByRole('dialog', { name: 'Emergency active' });
    expect(within(overlay).getAllByText(/Triple Tap/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Trigger Emergency?')).not.toBeInTheDocument();

    // More taps while active must not start anything new.
    const id = emergencyManager.getSnapshot().activeSession.id;
    fireEvent.click(overlay);
    fireEvent.click(overlay);
    fireEvent.click(overlay);
    expect(emergencyManager.getSnapshot().activeSession.id).toBe(id);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(overlay).getByRole('button', { name: /false alarm/i }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Emergency active' })).not.toBeInTheDocument());
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('sign out returns to the welcome screen', async () => {
    seedSignedInUser();
    go('/profile');
    render(<App />);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('button', { name: /continue with email/i })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.sessionUserId)).toBeNull();
  });
});
