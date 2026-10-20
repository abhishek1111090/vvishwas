import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { isAndroid } from './platform';
import { runTopBackHandler } from './backButton';
import { useEmergency } from '../context/EmergencyContext';

const ROOT_PATHS = new Set(['/', '/home', '/auth', '/onboarding']);

/**
 * Android back button behaviour:
 *   1. An open sheet/modal → close it.
 *   2. Emergency active → do nothing (the overlay must be ended explicitly
 *      with "I'm Safe" or "False Alarm"; an accidental back press must not
 *      hide it).
 *   3. Root screens (Home, Welcome, Onboarding) → minimize the app instead of
 *      killing it, so an emergency session/state isn't lost.
 *   4. Anywhere else → go back one screen.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isActive } = useEmergency();

  const stateRef = useRef({ pathname: location.pathname, isActive });
  stateRef.current = { pathname: location.pathname, isActive };

  useEffect(() => {
    if (!isAndroid()) return undefined;
    const handle = CapApp.addListener('backButton', () => {
      if (runTopBackHandler()) return;
      const { pathname, isActive: active } = stateRef.current;
      if (active) return;
      if (ROOT_PATHS.has(pathname)) {
        CapApp.minimizeApp().catch(() => {});
        return;
      }
      navigate(-1);
    });
    return () => {
      Promise.resolve(handle).then((h) => h.remove()).catch(() => {});
    };
  }, [navigate]);
}
