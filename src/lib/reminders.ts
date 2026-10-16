import * as Notifications from 'expo-notifications';
import { LogBox, Platform } from 'react-native';

import { REMINDER_PREFIX, type ReminderSpec } from '@/data/reminders';

// Expo Go warns at every launch that *push* notifications need a development
// build. This app only schedules local ones, which Expo Go supports, so the
// warnings are noise that reads like a crash on the phone. LogBox rechecks
// earlier logs when a pattern is added, so ignoring them after the import works.
LogBox.ignoreLogs([
  '`expo-notifications` functionality is not fully supported in Expo Go',
  '[expo-notifications] Push notifications (remote notifications) are unavailable in Expo Go',
]);

/**
 * Putting the System's reminders on the phone.
 *
 * Local notifications only: they are scheduled on the device from the plan,
 * so they work in Expo Go and need no push server. Remote push (the System
 * reaching out on its own, with the app never opened) needs a development
 * build and is a later step.
 *
 * Nothing here runs on the web — the browser build has no notification
 * scheduler, so every entry point returns quietly there.
 */

const CHANNEL = 'system';
const supported = Platform.OS !== 'web';

let initialised = false;
let permission: 'unknown' | 'granted' | 'denied' = 'unknown';

/** Show reminders even while the app is open — a banner, not a takeover. */
export function initReminders(): void {
  if (!supported || initialised) return;
  initialised = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask once. On Android 13+ the system prompt only appears once a channel
 * exists, so the channel is created first.
 */
async function ensurePermission(): Promise<boolean> {
  if (permission !== 'unknown') return permission === 'granted';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'The System',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    permission = granted ? 'granted' : 'denied';
  } catch {
    permission = 'denied';
  }
  return permission === 'granted';
}

/**
 * Replace every System reminder with `specs`. Anything not scheduled by the
 * System — identified by its prefix — is left alone.
 */
export async function syncReminders(specs: ReminderSpec[]): Promise<void> {
  if (!supported) return;
  if (specs.length === 0 && permission === 'unknown') return;
  if (!(await ensurePermission())) return;

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(REMINDER_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    for (const spec of specs) {
      await Notifications.scheduleNotificationAsync({
        identifier: spec.id,
        content: { title: spec.title, body: spec.body, data: { url: spec.url } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: spec.at,
          channelId: CHANNEL,
        },
      });
    }
  } catch (err) {
    // A reminder that fails to schedule must never break the app.
    console.warn('[reminders] could not schedule', err);
  }
}

/** Where a tapped reminder wants to go, if anywhere. */
export function urlOf(response: Notifications.NotificationResponse | null): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}

export { Notifications };
