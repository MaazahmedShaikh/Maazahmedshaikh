import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, Text, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import {
  DEFAULT_STEALTH_CONFIG,
  loadStealthConfig,
  StealthConfig,
} from './src/lib/stealthConfig';
import {
  requestNotificationPermission,
  triggerDisguisedNotification,
} from './src/lib/notifications';
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
  const [currentScreen, setCurrentScreen] = useState<RootScreen>('calculator');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [unlockedThreadIds, setUnlockedThreadIds] = useState<Set<string>>(new Set());

  // Anti-Intrusion lockout state (3 failed PIN attempts = 1 hr lockout)
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimestamp, setLockoutTimestamp] = useState<number | null>(null);
  const [stealthConfig, setStealthConfig] = useState<StealthConfig>(DEFAULT_STEALTH_CONFIG);

  // Check if currently locked out
  const isLockedOut = Boolean(
    lockoutTimestamp && Date.now() < lockoutTimestamp
  );

  // Global Panic Lock callback: wipes state from memory and returns to decoy calculator
  const handlePanicLock = useCallback(() => {
    setCurrentScreen('calculator');
    setActiveThread(null);
    setUnlockedThreadIds(new Set());
  }, []);

  // Hook privacy guard: screenshots blocked, auto-lock on blur/shake/face-down
  // Only activate accelerometer motion sensors when inside secure screens (avoids calculator vibration triggers)
  const isSecureScreen = currentScreen !== 'calculator';
  usePrivacyGuard({ onPanicLock: handlePanicLock, isActiveScreenSecure: isSecureScreen });

  // Check Supabase Auth state & load StealthConfig on mount
  useEffect(() => {
    loadStealthConfig().then(setStealthConfig);

    supabase.auth.getSession().then((res: any) => {
      setCurrentUser(res?.data?.session?.user ?? null);
    });

    const res = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      res?.data?.subscription?.unsubscribe?.();
    };
  }, []);

  // Disguised local notification listener when logged in & enabled
  useEffect(() => {
    if (!currentUser || !stealthConfig.disguisedNotifications) return;

    requestNotificationPermission();

    const channel = supabase
      .channel('realtime:global_disguised_alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { sender_id?: string; thread_id?: string };
          if (msg.sender_id && msg.sender_id !== currentUser.id) {
            const viewingThisChat =
              currentScreen === 'chat' && activeThread?.id === msg.thread_id;
            if (!viewingThisChat) {
              triggerDisguisedNotification();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, stealthConfig.disguisedNotifications, currentScreen, activeThread?.id]);

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
    await supabase.auth.signOut();
    setCurrentUser(null);
    handlePanicLock();
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
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
            onBack={() => {
              setActiveThread(null);
              setCurrentScreen('vault_list');
            }}
            onLock={handlePanicLock}
          />
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
