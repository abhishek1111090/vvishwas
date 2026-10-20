import { describe, it, expect, vi } from 'vitest';
import { createLocationService, classifyLocationError, LocationErrorKind, mapsUrl } from './locationService';

function fakeGeo() {
  let cb = null;
  return {
    emitFix: (lat = 26.9, lng = 75.8) => cb({ coords: { latitude: lat, longitude: lng, accuracy: 9.6 }, timestamp: 1_700_000_000_000 }),
    emitError: (err) => cb(null, err),
    watchPosition: vi.fn(async (_opts, callback) => { cb = callback; return 'watch-1'; }),
    clearWatch: vi.fn(async () => {}),
    getCurrentPosition: vi.fn(),
  };
}

describe('locationService', () => {
  it('classifies native and browser errors', () => {
    expect(classifyLocationError({ code: 1 })).toBe(LocationErrorKind.permissionDenied);
    expect(classifyLocationError({ code: 'OS-PLUG-GLOC-0003' })).toBe(LocationErrorKind.permissionDenied);
    expect(classifyLocationError({ code: 'OS-PLUG-GLOC-0007' })).toBe(LocationErrorKind.servicesDisabled);
    expect(classifyLocationError({ message: 'Location services are not enabled' })).toBe(LocationErrorKind.servicesDisabled);
    expect(classifyLocationError({ code: 3 })).toBe(LocationErrorKind.timeout);
    expect(classifyLocationError({ code: 'OS-PLUG-GLOC-0010' })).toBe(LocationErrorKind.timeout);
    expect(classifyLocationError({ code: 2 })).toBe(LocationErrorKind.unavailable);
    expect(classifyLocationError({})).toBe(LocationErrorKind.unknown);
  });

  it('starts high-accuracy tracking and only exposes real fixes', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    expect(geo.watchPosition.mock.calls[0][0].enableHighAccuracy).toBe(true);
    expect(svc.getSnapshot()).toMatchObject({ status: 'acquiring', location: null });

    geo.emitFix();
    expect(svc.getSnapshot().status).toBe('tracking');
    expect(svc.getSnapshot().location).toMatchObject({ latitude: 26.9, longitude: 75.8, accuracy: 10 });
  });

  it('an error keeps the last real fix but flags the error', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    geo.emitFix();
    geo.emitError({ code: 'OS-PLUG-GLOC-0007' });
    const s = svc.getSnapshot();
    expect(s.status).toBe('error');
    expect(s.errorKind).toBe(LocationErrorKind.servicesDisabled);
    expect(s.location.latitude).toBe(26.9);
  });

  it('a denied permission never produces a location', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    geo.emitError({ code: 1, message: 'User denied Geolocation' });
    expect(svc.getSnapshot()).toMatchObject({ status: 'error', location: null, errorKind: 'permissionDenied' });
  });

  it('start is idempotent and stop clears the native watch', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    await svc.start();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await svc.stop();
    expect(geo.clearWatch).toHaveBeenCalledWith({ id: 'watch-1' });
    expect(svc.isTracking()).toBe(false);
  });

  it('getCurrent returns an error result instead of throwing', async () => {
    const geo = fakeGeo();
    geo.getCurrentPosition.mockRejectedValue({ code: 3 });
    const res = await createLocationService(geo).getCurrent();
    expect(res).toEqual({ errorKind: 'timeout', error: expect.any(String) });
  });

  it('waitForFix resolves null after the timeout when no fix arrives', async () => {
    vi.useFakeTimers();
    const svc = createLocationService(fakeGeo());
    const p = svc.waitForFix(1000);
    vi.advanceTimersByTime(1000);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('waitForFix resolves with the first fix', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    const p = svc.waitForFix(5000);
    geo.emitFix(1, 2);
    expect((await p).latitude).toBe(1);
  });

  it('waitForFix gives up immediately when permission is denied', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    const p = svc.waitForFix(60_000);
    geo.emitError({ code: 1 });
    expect(await p).toBeNull();
  });

  it('waitForFix keeps waiting through a timeout error', async () => {
    const geo = fakeGeo();
    const svc = createLocationService(geo);
    await svc.start();
    const p = svc.waitForFix(5000);
    geo.emitError({ code: 3 });
    geo.emitFix(3, 4);
    expect((await p).latitude).toBe(3);
  });

  it('builds a maps link', () => {
    expect(mapsUrl({ latitude: 1.5, longitude: 2.5 })).toBe('https://www.google.com/maps/search/?api=1&query=1.5,2.5');
    expect(mapsUrl(null)).toBeNull();
  });
});
