// validation.js
// -------------
// CONVERSION NOTE: mirrors the validation logic that lived inline in
// AuthViewModel.swift (isValidEmail, the `password.count >= 8` guard in
// AuthService.signUp). Pulled into standalone functions here so both the
// auth forms and authService.js can share one definition.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const LIMITS = {
  nameMax: 80,
  relationshipMax: 40,
  passwordMax: 128,
};

export function isValidEmail(email) {
  return EMAIL_REGEX.test((email ?? '').trim());
}

export function normalizeEmail(email) {
  return (email ?? '').trim().toLowerCase();
}

export function isStrongEnoughPassword(password) {
  const length = (password ?? '').length;
  return length >= 8 && length <= LIMITS.passwordMax;
}

export function isNonEmpty(value) {
  return (value ?? '').trim().length > 0;
}

/**
 * Normalize a user-typed phone number for storage and dialling:
 * keeps a single leading "+" and the digits; drops spaces, dashes,
 * dots and brackets. "+91 98765-43210" → "+919876543210".
 */
export function normalizePhone(phone) {
  const trimmed = (phone ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Returns null when valid, otherwise a user-facing error message.
 * Accepts local numbers (e.g. 10-digit Indian mobiles, short helplines
 * like 112 are rejected — contacts must be reachable people) and
 * international E.164 numbers (max 15 digits).
 */
export function validatePhone(phone) {
  const raw = (phone ?? '').trim();
  if (!raw) return 'Please enter a phone number.';
  if (/[^\d\s+().-]/.test(raw)) return 'Phone numbers can only contain digits, spaces, +, -, ( and ).';
  if (raw.indexOf('+') > 0 || (raw.match(/\+/g) ?? []).length > 1) {
    return 'A "+" is only allowed at the start of the number.';
  }
  const digits = normalizePhone(raw).replace('+', '');
  if (digits.length < 7) return 'That phone number is too short.';
  if (digits.length > 15) return 'That phone number is too long.';
  return null;
}
