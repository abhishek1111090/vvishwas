// validation.js
// -------------
// CONVERSION NOTE: mirrors the validation logic that lived inline in
// AuthViewModel.swift (isValidEmail, the `password.count >= 8` guard in
// AuthService.signUp). Pulled into standalone functions here so both the
// auth forms and authService.js can share one definition.

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

export function isValidEmail(email) {
  return EMAIL_REGEX.test((email ?? '').trim());
}

export function isStrongEnoughPassword(password) {
  return (password ?? '').length >= 8;
}

export function isNonEmpty(value) {
  return (value ?? '').trim().length > 0;
}
