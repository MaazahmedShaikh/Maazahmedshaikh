import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, AppStateStatus, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import {
  DEFAULT_STEALTH_CONFIG,
  loadStealthConfig,
  StealthConfig,
} from './src/lib/stealthConfig';
import {
  registerExpoPushToken,
  requestNotificationPermission,
  setSuppressForegroundAlerts,
  triggerDisguisedNotification,
} from './src/lib/notifications';
import { clearMemoryCache } from './src/lib/memoryCache';
import { RootScreen, Thread, User } from './src/types/database';
import { usePrivacyGuard } from './src/hooks/usePrivacyGuard';
import { CalculatorScreen } from './src/screens/CalculatorScreen';
import { DecoyNotesScreen } from './src/screens/DecoyNotesScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { VaultListScreen } from './src/screens/VaultListScreen';
import { ChatScreen } from './src/screens/ChatScreen';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error('App ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0B141A', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#E9EDEF', fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>App Notice</Text>
          <Text style={{ color: '#8696A0', textAlign: 'center', marginBottom: 20 }}>{String(this.state.error?.message || this.state.error)}</Text>
          <TouchableOpacity
            style={{ backgroundColor: '#00A884', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={{ color: '#0B141A', fontWeight: 'bold' }}>Restart App</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<RootScreen>('calculator');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [unlockedThreadIds, setUnlockedThreadIds] = useState<Set<string>>(new Set());

  // Anti-Intrusion lockout state (3 failed PIN attempts = 1 hr lockout)
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimestamp, setLockoutTimestamp] = useState<number | null>(null);
  const [stealthConfig, setStealthConfig] = useState<StealthConfig>(DEFAULT_STEALTH_CONFIG);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [suspendAutoLock, setSuspendAutoLock] = useState(false);
  const [privacyMasked, setPrivacyMasked] = useState(false);
  const currentScreenRef = useRef<RootScreen>(currentScreen);
  const activeThreadIdRef = useRef<string | null>(null);
  const disguisedNotifRef = useRef<boolean>(stealthConfig.disguisedNotifications);
  const suspendAutoLockRef = useRef<boolean>(false);
  const knownUnreadIdsRef = useRef<Set<string>>(new Set());
  const inactivityTimerRef = useRef<any>(null);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
    activeThreadIdRef.current = activeThread?.id ?? null;
    setSuppressForegroundAlerts(currentScreen === 'chat');
  }, [currentScreen, activeThread?.id]);

  useEffect(() => {
    disguisedNotifRef.current = stealthConfig.disguisedNotifications;
  }, [stealthConfig.disguisedNotifications]);

  useEffect(() => {
    suspendAutoLockRef.current = suspendAutoLock;
  }, [suspendAutoLock]);

  // Check if currently locked out
  const isLockedOut = Boolean(
    lockoutTimestamp && Date.now() < lockoutTimestamp
  );

  // Global Panic Lock callback: wipes RAM cache & state and returns to decoy calculator
  const handlePanicLock = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    clearMemoryCache();
    setSuspendAutoLock(false);
    setCurrentScreen('calculator');
    setActiveThread(null);
    setUnlockedThreadIds(new Set());
  }, []);

  // Inactivity Auto-Lock timer: resets on every touch or screen change when inside the vault
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    const timeoutSecs = stealthConfig.inactivityTimeoutSeconds;
    if (currentScreenRef.current !== 'calculator' && timeoutSecs > 0 && !suspendAutoLockRef.current) {
      inactivityTimerRef.current = setTimeout(() => {
        handlePanicLock();
      }, timeoutSecs * 1000);
    }
  }, [stealthConfig.inactivityTimeoutSeconds, handlePanicLock]);

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [currentScreen, stealthConfig.inactivityTimeoutSeconds, suspendAutoLock, resetInactivityTimer]);

  // Hook privacy guard: blocks screenshots, shows instant Calculator mask on 'inactive', hard-locks on 'background'
  const isSecureScreen = currentScreen !== 'calculator';
  usePrivacyGuard({
    onPanicLock: handlePanicLock,
    onBackgroundStateChange: setPrivacyMasked,
    isActiveScreenSecure: isSecureScreen,
    motionAutoLock: stealthConfig.motionAutoLock,
    suspendAutoLock,
  });

  // Initialize Supabase Auth & StealthConfig safely before rendering
  useEffect(() => {
    let mounted = true;
    Promise.all([loadStealthConfig(), supabase.auth.getSession()])
      .then(([cfg, res]) => {
        if (!mounted) return;
        setStealthConfig(cfg);
        setCurrentUser((res as any)?.data?.session?.user ?? null);
      })
      .finally(() => {
        if (mounted) {
          setBooting(false);
        }
      });

    const res = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      res?.data?.subscription?.unsubscribe?.();
    };
  }, []);

  // Global Realtime listener, push token registration & foreground reconnect sync
  useEffect(() => {
    if (!currentUser) {
      knownUnreadIdsRef.current.clear();
      return;
    }

    if (disguisedNotifRef.current) {
      requestNotificationPermission();
      registerExpoPushToken(currentUser.id);
    }

    let mounted = true;

    const syncUnreadMessages = async (notifyOnNew: boolean) => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, thread_id')
        .neq('sender_id', currentUser.id)
        .is('read_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(100);

      if (!mounted || error || !data) return;

      const counts: Record<string, number> = {};
      let hasBrandNew = false;

      (data as { id: string; thread_id: string }[]).forEach((row) => {
        counts[row.thread_id] = (counts[row.thread_id] || 0) + 1;
        const viewingThisChat =
          currentScreenRef.current === 'chat' && activeThreadIdRef.current === row.thread_id;
        if (!knownUnreadIdsRef.current.has(row.id)) {
          knownUnreadIdsRef.current.add(row.id);
          if (notifyOnNew && !viewingThisChat) {
            hasBrandNew = true;
          }
        }
      });

      setUnreadCounts(counts);

      if (hasBrandNew && disguisedNotifRef.current) {
        triggerDisguisedNotification();
      }
    };

    syncUnreadMessages(false);

    const channel = supabase
      .channel('realtime:global_disguised_alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { id?: string; sender_id?: string; thread_id?: string };
          if (msg.sender_id && msg.thread_id && msg.sender_id !== currentUser.id) {
            if (msg.id) {
              knownUnreadIdsRef.current.add(msg.id);
            }
            const viewingThisChat =
              currentScreenRef.current === 'chat' &&
              activeThreadIdRef.current === msg.thread_id;
            if (!viewingThisChat) {
              const tId = msg.thread_id;
              setUnreadCounts((prev) => ({
                ...prev,
                [tId]: (prev[tId] || 0) + 1,
              }));
              if (disguisedNotifRef.current) {
                triggerDisguisedNotification();
              }
            }
          }
        }
      )
      .subscribe();

    // Reconnect Realtime WebSocket cleanly when resuming from OS sleep/background
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        try {
          (supabase.realtime as any)?.connect?.();
        } catch {}
        syncUnreadMessages(true);
      }
    });

    return () => {
      mounted = false;
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [currentUser, stealthConfig.disguisedNotifications]);

  const handleTriggerDuress = async () => {
    if (stealthConfig.duressAction === 'wipe') {
      try {
        await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('threads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.auth.signOut();
        setCurrentUser(null);
      } catch {
        // Ignore errors under duress and still show decoy vault
      }
    }
    clearMemoryCache();
    setActiveThread(null);
    setUnlockedThreadIds(new Set());
    setCurrentScreen('duress_vault');
  };

  const handleUnlockVault = () => {
    if (isLockedOut) return;

    if (currentUser) {
      setCurrentScreen('vault_list');
    } else {
      setCurrentScreen('auth');
    }
  };

  const handleOpenDecoyNotes = () => {
    setCurrentScreen('decoy_notes');
  };

  const handleAuthSuccess = () => {
    setCurrentScreen('vault_list');
  };

  const handleSelectThread = (thread: Thread) => {
    setUnreadCounts((prev) => {
      if (!prev[thread.id]) return prev;
      const next = { ...prev };
      delete next[thread.id];
      return next;
    });
    setActiveThread(thread);
    setCurrentScreen('chat');
  };

  const handleUnlockThreadId = (id: string) => {
    setUnlockedThreadIds((prev) => new Set(prev).add(id));
    setFailedAttempts(0);
  };

  const handleRecordFailedAttempt = () => {
    setFailedAttempts((prev) => {
      const next = prev + 1;
      if (next >= 3) {
        // Lock out for 1 hour (3600000 ms)
        setLockoutTimestamp(Date.now() + 3600000);
        handlePanicLock();
        return 0;
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    clearMemoryCache();
    await supabase.auth.signOut();
    setCurrentUser(null);
    handlePanicLock();
  };

  if (booting) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
          <StatusBar style="light" />
          <ActivityIndicator size="large" color="#00A884" />
          <Text style={{ color: '#8696A0', fontSize: 14, fontWeight: '600' }}>SmartCalc</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
          <View style={{ flex: 1 }} onTouchStartCapture={resetInactivityTimer}>
            <StatusBar style="light" />

        {currentScreen === 'calculator' && (
          <CalculatorScreen
            onUnlockVault={handleUnlockVault}
            onOpenDecoyNotes={handleOpenDecoyNotes}
            onTriggerDuress={handleTriggerDuress}
            vaultCode={stealthConfig.vaultCode}
            decoyNotesCode={stealthConfig.decoyNotesCode}
            duressCode={stealthConfig.duressCode}
            isLockedOut={isLockedOut}
          />
        )}

        {currentScreen === 'decoy_notes' && (
          <DecoyNotesScreen onLock={handlePanicLock} />
        )}

        {currentScreen === 'auth' && (
          <AuthScreen
            onAuthSuccess={handleAuthSuccess}
            onLock={handlePanicLock}
          />
        )}

        {currentScreen === 'vault_list' && (
          <VaultListScreen
            currentUser={currentUser}
            unreadCounts={unreadCounts}
            onSelectThread={handleSelectThread}
            onLock={handlePanicLock}
            onSignOut={handleSignOut}
            unlockedThreadIds={unlockedThreadIds}
            onUnlockThreadId={handleUnlockThreadId}
            onRecordFailedAttempt={handleRecordFailedAttempt}
            stealthConfig={stealthConfig}
            onUpdateStealthConfig={setStealthConfig}
          />
        )}

        {currentScreen === 'duress_vault' && (
          <VaultListScreen
            currentUser={currentUser}
            onSelectThread={() => {}}
            onLock={handlePanicLock}
            onSignOut={handlePanicLock}
            unlockedThreadIds={new Set()}
            onUnlockThreadId={() => {}}
            onRecordFailedAttempt={() => {}}
            stealthConfig={stealthConfig}
            isDuressMode={true}
          />
        )}

        {currentScreen === 'chat' && activeThread && currentUser && (
          <ChatScreen
            thread={activeThread}
            currentUserId={currentUser.id}
            currentUser={currentUser}
            onUpdateThread={setActiveThread}
            onSuspendAutoLock={setSuspendAutoLock}
            onBack={() => {
              setActiveThread(null);
              setCurrentScreen('vault_list');
            }}
            onLock={handlePanicLock}
          />
        )}

        {/* Instant Switcher Mask: guarantees minimized previews never show chat/vault UI */}
        {privacyMasked && currentScreen !== 'calculator' && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="none">
            <CalculatorScreen
              onUnlockVault={() => {}}
              onOpenDecoyNotes={() => {}}
              onTriggerDuress={() => {}}
              vaultCode={stealthConfig.vaultCode}
              decoyNotesCode={stealthConfig.decoyNotesCode}
              duressCode={stealthConfig.duressCode}
              isLockedOut={isLockedOut}
            />
          </View>
        )}
          </View>
        </ErrorBoundary>
    </SafeAreaProvider>
  );
}
