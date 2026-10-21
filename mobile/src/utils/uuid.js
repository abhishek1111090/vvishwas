import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID from the OS's secure random generator. */
export function generateUUID() {
  return Crypto.randomUUID();
}
