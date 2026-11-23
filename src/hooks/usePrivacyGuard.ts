import { useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Accelerometer } from 'expo-sensors';

interface PrivacyGuardOptions {
  onPanicLock: () => void;
}

/**
 * Global privacy hook:
 * 1. Prevents screenshots and obscures app switcher preview
 * 2. Locks app back to calculator on AppState inactive / background
 * 3. Locks app back to calculator on face-down (z < -0.88) or sharp shake (magnitude > 2.6)
 */
export function usePrivacyGuard({ onPanicLock }: PrivacyGuardOptions) {
  // Prevent screenshots
  ScreenCapture.usePreventScreenCapture();

  // App Switcher preview protection for iOS
  useEffect(() => {
    if (Platform.OS === 'ios') {
      try {
        const sc: any = ScreenCapture;
        if (typeof sc.enableAppSwitcherProtectionAsync === 'function') {
          sc.enableAppSwitcherProtectionAsync(1.0);
        }
      } catch (err) {
        // Fallback gracefully on unsupporting platforms
      }
    }
  }, []);

  // AppState listener: background / inactive immediately resets to decoy calculator
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        onPanicLock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onPanicLock]);

  // Accelerometer listener: face-down flip or sharp shake
  useEffect(() => {
    Accelerometer.setUpdateInterval(150);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // 1. Flipping face-down (z < -0.88)
      if (z < -0.88) {
        onPanicLock();
        return;
      }

      // 2. Sharp shake (total acceleration vector magnitude > 2.6 Gs)
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude > 2.6) {
        onPanicLock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onPanicLock]);
}
