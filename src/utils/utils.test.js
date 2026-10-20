import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isValidEmail, isStrongEnoughPassword, normalizePhone, validatePhone } from './validation';
import { useTripleTap } from './useTripleTap';
import { pushBackHandler, runTopBackHandler } from '../platform/backButton';
import { fromCapacitorState, PermissionStatus } from '../services/permissionsService';

describe('validation', () => {
  it('validates emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail(' a@b.co ')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it('validates password length bounds', () => {
    expect(isStrongEnoughPassword('1234567')).toBe(false);
    expect(isStrongEnoughPassword('12345678')).toBe(true);
    expect(isStrongEnoughPassword('x'.repeat(129))).toBe(false);
  });

  it('normalizes and validates phone numbers', () => {
    expect(normalizePhone(' +1 (555) 010-9999 ')).toBe('+15550109999');
    expect(validatePhone('+1 (555) 010-9999')).toBeNull();
    expect(validatePhone('')).toMatch(/enter/);
    expect(validatePhone('112')).toMatch(/too short/);
  });
});

describe('useTripleTap', () => {
  it('fires on the third tap within the window and resets', () => {
    const cb = vi.fn();
    const now = vi.spyOn(Date, 'now');
    const { result } = renderHook(() => useTripleTap(cb, 600));
    now.mockReturnValue(1000); result.current();
    now.mockReturnValue(1200); result.current();
    expect(cb).not.toHaveBeenCalled();
    now.mockReturnValue(1400); result.current();
    expect(cb).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1500); result.current();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when taps are too slow', () => {
    const cb = vi.fn();
    const now = vi.spyOn(Date, 'now');
    const { result } = renderHook(() => useTripleTap(cb, 600));
    now.mockReturnValue(1000); result.current();
    now.mockReturnValue(1500); result.current();
    now.mockReturnValue(2200); result.current();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('back button stack', () => {
  it('runs the top-most handler only, and unregisters cleanly', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = pushBackHandler(a);
    const offB = pushBackHandler(b);
    expect(runTopBackHandler()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    offB();
    runTopBackHandler();
    expect(a).toHaveBeenCalledTimes(1);
    offA();
    expect(runTopBackHandler()).toBe(false);
  });
});

describe('permission state mapping', () => {
  it('maps Capacitor permission states without assuming grants', () => {
    expect(fromCapacitorState('granted')).toBe(PermissionStatus.granted);
    expect(fromCapacitorState('denied')).toBe(PermissionStatus.denied);
    expect(fromCapacitorState('prompt')).toBe(PermissionStatus.notDetermined);
    expect(fromCapacitorState('prompt-with-rationale')).toBe(PermissionStatus.notDetermined);
    expect(fromCapacitorState('unavailable')).toBe(PermissionStatus.unavailable);
    expect(fromCapacitorState(undefined)).toBe(PermissionStatus.unavailable);
  });
});
