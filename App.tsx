import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { RootScreen, Thread, User } from './src/types/database';
import { usePrivacyGuard } from './src/hooks/usePrivacyGuard';
import { CalculatorScreen } from './src/screens/CalculatorScreen';
import { DecoyNotesScreen } from './src/screens/DecoyNotesScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { VaultListScreen } from './src/screens/VaultListScreen';
import { ChatScreen } from './src/screens/ChatScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<RootScreen>('calculator');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [unlockedThreadIds, setUnlockedThreadIds] = useState<Set<string>>(new Set());

  // Anti-Intrusion lockout state (3 failed PIN attempts = 1 hr lockout)
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimestamp, setLockoutTimestamp] = useState<number | null>(null);

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

  // Hook privacy guard: screenshots blocked, app-switcher obscured, auto-lock on blur/shake/face-down
  usePrivacyGuard({ onPanicLock: handlePanicLock });

  // Check Supabase Auth state on mount
  useEffect(() => {
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
      <StatusBar style="light" />

      {currentScreen === 'calculator' && (
        <CalculatorScreen
          onUnlockVault={handleUnlockVault}
          onOpenDecoyNotes={handleOpenDecoyNotes}
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
    </SafeAreaProvider>
  );
}
