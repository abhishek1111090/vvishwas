import { useRef, useCallback, useLayoutEffect } from 'react';

// useTripleTap — mirrors TripleTapTrigger.swift. Returns touch handlers for
// a container View. Touch events bubble in React Native, so a tap anywhere
// inside counts. Only real taps count: a touch that moved more than 12pt
// (a scroll or swipe) or lasted longer than 350 ms is ignored.

const MAX_MOVE = 12;
const MAX_TAP_MS = 350;

export function useTripleTap(callback, windowMs = 600) {
  const taps = useRef([]);
  const start = useRef(null);
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const onTouchStart = useCallback((e) => {
    const { pageX, pageY } = e.nativeEvent;
    start.current = { x: pageX, y: pageY, t: Date.now() };
  }, []);

  const onTouchEnd = useCallback((e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const { pageX, pageY } = e.nativeEvent;
    const now = Date.now();
    if (Math.abs(pageX - s.x) > MAX_MOVE || Math.abs(pageY - s.y) > MAX_MOVE || now - s.t > MAX_TAP_MS) return;
    taps.current = [...taps.current, now].filter((t) => now - t <= windowMs);
    if (taps.current.length >= 3) {
      taps.current = [];
      callbackRef.current();
    }
  }, [windowMs]);

  return { onTouchStart, onTouchEnd };
}
