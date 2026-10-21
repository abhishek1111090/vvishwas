import { createPermissionsService, PermissionStatus } from '../services/permissionsService';
import { createNotificationService } from '../services/notificationService';

// Regression: in Expo Go on Android, expo-notifications can't be loaded.
// The app must report notifications as unavailable instead of crashing.
describe('when expo-notifications is unavailable', () => {
  const fakeOk = { getForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true }) };

  it('permission status is "unavailable", never granted', async () => {
    const svc = createPermissionsService({ notifications: null, location: fakeOk });
    expect(await svc.check('notifications')).toBe(PermissionStatus.unavailable);
    expect(await svc.request('notifications')).toBe(PermissionStatus.unavailable);
  });

  it('the emergency notification reports it was not shown', async () => {
    const svc = createNotificationService({ notifications: null, platform: 'android' });
    expect(await svc.showEmergencyActive({ id: 's1' })).toEqual({ shown: false, reason: 'unavailable' });
    await expect(svc.clearEmergencyActive()).resolves.toBeUndefined();
  });
});
