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
 * 2. Locks app back to calculator on AppState background
 * 3. Locks app back to calculator on face-down (z < -0.88) or sharp shake (magnitude > 2.6)
 */
export function usePrivacyGuard({ onPanicLock }: PrivacyGuardOptions) {
  // Prevent screenshots safely on Android (on iOS, screen capture prevention overlays a black window)
  useEffect(() => {
    try {
      if (Platform.OS === 'android') {
        ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      }
    } catch {}
  }, []);

  // AppState listener: background resets to decoy calculator
  // (Do NOT trigger on 'inactive' as iOS always transitions through 'inactive' during app launch!)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background') {
        onPanicLock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onPanicLock]);

  // Accelerometer listener: face-down flip or sharp shake
  useEffect(() => {
    let subscription: any = null;
    try {
      Accelerometer.setUpdateInterval(250);

      subscription = Accelerometer.addListener(({ x, y, z }) => {
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
    } catch (e) {
      // Gracefully continue if sensors are restricted
    }

    return () => {
      try {
        subscription?.remove?.();
      } catch {}
    };
  }, [onPanicLock]);
}
