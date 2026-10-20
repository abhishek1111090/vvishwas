import { Capacitor } from '@capacitor/core';

// platform.js
// -----------
// One place to ask "where are we running?" so services can choose between
// a native Capacitor plugin and the browser API without sprinkling
// Capacitor checks through UI code.

export function isNative() {
  return Capacitor.isNativePlatform();
}

/** 'android' | 'ios' | 'web' */
export function getPlatform() {
  return Capacitor.getPlatform();
}

export function isAndroid() {
  return getPlatform() === 'android';
}

export function isIOS() {
  return getPlatform() === 'ios';
}

export function isPluginAvailable(name) {
  return Capacitor.isPluginAvailable(name);
}
