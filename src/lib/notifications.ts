import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const ANDROID_CHANNEL_ID = 'smartcalc_tips';
const FALLBACK_EAS_PROJECT_ID = '2f1d6dac-5bbc-4aa1-88e0-81680d9a46e1';

const DISGUISED_ALERTS = [
  { title: 'SmartCalc', body: 'Tip: Rotate or tap +/- for quick sign conversion.' },
  { title: 'SmartCalc', body: 'Memory register cleared.' },
  { title: 'SmartCalc', body: 'Precision calculation engine ready.' },
  { title: 'SmartCalc', body: 'Daily calculation summary updated.' },
];

let handlerConfigured = false;
let channelConfigured = false;
let suppressForegroundAlerts = false;

export function setSuppressForegroundAlerts(suppress: boolean) {
  suppressForegroundAlerts = suppress;
}

/**
 * Configures foreground notification behavior without exposing message data.
 */
export function ensureNotificationHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: !suppressForegroundAlerts,
        shouldShowList: !suppressForegroundAlerts,
        shouldPlaySound: !suppressForegroundAlerts,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Ignore on unsupported environments
  }
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || channelConfigured) return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Calculator Tips',
      importance: 4, // AndroidImportance.HIGH
      vibrationPattern: [0, 200, 140, 200],
      lightColor: '#00A884',
      sound: 'default',
    });
    channelConfigured = true;
  } catch {
    // Ignore on unsupported devices
  }
}

/**
 * Requests notification permissions safely on Android 13+ and iOS.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    ensureNotificationHandler();
    await ensureAndroidChannel();
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Registers the device Expo Push Token in Supabase (safe no-op if APNs/FCM credentials are unavailable).
 */
export async function registerExpoPushToken(userId: string): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const granted = await requestNotificationPermission();
    if (!granted) return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      FALLBACK_EAS_PROJECT_ID;

    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenRes?.data;
    if (!expoPushToken) return null;

    await supabase.from('user_push_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' }
    );

    return expoPushToken;
  } catch {
    // Fail gracefully (e.g. sideloaded free Apple ID lacks aps-environment)
    return null;
  }
}

/**
 * Marks which thread (if any) the user currently has actively open in foreground,
 * so backend pg_net push triggers (ntfy & Expo Push) stay silent while chatting inside that thread.
 */
export async function setActiveChatForPush(
  userId: string,
  threadId: string | null
): Promise<void> {
  try {
    const activeUntil = threadId ? new Date(Date.now() + 35000).toISOString() : null;
    await supabase
      .from('user_push_tokens')
      .update({ active_thread_id: threadId, active_until: activeUntil })
      .eq('user_id', userId);
  } catch {
    // Ignore transient network errors
  }
}

/**
 * Fires a harmless, disguised local notification with zero sender/message info.
 */
export async function triggerDisguisedNotification(): Promise<void> {
  try {
    ensureNotificationHandler();
    await ensureAndroidChannel();
    const pick = DISGUISED_ALERTS[Math.floor(Math.random() * DISGUISED_ALERTS.length)];
    await Notifications.scheduleNotificationAsync({
      content: {
        title: pick.title,
        body: pick.body,
        sound: true,
      },
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch {
    // Ignore if permissions denied
  }
}
