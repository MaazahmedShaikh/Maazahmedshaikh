import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_STORAGE_KEY = 'smartcalc_display_prefs_v1';

export type DuressAction = 'empty_vault' | 'wipe';

export interface StealthConfig {
  vaultCode: string;
  decoyNotesCode: string;
  hiddenSearchCode: string;
  duressCode: string;
  duressAction: DuressAction;
  disguisedNotifications: boolean;
  motionAutoLock: boolean;
}

export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  vaultCode: '7391',
  decoyNotesCode: '0000',
  hiddenSearchCode: '9999',
  duressCode: '9111',
  duressAction: 'empty_vault',
  disguisedNotifications: true,
  motionAutoLock: true,
};

/**
 * Loads user-configurable stealth codes from AsyncStorage, falling back to defaults.
 */
export async function loadStealthConfig(): Promise<StealthConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_STEALTH_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      vaultCode: sanitizeCode(parsed.vaultCode, DEFAULT_STEALTH_CONFIG.vaultCode),
      decoyNotesCode: sanitizeCode(parsed.decoyNotesCode, DEFAULT_STEALTH_CONFIG.decoyNotesCode),
      hiddenSearchCode: sanitizeCode(parsed.hiddenSearchCode, DEFAULT_STEALTH_CONFIG.hiddenSearchCode),
      duressCode: sanitizeCode(parsed.duressCode, DEFAULT_STEALTH_CONFIG.duressCode),
      duressAction: parsed.duressAction === 'wipe' ? 'wipe' : 'empty_vault',
      disguisedNotifications:
        typeof parsed.disguisedNotifications === 'boolean'
          ? parsed.disguisedNotifications
          : true,
      motionAutoLock:
        typeof parsed.motionAutoLock === 'boolean' ? parsed.motionAutoLock : true,
    };
  } catch {
    return DEFAULT_STEALTH_CONFIG;
  }
}

/**
 * Persists updated stealth codes to AsyncStorage.
 */
export async function saveStealthConfig(config: StealthConfig): Promise<StealthConfig> {
  const sanitized: StealthConfig = {
    vaultCode: sanitizeCode(config.vaultCode, DEFAULT_STEALTH_CONFIG.vaultCode),
    decoyNotesCode: sanitizeCode(config.decoyNotesCode, DEFAULT_STEALTH_CONFIG.decoyNotesCode),
    hiddenSearchCode: sanitizeCode(config.hiddenSearchCode, DEFAULT_STEALTH_CONFIG.hiddenSearchCode),
    duressCode: sanitizeCode(config.duressCode, DEFAULT_STEALTH_CONFIG.duressCode),
    duressAction: config.duressAction === 'wipe' ? 'wipe' : 'empty_vault',
    disguisedNotifications: Boolean(config.disguisedNotifications),
    motionAutoLock: Boolean(config.motionAutoLock),
  };

  await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

function sanitizeCode(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const digits = val.replace(/[^0-9]/g, '');
  return digits.length >= 3 && digits.length <= 8 ? digits : fallback;
}
