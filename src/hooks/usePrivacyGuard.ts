import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Accelerometer } from 'expo-sensors';

interface PrivacyGuardOptions {
  onPanicLock: () => void;
  onBackgroundStateChange?: (isMasked: boolean) => void;
  isActiveScreenSecure?: boolean;
  motionAutoLock?: boolean;
  suspendAutoLock?: boolean;
}

/**
 * Global privacy hook:
 * 1. Prevents screenshots on Android (avoids iOS black screen overlay)
 * 2. Immediately masks the screen with Calculator overlay on 'inactive' (app switcher / Control Center)
 *    and locks app back to calculator on 'background' (unless suspended for OS media picker)
 * 3. Locks app back to calculator on held face-down flip (1 full second) or extreme shake
 */
export function usePrivacyGuard({
  onPanicLock,
  onBackgroundStateChange,
  isActiveScreenSecure = false,
  motionAutoLock = true,
  suspendAutoLock = false,
}: PrivacyGuardOptions) {
  const faceDownTimer = useRef<any>(null);
  const suspendAutoLockRef = useRef(suspendAutoLock);
  const onMaskChangeRef = useRef(onBackgroundStateChange);
  const leftActiveRef = useRef(AppState.currentState !== 'active');

  useEffect(() => {
    suspendAutoLockRef.current = suspendAutoLock;
  }, [suspendAutoLock]);

  useEffect(() => {
    onMaskChangeRef.current = onBackgroundStateChange;
  }, [onBackgroundStateChange]);

  // Prevent screenshots safely on Android only (avoids iOS black screen overlay)
  useEffect(() => {
    try {
      if (Platform.OS === 'android') {
        ScreenCapture.preventScreenCaptureAsync().catch(() => { });
      }
    } catch { }
  }, []);

  // AppState: lock immediately to Calculator on BOTH 'inactive' (Home/switcher/lock button on iOS)
  // and 'background', and re-assert panic lock on 'active' resume in case the OS suspended JS mid-transition.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (suspendAutoLockRef.current) {
        return;
      }
      if (nextAppState === 'active') {
        if (leftActiveRef.current) {
          leftActiveRef.current = false;
          onPanicLock();
        }
        onMaskChangeRef.current?.(false);
      } else {
        leftActiveRef.current = true;
        onMaskChangeRef.current?.(true);
        onPanicLock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onPanicLock]);

  // Accelerometer: ONLY active when inside secure screens AND motionAutoLock is enabled
  useEffect(() => {
    if (!isActiveScreenSecure || !motionAutoLock || suspendAutoLock) {
      if (faceDownTimer.current) {
        clearTimeout(faceDownTimer.current);
        faceDownTimer.current = null;
      }
      return;
    }

    // iOS CoreMotion reports gravity (-1 face-up), whereas Android SensorManager reports reaction force (+1 face-up).
    // Normalize Z so face-up is +1 and face-down is -1 on both platforms.
    const zSign = Platform.OS === 'ios' ? -1 : 1;

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

        // 2. Deliberate face-down: normalizedZ < -0.92 held continuously for 1 full second
        const normalizedZ = z * zSign;
        if (normalizedZ < -0.92) {
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
    } catch {
      // Gracefully continue if sensors are restricted
    }

    return () => {
      try {
        subscription?.remove?.();
      } catch { }
      if (faceDownTimer.current) {
        clearTimeout(faceDownTimer.current);
        faceDownTimer.current = null;
      }
    };
  }, [onPanicLock, isActiveScreenSecure, motionAutoLock, suspendAutoLock]);
}
