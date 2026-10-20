import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from '../platform/platform';

/**
 * notificationService.js — on-device notifications
 *
 * During an active emergency the native app shows an ongoing notification
 * ("Emergency active — tap to return") so the user can get back to the
 * SOS screen quickly if they switch apps. It is only posted when the
 * notification permission is granted; callers get { shown: false, reason }
 * otherwise, and nothing claims a notification was shown when it wasn't.
 */

const EMERGENCY_NOTIFICATION_ID = 911;
const CHANNEL_ID = 'vishwas-emergency';
let channelReady = false;

async function ensureChannel(ln) {
  if (channelReady) return;
  try {
    await ln.createChannel({
      id: CHANNEL_ID,
      name: 'Emergency status',
      description: 'Shown while a VISHWAS emergency is active',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch {
    // iOS has no channels (createChannel is Android-only); safe to continue.
  }
  channelReady = true;
}

export function createNotificationService({ ln = LocalNotifications, native = isNative } = {}) {
  return {
    async showEmergencyActive(session) {
      if (!native()) return { shown: false, reason: 'web' };
      try {
        const perm = await ln.checkPermissions();
        if (perm.display !== 'granted') return { shown: false, reason: 'permission' };
        await ensureChannel(ln);
        await ln.schedule({
          notifications: [
            {
              id: EMERGENCY_NOTIFICATION_ID,
              title: 'VISHWAS emergency active',
              body: 'Recording and location sharing are on. Tap to return to the SOS screen.',
              channelId: CHANNEL_ID,
              ongoing: true,
              autoCancel: false,
              extra: { sessionId: session.id },
            },
          ],
        });
        return { shown: true };
      } catch (err) {
        return { shown: false, reason: err?.message ?? 'error' };
      }
    },

    async clearEmergencyActive() {
      if (!native()) return;
      try {
        await ln.cancel({ notifications: [{ id: EMERGENCY_NOTIFICATION_ID }] });
      } catch {
        // Notification already gone or permission revoked — nothing to clear.
      }
    },
  };
}

export const notificationService = createNotificationService();
