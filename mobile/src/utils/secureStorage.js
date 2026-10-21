import * as SecureStore from 'expo-secure-store';

// secureStorage.js
// ----------------
// Small JSON wrapper around expo-secure-store: iOS Keychain / Android
// Keystore-encrypted storage. Used for password hashes and the signed-in
// session — the closest thing to the original Swift app's KeychainService.

const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function secureGetJSON(key, fallback = null) {
  try {
    const raw = await SecureStore.getItemAsync(key, OPTIONS);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function secureSetJSON(key, value) {
  await SecureStore.setItemAsync(key, JSON.stringify(value), OPTIONS);
}

export async function secureRemove(key) {
  try {
    await SecureStore.deleteItemAsync(key, OPTIONS);
  } catch {
    // Already gone.
  }
}
