import { useEmergency } from '../context/EmergencyContext';
import { useTripleTap } from '../utils/useTripleTap';
import { BottomNav } from './BottomNav';
import { EmergencyActiveOverlay } from '../pages/sos/EmergencyActiveOverlay';
import './AppShell.css';

// AppShell.jsx
// ------------
// Frame for every signed-in screen: scrollable viewport, bottom tab bar,
// global triple-tap SOS and the emergency overlay.
//
// The old simulated phone status bar (fake clock, fake signal bars and a
// "100%" battery shown even when the real level was unknown) was removed:
// in the native app the real OS status bar is visible above the WebView,
// so the shell now just reserves the safe-area inset for it.

/** Taps while typing in a field shouldn't count toward triple-tap SOS. */
function isTextEntryTarget(target) {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

export function AppShell({ children, showBottomNav = true }) {
  const emergency = useEmergency();

  // Global Triple-Tap SOS — the only triple-tap handler in the app, so one
  // gesture can never fire two triggers.
  const tripleTapHandler = useTripleTap(() => {
    if (emergency.isActive) return; // overlay is up; nothing to trigger
    emergency.trigger('tripleTap');
  });

  function handleClick(event) {
    if (isTextEntryTarget(event.target)) return;
    tripleTapHandler(event);
  }

  return (
    <div className="v-shell" onClick={handleClick}>
      <div className="v-shell__safe-top" aria-hidden="true" />

      <main className="v-shell__viewport">
        {children}
      </main>

      {showBottomNav && !emergency.isActive && <BottomNav />}

      {emergency.isActive && <EmergencyActiveOverlay />}
    </div>
  );
}
