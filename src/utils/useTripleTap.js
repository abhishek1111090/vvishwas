import { useRef, useCallback } from 'react';

// useTripleTap.js
// ----------------
// CONVERSION NOTE (SwiftUI -> React): mirrors TripleTapTrigger.swift's
// ViewModifier wrapping `.simultaneousGesture(TapGesture(count: 3))`.
//
// BUG (was causing unnecessary re-renders): the original version included
// `callback` in `useCallback`'s dependency array. Since callers always pass
// an inline arrow function (e.g. `useTripleTap(() => emergency.trigger(...))`),
// `callback` was a new reference on every render → `useCallback` recreated
// the handler every render → the entire page's onClick handler was a new
// function every render. Fixed by storing `callback` in a ref and only
// depending on `windowMs` (which is stable). This is the standard React
// pattern for "stable handler that closes over changing values".
//
// Usage: const onClick = useTripleTap(() => emergency.trigger('tripleTap'));
//        <div onClick={onClick}>...</div>

export function useTripleTap(callback, windowMs = 600) {
  const tapTimestamps = useRef([]);

  // Keep the latest callback in a ref so the memoized handler below always
  // calls the most recent version without needing it as a dep.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(
    (event) => {
      const now = Date.now();
      tapTimestamps.current = [
        ...tapTimestamps.current,
        now,
      ].filter((t) => now - t <= windowMs);

      if (tapTimestamps.current.length >= 3) {
        tapTimestamps.current = [];
        callbackRef.current(event);
      }
    },
    [windowMs] // stable — doesn't include callback, uses ref instead
  );
}
