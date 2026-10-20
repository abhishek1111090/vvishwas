import { describe, it, expect, beforeEach } from 'vitest';
import { createEmergencyManager, SessionStatus } from './emergencyManager';
import { STORAGE_KEYS } from '../utils/constants';
import { memoryStorage } from '../test/fakes';

describe('emergencyManager', () => {
  let storage;
  let clock;
  let manager;

  beforeEach(() => {
    storage = memoryStorage();
    clock = new Date('2026-10-20T10:00:00Z');
    manager = createEmergencyManager({ storage, now: () => clock });
  });

  it('starts a session with trigger source, timestamp and timeline', () => {
    const result = manager.trigger('button');
    expect(result.started).toBe(true);
    const snap = manager.getSnapshot();
    expect(snap.isActive).toBe(true);
    expect(snap.activeSession.triggerSource).toBe('button');
    expect(snap.activeSession.startedAt).toBe('2026-10-20T10:00:00.000Z');
    expect(snap.activeSession.status).toBe(SessionStatus.active);
    expect(snap.log[0].message).toMatch(/SOS Button/);
  });

  it('refuses a second session while one is active (duplicate prevention)', () => {
    const first = manager.trigger('button');
    const second = manager.trigger('tripleTap');
    expect(second.started).toBe(false);
    expect(second.reason).toBe('alreadyActive');
    expect(manager.getSnapshot().activeSession.id).toBe(first.session.id);
  });

  it('logs ignored duplicates at most once per 5 seconds', () => {
    manager.trigger('button');
    manager.trigger('tripleTap');
    manager.trigger('tripleTap');
    manager.trigger('tripleTap');
    const ignored = manager.getSnapshot().log.filter((e) => e.message.includes('ignored'));
    expect(ignored).toHaveLength(1);
    clock = new Date(clock.getTime() + 6000);
    manager.trigger('tripleTap');
    expect(manager.getSnapshot().log.filter((e) => e.message.includes('ignored'))).toHaveLength(2);
  });

  it('persists the active session on every change', () => {
    manager.trigger('tripleTap');
    manager.appendLog('hello');
    expect(storage.data[STORAGE_KEYS.emergencyActive].log.at(-1).message).toBe('hello');
  });

  it('resolve moves the session into persisted history and clears the active session', () => {
    manager.trigger('button');
    clock = new Date(clock.getTime() + 60_000);
    const ended = manager.resolve();
    expect(ended.status).toBe(SessionStatus.resolved);
    expect(ended.endedAt).toBe('2026-10-20T10:01:00.000Z');
    const snap = manager.getSnapshot();
    expect(snap.isActive).toBe(false);
    expect(snap.history[0].id).toBe(ended.id);
    expect(storage.data[STORAGE_KEYS.emergencyHistory][0].status).toBe('resolved');
    expect(storage.data[STORAGE_KEYS.emergencyActive]).toBeUndefined();
  });

  it('cancel records a cancelled session', () => {
    manager.trigger('button');
    const ended = manager.cancel();
    expect(ended.status).toBe(SessionStatus.cancelled);
    expect(manager.getSnapshot().history[0].log.at(-1).message).toMatch(/false alarm/);
  });

  it('allows a new session after the previous one ended', () => {
    manager.trigger('button');
    manager.resolve();
    expect(manager.trigger('tripleTap').started).toBe(true);
  });

  it('beginEnding only succeeds once', () => {
    manager.trigger('button');
    expect(manager.beginEnding()).toBe(true);
    expect(manager.beginEnding()).toBe(false);
    expect(manager.getSnapshot().activeSession.status).toBe(SessionStatus.ending);
  });

  it('restores a session left active by an app restart', () => {
    manager.trigger('button');
    const id = manager.getSnapshot().activeSession.id;
    const reborn = createEmergencyManager({ storage, now: () => clock });
    expect(reborn.getSnapshot().isActive).toBe(false);
    const restored = reborn.restore();
    expect(restored.id).toBe(id);
    expect(restored.restoredAfterRestart).toBe(true);
    expect(reborn.getSnapshot().log.at(-1).message).toMatch(/restarted/);
  });

  it('restore returns null when nothing was active', () => {
    expect(manager.restore()).toBeNull();
  });

  it('appendLog and update are no-ops without an active session', () => {
    manager.appendLog('x');
    manager.update({ location: {} });
    expect(manager.getSnapshot().isActive).toBe(false);
  });

  it('deleteHistoryItem removes a past session', () => {
    manager.trigger('button');
    const ended = manager.resolve();
    manager.deleteHistoryItem(ended.id);
    expect(manager.getSnapshot().history).toHaveLength(0);
  });

  it('reports persistence failure instead of hiding it', () => {
    storage.writeJSON.mockImplementation(() => false);
    manager.trigger('button');
    expect(manager.getSnapshot().persistFailed).toBe(true);
  });
});
