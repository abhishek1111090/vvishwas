import { createLocationService, classifyLocationError, LocationErrorKind, mapsUrl } from '../services/locationService';

function fakeLocationModule({ permission = 'granted', servicesOn = true } = {}) {
  let cb = null;
  let errCb = null;
  const sub = { remove: jest.fn() };
  return {
    Accuracy: { High: 4, Balanced: 3 },
    emitFix: (lat = 26.9, lng = 75.8) => cb({ coords: { latitude: lat, longitude: lng, accuracy: 9.6 }, timestamp: 1_700_000_000_000 }),
    emitError: (reason) => errCb(reason),
    sub,
    getForegroundPermissionsAsync: jest.fn(async () => ({ status: permission })),
    hasServicesEnabledAsync: jest.fn(async () => servicesOn),
    watchPositionAsync: jest.fn(async (_o, callback, onError) => { cb = callback; errCb = onError; return sub; }),
    getLastKnownPositionAsync: jest.fn(async () => null),
    getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 1, longitude: 2, accuracy: 30 }, timestamp: 1 })),
  };
}

describe('locationService', () => {
  it('classifies Expo location errors', () => {
    expect(classifyLocationError({ code: 'E_LOCATION_UNAUTHORIZED' })).toBe(LocationErrorKind.permissionDenied);
    expect(classifyLocationError({ code: 'E_LOCATION_SERVICES_DISABLED' })).toBe(LocationErrorKind.servicesDisabled);
    expect(classifyLocationError({ message: 'Location request timed out' })).toBe(LocationErrorKind.timeout);
    expect(classifyLocationError({ code: 'E_LOCATION_UNAVAILABLE' })).toBe(LocationErrorKind.unavailable);
    expect(classifyLocationError({})).toBe(LocationErrorKind.unknown);
  });

  it('tracks with high accuracy and only exposes real fixes', async () => {
    const loc = fakeLocationModule();
    const svc = createLocationService(loc);
    await svc.start();
    expect(loc.watchPositionAsync.mock.calls[0][0].accuracy).toBe(4);
    expect(svc.getSnapshot()).toMatchObject({ status: 'acquiring', location: null });
    loc.emitFix();
    expect(svc.getSnapshot().location).toMatchObject({ latitude: 26.9, accuracy: 10 });
  });

  it('reports denied permission up front, without a location', async () => {
    const loc = fakeLocationModule({ permission: 'denied' });
    const svc = createLocationService(loc);
    await svc.start();
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
    expect(svc.getSnapshot()).toMatchObject({ status: 'error', errorKind: 'permissionDenied', location: null });
  });

  it('reports location services switched off', async () => {
    const svc = createLocationService(fakeLocationModule({ servicesOn: false }));
    await svc.start();
    expect(svc.getSnapshot().errorKind).toBe('servicesDisabled');
  });

  it('an error keeps the last real fix', async () => {
    const loc = fakeLocationModule();
    const svc = createLocationService(loc);
    await svc.start();
    loc.emitFix();
    loc.emitError('Location services are disabled');
    expect(svc.getSnapshot()).toMatchObject({ status: 'error', errorKind: 'servicesDisabled' });
    expect(svc.getSnapshot().location.latitude).toBe(26.9);
  });

  it('start is idempotent and stop removes the subscription', async () => {
    const loc = fakeLocationModule();
    const svc = createLocationService(loc);
    await svc.start();
    await svc.start();
    expect(loc.watchPositionAsync).toHaveBeenCalledTimes(1);
    await svc.stop();
    expect(loc.sub.remove).toHaveBeenCalled();
  });

  it('getCurrent prefers a recent cached fix and never throws', async () => {
    const loc = fakeLocationModule();
    expect((await createLocationService(loc).getCurrent()).location.latitude).toBe(1);
    loc.getCurrentPositionAsync.mockRejectedValue({ code: 'E_LOCATION_UNAVAILABLE' });
    expect(await createLocationService(loc).getCurrent()).toEqual({ errorKind: 'unavailable', error: expect.any(String) });
  });

  it('waitForFix gives up immediately when permission is denied', async () => {
    const svc = createLocationService(fakeLocationModule({ permission: 'denied' }));
    await svc.start();
    expect(await svc.waitForFix(60_000)).toBeNull();
  });

  it('waitForFix resolves with the first fix', async () => {
    const loc = fakeLocationModule();
    const svc = createLocationService(loc);
    await svc.start();
    const p = svc.waitForFix(5000);
    loc.emitFix(3, 4);
    expect((await p).latitude).toBe(3);
  });

  it('builds a maps link', () => {
    expect(mapsUrl({ latitude: 1.5, longitude: 2.5 })).toBe('https://www.google.com/maps/search/?api=1&query=1.5,2.5');
  });
});
