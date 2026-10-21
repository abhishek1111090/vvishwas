import { Platform } from 'react-native';
import { loadNotifications } from '../utils/optionalModules';

/**
 * notificationService.js — "Emergency active" status notification
 *
 * While an SOS is active, a local notification lets the user jump back to
 * the SOS screen if they switch apps. Only posted when notification
 * permission is granted; callers get { shown: false, reason } otherwise.
 */

const CHANNEL_ID = 'vishwas-emergency';
let channelReady = false;

export function createNotificationService({ notifications = loadNotifications(), platform = Platform.OS } = {}) {
  let currentId = null;
  let handlerSet = false;

  // Inside the app the overlay is already visible, so don't show a banner
  // on top of it — only in the notification centre / when backgrounded.
  function ensureHandler() {
    if (handlerSet) return;
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerSet = true;
  }

  async function ensureChannel() {
    if (platform !== 'android' || channelReady) return;
    await notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Emergency status',
      importance: notifications.AndroidImportance?.HIGH ?? 4,
    });
    channelReady = true;
  }

  return {
    async showEmergencyActive(session) {
      if (!notifications) return { shown: false, reason: 'unavailable' };
      try {
        const perm = await notifications.getPermissionsAsync();
        if (!perm.granted) return { shown: false, reason: 'permission' };
        ensureHandler();
        await ensureChannel();
        currentId = await notifications.scheduleNotificationAsync({
          content: {
            title: 'VISHWAS emergency active',
            body: 'Recording and location sharing are on. Tap to return to the SOS screen.',
            sticky: true,
            data: { sessionId: session.id },
          },
          trigger: platform === 'android' ? { channelId: CHANNEL_ID } : null,
        });
        return { shown: true };
      } catch (err) {
        return { shown: false, reason: err?.message ?? 'error' };
      }
    },

    async clearEmergencyActive() {
      if (!currentId || !notifications) return;
      const id = currentId;
      currentId = null;
      try {
        await notifications.dismissNotificationAsync(id);
      } catch {
        // Already dismissed.
      }
    },
  };
}

export const notificationService = createNotificationService();
