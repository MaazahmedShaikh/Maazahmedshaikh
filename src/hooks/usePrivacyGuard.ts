import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Accelerometer } from 'expo-sensors';

interface PrivacyGuardOptions {
  onPanicLock: () => void;
  isActiveScreenSecure?: boolean;
}

/**
 * Global privacy hook:
 * 1. Prevents screenshots on Android (avoids iOS black screen overlay)
 * 2. Locks app back to calculator on AppState background
 * 3. Locks app back to calculator on held face-down flip (1 full second) or extreme shake
 */
export function usePrivacyGuard({ onPanicLock, isActiveScreenSecure = false }: PrivacyGuardOptions) {
  const faceDownTimer = useRef<any>(null);

  // Prevent screenshots safely on Android only (avoids iOS black screen overlay)
  useEffect(() => {
    try {
      if (Platform.OS === 'android') {
        ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      }
    } catch {}
  }, []);

  // AppState: only lock when explicitly going to background (not during active use or transitions)
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

  // Accelerometer: ONLY active when inside the secure screens, and requires held face-down
  useEffect(() => {
    if (!isActiveScreenSecure) {
      if (faceDownTimer.current) {
        clearTimeout(faceDownTimer.current);
        faceDownTimer.current = null;
      }
      return;
    }

    let subscription: any = null;
    try {
      Accelerometer.setUpdateInterval(250);

      subscription = Accelerometer.addListener(({ x, y, z }) => {
        // 1. Extreme deliberate shake (magnitude > 3.6 Gs)
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > 3.6) {
          onPanicLock();
          return;
        }

        // 2. Deliberate face-down: must be held face down continuously for 1 full second
        if (z < -0.92) {
          if (!faceDownTimer.current) {
            faceDownTimer.current = setTimeout(() => {
              onPanicLock();
            }, 1000);
          }
        } else {
          if (faceDownTimer.current) {
            clearTimeout(faceDownTimer.current);
            faceDownTimer.current = null;
          }
        }
      });
    } catch (e) {
      // Gracefully continue if sensors are restricted
    }

    return () => {
      try {
        subscription?.remove?.();
      } catch {}
      if (faceDownTimer.current) {
        clearTimeout(faceDownTimer.current);
        faceDownTimer.current = null;
      }
    };
  }, [onPanicLock, isActiveScreenSecure]);
}
