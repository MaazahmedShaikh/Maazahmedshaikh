import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const DISGUISED_ALERTS = [
  { title: 'SmartCalc', body: 'Tip: Rotate or tap +/- for quick sign conversion.' },
  { title: 'SmartCalc', body: 'Memory register cleared.' },
  { title: 'SmartCalc', body: 'Precision calculation engine ready.' },
  { title: 'SmartCalc', body: 'Daily calculation summary updated.' },
];

let handlerConfigured = false;

/**
 * Configures foreground notification behavior without exposing message data.
 */
export function ensureNotificationHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Ignore on unsupported environments
  }
}

/**
 * Requests notification permissions safely on Android 13+ and iOS.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    ensureNotificationHandler();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('smartcalc_tips', {
        name: 'Calculator Tips',
        importance: 3, // AndroidImportance.DEFAULT
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Fires a harmless, disguised local notification with zero sender/message info.
 */
export async function triggerDisguisedNotification(): Promise<void> {
  try {
    ensureNotificationHandler();
    const pick = DISGUISED_ALERTS[Math.floor(Math.random() * DISGUISED_ALERTS.length)];
    await Notifications.scheduleNotificationAsync({
      content: {
        title: pick.title,
        body: pick.body,
        sound: true,
      },
      trigger: null,
    });
  } catch {
    // Ignore if permissions denied
  }
}
