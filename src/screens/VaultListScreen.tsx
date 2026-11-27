import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';
import { decryptMessage, hashPin } from '../lib/cryptoCodec';
import { ensureDirectThread, getThreadDisplayTitle } from '../lib/directChat';
import {
  getCachedThreadActivity,
  getCachedPlaintext,
  setCachedPlaintext,
  setCachedThreadActivity,
  setCachedThreadMessages,
  ThreadActivitySummary,
} from '../lib/memoryCache';
import { Message, Thread, User } from '../types/database';
import { AppTheme } from '../theme/whatsappTheme';
import { useAppTheme } from '../theme/ThemeContext';
import { PinModal } from '../components/PinModal';
import { StealthSettingsModal } from '../components/StealthSettingsModal';
import { DEFAULT_STEALTH_CONFIG, saveStealthConfig, StealthConfig } from '../lib/stealthConfig';

interface VaultListScreenProps {
  currentUser?: User | null;
  unreadCounts?: Record<string, number>;
  onSelectThread: (thread: Thread) => void;
  onLock: () => void;
  onSignOut: () => void;
  unlockedThreadIds: Set<string>;
  onUnlockThreadId: (id: string) => void;
  onRecordFailedAttempt: () => void;
  stealthConfig?: StealthConfig;
  onUpdateStealthConfig?: (cfg: StealthConfig) => void;
  isDuressMode?: boolean;
}

export const VaultListScreen: React.FC<VaultListScreenProps> = ({
  currentUser = null,
  unreadCounts = {},
  onSelectThread,
  onLock,
  onSignOut,
  unlockedThreadIds,
  onUnlockThreadId,
  onRecordFailedAttempt,
  stealthConfig = DEFAULT_STEALTH_CONFIG,
  onUpdateStealthConfig,
  isDuressMode = false,
}) => {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadActivities, setThreadActivities] = useState<Record<string, ThreadActivitySummary>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(!isDuressMode);

  // Modals & Menus
  const [menuVisible, setMenuVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [newChatModalVisible, setNewChatModalVisible] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState('');

  // Selected thread for long press action
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  // PIN modal for opening locked thread or setting PIN
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinTargetThread, setPinTargetThread] = useState<Thread | null>(null);
  const [pinMode, setPinMode] = useState<'verify' | 'set'>('verify');
  const [pinError, setPinError] = useState<string | undefined>(undefined);

  const loadThreadSummariesAndPrefetch = useCallback(
    async (threadList: Thread[], isMounted?: () => boolean) => {
      if (isDuressMode || threadList.length === 0) return;

      const nowIso = new Date().toISOString();
      const { data: recentMeta } = await supabase
        .from('messages')
        .select('id, thread_id, sender_id, created_at, read_at')
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(40);

      if (isMounted && !isMounted()) return;

      const nextActivities: Record<string, ThreadActivitySummary> = {};
      threadList.forEach((t) => {
        const cached = getCachedThreadActivity(t.id);
        if (cached) {
          nextActivities[t.id] = cached;
        }
      });

      if (recentMeta && Array.isArray(recentMeta)) {
        for (const row of recentMeta as {
          id: string;
          thread_id: string;
          sender_id: string;
          created_at: string;
          read_at: string | null;
        }[]) {
          if (!nextActivities[row.thread_id]) {
            const summary: ThreadActivitySummary = {
              lastMessageAt: row.created_at,
              lastSenderId: row.sender_id,
              lastReadAt: row.read_at,
            };
            nextActivities[row.thread_id] = summary;
            setCachedThreadActivity(row.thread_id, summary);
          }
        }
      }
      setThreadActivities(nextActivities);

      // Prefetch latest messages for unlocked (non-PIN or already unlocked) threads into volatile RAM
      const unlockedList = threadList.filter((t) => !t.pin_hash || unlockedThreadIds.has(t.id));
      for (const t of unlockedList.slice(0, 3)) {
        const { data: msgRows } = await supabase
          .from('messages')
          .select('*')
          .eq('thread_id', t.id)
          .gt('expires_at', nowIso)
          .order('created_at', { ascending: false })
          .limit(30);

        if (isMounted && !isMounted()) return;
        if (msgRows && msgRows.length > 0) {
          const ordered = (msgRows as Message[]).slice().reverse();
          const decrypted = await Promise.all(
            ordered.map(async (m) => {
              const cached = getCachedPlaintext(m.id);
              const plain = cached !== undefined ? cached : await decryptMessage(m.content);
              setCachedPlaintext(m.id, plain);
              return { ...m, content: plain };
            })
          );
          if (!isMounted || isMounted()) {
            setCachedThreadMessages(t.id, decrypted);
          }
        }
      }
    },
    [isDuressMode, unlockedThreadIds]
  );

  const fetchThreads = useCallback(async () => {
    if (isDuressMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      Alert.alert('Database Error', error.message);
    } else if (data) {
      const list = data as Thread[];
      setThreads(list);
      loadThreadSummariesAndPrefetch(list);
    }
    setLoading(false);
  }, [isDuressMode, loadThreadSummariesAndPrefetch]);

  // Fetch threads and subscribe to Realtime (skipped in Duress decoy mode)
  useEffect(() => {
    if (isDuressMode) {
      return;
    }

    let mounted = true;
    const isMounted = () => mounted;

    (async () => {
      const { data, error } = await supabase
        .from('threads')
        .select('*')
        .order('created_at', { ascending: false });

      if (!mounted) return;
      if (error) {
        Alert.alert('Database Error', error.message);
      } else if (data) {
        if (data.length === 0 && currentUser) {
          const direct = await ensureDirectThread(currentUser);
          if (mounted && direct) {
            setThreads([direct]);
            loadThreadSummariesAndPrefetch([direct], isMounted);
          }
        } else {
          const list = data as Thread[];
          setThreads(list);
          loadThreadSummariesAndPrefetch(list, isMounted);
        }
      }
      setLoading(false);
    })();

    // Subscribe to Realtime changes on 'threads' table
    const channel = supabase
      .channel('realtime:threads')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'threads' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setThreads((prev) => [payload.new as Thread, ...prev.filter((t) => t.id !== payload.new.id)]);
          } else if (payload.eventType === 'UPDATE') {
            setThreads((prev) =>
              prev.map((t) => (t.id === payload.new.id ? (payload.new as Thread) : t))
            );
          } else if (payload.eventType === 'DELETE') {
            setThreads((prev) => prev.filter((t) => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [isDuressMode, currentUser, loadThreadSummariesAndPrefetch]);

  const handleCreateThread = async () => {
    if (!newChatTitle.trim()) return;
    if (isDuressMode) {
      setNewChatTitle('');
      setNewChatModalVisible(false);
      return;
    }

    const { data, error } = await supabase
      .from('threads')
      .insert({
        title: newChatTitle.trim(),
        is_hidden: false,
        burn_on_read: true,
        disappear_seconds: 60,
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Database Error', error.message);
      return;
    }

    if (data) {
      setNewChatTitle('');
      setNewChatModalVisible(false);
      onSelectThread(data as Thread);
    }
  };

  const handleThreadPress = (thread: Thread) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch { }

    // Check if thread requires PIN and isn't already unlocked in RAM
    if (thread.pin_hash && !unlockedThreadIds.has(thread.id)) {
      setPinTargetThread(thread);
      setPinMode('verify');
      setPinError(undefined);
      setPinModalVisible(true);
    } else {
      onSelectThread(thread);
    }
  };

  const handlePinSuccess = async (enteredPin: string) => {
    if (!pinTargetThread) return;

    if (pinMode === 'verify') {
      const hashed = await hashPin(enteredPin);
      if (hashed === pinTargetThread.pin_hash) {
        onUnlockThreadId(pinTargetThread.id);
        setPinModalVisible(false);
        onSelectThread(pinTargetThread);
      } else {
        setPinError('Incorrect PIN');
        onRecordFailedAttempt();
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch { }
      }
    } else if (pinMode === 'set') {
      const hashed = await hashPin(enteredPin);
      await supabase
        .from('threads')
        .update({ pin_hash: hashed })
        .eq('id', pinTargetThread.id);

      setThreads((prev) =>
        prev.map((t) => (t.id === pinTargetThread.id ? { ...t, pin_hash: hashed } : t))
      );
      onUnlockThreadId(pinTargetThread.id);
      setPinModalVisible(false);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch { }
    }
  };

  const handleLongPressThread = (thread: Thread) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch { }
    setSelectedThread(thread);
    setActionSheetVisible(true);
  };

  // Actions
  const toggleHideThread = async () => {
    if (!selectedThread) return;
    const nextHidden = !selectedThread.is_hidden;
    setActionSheetVisible(false);

    await supabase
      .from('threads')
      .update({ is_hidden: nextHidden })
      .eq('id', selectedThread.id);

    setThreads((prev) =>
      prev.map((t) => (t.id === selectedThread.id ? { ...t, is_hidden: nextHidden } : t))
    );
  };

  const promptSetPin = () => {
    if (!selectedThread) return;
    setActionSheetVisible(false);
    setPinTargetThread(selectedThread);
    setPinMode('set');
    setPinError(undefined);
    setPinModalVisible(true);
  };

  const removePin = async () => {
    if (!selectedThread) return;
    setActionSheetVisible(false);
    await supabase
      .from('threads')
      .update({ pin_hash: null })
      .eq('id', selectedThread.id);

    setThreads((prev) =>
      prev.map((t) => (t.id === selectedThread.id ? { ...t, pin_hash: null } : t))
    );
  };

  const cycleTimer = async () => {
    if (!selectedThread) return;
    setActionSheetVisible(false);
    const timers = [10, 60, 3600, 86400];
    const currentIndex = timers.indexOf(selectedThread.disappear_seconds || 60);
    const nextTimer = timers[(currentIndex + 1) % timers.length];

    await supabase
      .from('threads')
      .update({ disappear_seconds: nextTimer })
      .eq('id', selectedThread.id);

    setThreads((prev) =>
      prev.map((t) => (t.id === selectedThread.id ? { ...t, disappear_seconds: nextTimer } : t))
    );
  };

  const toggleBurnOnRead = async () => {
    if (!selectedThread) return;
    setActionSheetVisible(false);
    const nextVal = !selectedThread.burn_on_read;

    await supabase
      .from('threads')
      .update({ burn_on_read: nextVal })
      .eq('id', selectedThread.id);

    setThreads((prev) =>
      prev.map((t) => (t.id === selectedThread.id ? { ...t, burn_on_read: nextVal } : t))
    );
  };

  const deleteThread = async () => {
    if (!selectedThread) return;
    setActionSheetVisible(false);

    Alert.alert('Delete Chat', `Are you sure you want to delete "${selectedThread.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('threads').delete().eq('id', selectedThread.id);
          setThreads((prev) => prev.filter((t) => t.id !== selectedThread.id));
        },
      },
    ]);
  };

  const handlePanicWipe = () => {
    setMenuVisible(false);
    Alert.alert(
      'Panic Wipe All Data',
      'This will permanently delete ALL messages and chats from Supabase. This action cannot be reversed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'WIPE EVERYTHING',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
              await supabase.from('threads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
              setThreads([]);
              onLock();
            } catch (e) {
              console.error(e);
            }
          },
        },
      ]
    );
  };

  // Hidden chats logic: revealed strictly when searchQuery matches configured hiddenSearchCode
  const isRevealingHidden = searchQuery.trim() === stealthConfig.hiddenSearchCode;
  const displayedThreads = threads.filter((t) => {
    if (isRevealingHidden) {
      return t.is_hidden === true;
    }
    if (t.is_hidden) return false;
    if (!searchQuery.trim()) return true;
    const displayTitle = getThreadDisplayTitle(t, currentUser);
    return displayTitle.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getTimerLabel = (seconds: number) => {
    if (seconds === 10) return '10s';
    if (seconds === 60) return '1m';
    if (seconds === 3600) return '1h';
    if (seconds === 86400) return '24h';
    return `${seconds}s`;
  };

  const totalUnread = Object.values(unreadCounts).reduce((sum, c) => sum + c, 0);

  const handleQuickToggleColorMode = async () => {
    if (!onUpdateStealthConfig || isDuressMode) return;
    const nextMode = theme.mode === 'light' ? 'dark' : 'light';
    const updated = await saveStealthConfig({ ...stealthConfig, themeMode: nextMode });
    onUpdateStealthConfig(updated);
  };

  const handleQuickSwitchPreset = async () => {
    setMenuVisible(false);
    if (!onUpdateStealthConfig || isDuressMode) return;
    const nextPreset = theme.preset === 'ice' ? 'whatsapp' : 'ice';
    const updated = await saveStealthConfig({ ...stealthConfig, themePreset: nextPreset });
    onUpdateStealthConfig(updated);
  };

  return (
    <View style={styles.container}>
      {/* Gradient Header with Embedded Pill Search Bar */}
      <LinearGradient
        colors={[theme.gradientMid, theme.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {theme.preset === 'ice' ? 'Messages' : 'Chats'}
            </Text>
            <View style={styles.headerRightRow}>
              {!isDuressMode && onUpdateStealthConfig ? (
                <TouchableOpacity style={styles.headerIconBtn} onPress={handleQuickToggleColorMode}>
                  <Ionicons
                    name={theme.isDark ? 'sunny-outline' : 'moon-outline'}
                    size={21}
                    color={theme.headerText}
                  />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.headerIconBtn} onPress={onLock}>
                <Ionicons name="lock-closed-outline" size={21} color={theme.headerText} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => setMenuVisible((prev) => !prev)}
              >
                <Ionicons name="ellipsis-vertical" size={21} color={theme.headerText} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Pill inside Gradient Header */}
          <View style={styles.searchContainer}>
            <View style={styles.searchPill}>
              <Ionicons
                name="search-outline"
                size={18}
                color={theme.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder={theme.preset === 'whatsapp' ? 'Search...' : 'Search'}
                placeholderTextColor={theme.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Overflow Menu */}
      {menuVisible ? (
        <View style={styles.menuDropdown}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              setNewChatModalVisible(true);
            }}
          >
            <Ionicons name="chatbubble-outline" size={18} color={theme.textPrimary} />
            <Text style={styles.menuItemText}>New chat</Text>
          </TouchableOpacity>
          {!isDuressMode && onUpdateStealthConfig ? (
            <>
              <TouchableOpacity style={styles.menuItem} onPress={handleQuickSwitchPreset}>
                <Ionicons name="color-palette-outline" size={18} color={theme.textPrimary} />
                <Text style={styles.menuItemText}>
                  {theme.preset === 'ice' ? 'WhatsApp Theme' : 'Blue-Violet Ice Theme'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  setSettingsModalVisible(true);
                }}
              >
                <Ionicons name="shield-outline" size={18} color={theme.textPrimary} />
                <Text style={styles.menuItemText}>Stealth & Appearance</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              onSignOut();
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={theme.textPrimary} />
            <Text style={styles.menuItemText}>Sign out</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={handlePanicWipe}>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
            <Text style={[styles.menuItemText, { color: theme.danger }]}>
              Panic Wipe All Data
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Section Header if in Hidden Chats Mode */}
      {isRevealingHidden ? (
        <View style={styles.hiddenHeaderBanner}>
          <Ionicons name="eye-off-outline" size={18} color={theme.accentGreen} />
          <Text style={styles.hiddenBannerText}>
            Hidden Chats Revealed ({stealthConfig.hiddenSearchCode})
          </Text>
        </View>
      ) : null}

      {/* Threads List */}
      {loading && threads.length === 0 ? (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3].map((idx) => (
            <View key={idx} style={styles.skeletonRow}>
              <View style={styles.skeletonAvatar} />
              <View style={styles.skeletonMiddle}>
                <View style={styles.skeletonLinePrimary} />
                <View style={styles.skeletonLineSecondary} />
              </View>
              <View style={styles.skeletonTime} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={displayedThreads}
          keyExtractor={(item) => item.id}
          refreshing={loading}
          onRefresh={fetchThreads}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const safeTitle = getThreadDisplayTitle(item, currentUser);
            const initials = safeTitle
              .split(' ')
              .filter(Boolean)
              .map((w) => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 2) || 'C';

            const unreadCount = unreadCounts[item.id] || 0;
            const activity = threadActivities[item.id] || getCachedThreadActivity(item.id);
            const activityIso = activity?.lastMessageAt || item.created_at;
            const safeTime = (() => {
              if (!activityIso) return '';
              const d = new Date(activityIso);
              const now = new Date();
              const isSameDay =
                d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate();
              if (isSameDay) {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              }
              const yesterday = new Date(now);
              yesterday.setDate(now.getDate() - 1);
              if (
                d.getFullYear() === yesterday.getFullYear() &&
                d.getMonth() === yesterday.getMonth() &&
                d.getDate() === yesterday.getDate()
              ) {
                return 'Yesterday';
              }
              return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            })();

            const isLastSentByMe = Boolean(activity && currentUser && activity.lastSenderId === currentUser.id);

            return (
              <TouchableOpacity
                style={styles.threadRow}
                activeOpacity={0.7}
                onPress={() => handleThreadPress(item)}
                onLongPress={() => handleLongPressThread(item)}
              >
                {/* Avatar */}
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials || 'C'}</Text>
                  <View style={styles.onlineIndicatorDot} />
                </View>

                {/* Thread Info */}
                <View style={styles.threadMiddle}>
                  <View style={styles.titleRow}>
                    <Text style={styles.threadTitle} numberOfLines={1}>
                      {safeTitle}
                    </Text>
                    {item.pin_hash ? (
                      <Ionicons
                        name="lock-closed-outline"
                        size={14}
                        color={theme.textSecondary}
                        style={{ marginLeft: 6 }}
                      />
                    ) : null}
                    {item.is_hidden ? (
                      <Ionicons
                        name="eye-off-outline"
                        size={14}
                        color={theme.accentGreen}
                        style={{ marginLeft: 6 }}
                      />
                    ) : null}
                  </View>
                  <View style={styles.lastMessageRow}>
                    {unreadCount > 0 ? (
                      <Text
                        style={[styles.lastMessageText, { color: theme.accentGreen, fontWeight: '600' }]}
                        numberOfLines={1}
                      >
                        New encrypted message
                      </Text>
                    ) : activity ? (
                      <>
                        {isLastSentByMe ? (
                          <Ionicons
                            name="checkmark-done"
                            size={15}
                            color={activity.lastReadAt ? theme.tickRead : theme.textSecondary}
                            style={{ marginRight: 4 }}
                          />
                        ) : null}
                        <Text style={styles.lastMessageText} numberOfLines={1}>
                          {isLastSentByMe ? 'Sent' : 'Received'} •{' '}
                          {item.burn_on_read ? '🔥 Burn 8s' : `${getTimerLabel(item.disappear_seconds || 60)} timer`}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.lastMessageText} numberOfLines={1}>
                        {item.burn_on_read ? '🔥 Burn after reading' : `${getTimerLabel(item.disappear_seconds || 60)} disappearing chat`}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Time & Unread Badge */}
                <View style={styles.threadRight}>
                  <Text
                    style={[
                      styles.timeText,
                      unreadCount > 0 && { color: theme.accentGreen, fontWeight: '600' },
                    ]}
                  >
                    {safeTime}
                  </Text>
                  {unreadCount > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={56} color={theme.textSecondary} />
              <Text style={styles.emptyText}>
                {isRevealingHidden
                  ? 'No hidden chats found'
                  : 'No conversations yet.\nStart a new encrypted chat.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Navigation Dock (Ice theme) or Floating Action Button (WhatsApp theme) */}
      {theme.preset === 'ice' ? (
        <SafeAreaView edges={['bottom']} style={styles.bottomDockSafe}>
          <View style={styles.bottomDock}>
            <TouchableOpacity style={styles.dockItem} activeOpacity={0.7} onPress={fetchThreads}>
              <View>
                <Ionicons name="chatbubble-ellipses-outline" size={23} color={theme.accentGreen} />
                {totalUnread > 0 ? <View style={styles.dockAlertDot} /> : null}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dockItem}
              activeOpacity={0.7}
              onPress={() => setNewChatModalVisible(true)}
            >
              <Ionicons name="add-circle-outline" size={25} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.dockItem} activeOpacity={0.7} onPress={onLock}>
              <Ionicons name="lock-closed-outline" size={22} color={theme.textSecondary} />
            </TouchableOpacity>

            {!isDuressMode && onUpdateStealthConfig ? (
              <TouchableOpacity
                style={styles.dockItem}
                activeOpacity={0.7}
                onPress={() => setSettingsModalVisible(true)}
              >
                <Ionicons name="settings-outline" size={23} color={theme.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </SafeAreaView>
      ) : (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.85}
          onPress={() => setNewChatModalVisible(true)}
        >
          <Ionicons name="chatbubble-ellipses" size={24} color={theme.textOnAccent} />
        </TouchableOpacity>
      )}

      {/* New Chat Modal */}
      <Modal
        visible={newChatModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewChatModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Conversation</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Chat name or recipient"
              placeholderTextColor={theme.textSecondary}
              value={newChatTitle}
              onChangeText={setNewChatTitle}
              onSubmitEditing={handleCreateThread}
              returnKeyType="done"
              autoFocus
            />
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setNewChatTitle('');
                  setNewChatModalVisible(false);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreateBtn}
                onPress={handleCreateThread}
              >
                <Text style={styles.modalCreateText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Long Press Action Modal */}
      <Modal
        visible={actionSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActionSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.actionSheetOverlay}
          activeOpacity={1}
          onPress={() => setActionSheetVisible(false)}
        >
          <View style={styles.actionSheetContent}>
            <Text style={styles.actionSheetTitle}>
              {selectedThread ? getThreadDisplayTitle(selectedThread, currentUser) : ''}
            </Text>

            <TouchableOpacity style={styles.actionItem} onPress={toggleHideThread}>
              <Ionicons
                name={selectedThread?.is_hidden ? 'eye-outline' : 'eye-off-outline'}
                size={22}
                color={theme.textPrimary}
              />
              <Text style={styles.actionItemText}>
                {selectedThread?.is_hidden
                  ? 'Unhide Chat'
                  : `Hide Chat (Reveal with ${stealthConfig.hiddenSearchCode})`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={promptSetPin}>
              <Ionicons name="key-outline" size={22} color={theme.textPrimary} />
              <Text style={styles.actionItemText}>
                {selectedThread?.pin_hash ? 'Change 4-Digit PIN' : 'Set 4-Digit PIN'}
              </Text>
            </TouchableOpacity>

            {selectedThread?.pin_hash ? (
              <TouchableOpacity style={styles.actionItem} onPress={removePin}>
                <Ionicons name="lock-open-outline" size={22} color={theme.textPrimary} />
                <Text style={styles.actionItemText}>Remove PIN Lock</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.actionItem} onPress={cycleTimer}>
              <Ionicons name="timer-outline" size={22} color={theme.textPrimary} />
              <Text style={styles.actionItemText}>
                Timer: {getTimerLabel(selectedThread?.disappear_seconds || 60)} (Tap to cycle)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={toggleBurnOnRead}>
              <Ionicons name="flame-outline" size={22} color={theme.textPrimary} />
              <Text style={styles.actionItemText}>
                Burn on Read: {selectedThread?.burn_on_read ? 'Enabled' : 'Disabled'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={deleteThread}>
              <Ionicons name="trash-outline" size={22} color={theme.danger} />
              <Text style={[styles.actionItemText, { color: theme.danger }]}>
                Delete Chat
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PIN Verification / Set Modal */}
      <PinModal
        visible={pinModalVisible}
        title={pinMode === 'set' ? 'Set Chat PIN' : 'Locked Chat'}
        subtitle={
          pinMode === 'set'
            ? 'Enter a 4-digit PIN for this conversation'
            : 'Enter the 4-digit PIN to decrypt and access this conversation'
        }
        errorMessage={pinError}
        onSuccess={handlePinSuccess}
        onCancel={() => {
          setPinModalVisible(false);
          setPinTargetThread(null);
        }}
      />

      {/* Stealth & Security Settings Modal */}
      {onUpdateStealthConfig && settingsModalVisible ? (
        <StealthSettingsModal
          visible={settingsModalVisible}
          config={stealthConfig}
          onSave={onUpdateStealthConfig}
          onClose={() => setSettingsModalVisible(false)}
        />
      ) : null}
    </View>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bgCard,
    },
    headerGradient: {
      paddingBottom: 16,
      borderBottomLeftRadius: theme.headerBorderRadius,
      borderBottomRightRadius: theme.headerBorderRadius,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
    },
    headerTitle: {
      color: theme.headerText,
      fontSize: theme.preset === 'ice' ? 28 : 24,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    headerRightRow: {
      flexDirection: 'row',
      gap: 10,
    },
    headerIconBtn: {
      padding: 6,
    },
    menuDropdown: {
      position: 'absolute',
      top: 86,
      right: 20,
      backgroundColor: theme.bgCard,
      borderRadius: 14,
      paddingVertical: 8,
      width: 224,
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.35 : 0.14,
      shadowRadius: 16,
      elevation: 8,
      zIndex: 99,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    menuItemText: {
      color: theme.textPrimary,
      fontSize: 15,
    },
    menuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.divider,
      marginVertical: 4,
    },
    searchContainer: {
      paddingHorizontal: 18,
    },
    searchPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.searchHeaderBg,
      borderRadius: 22,
      paddingHorizontal: 14,
      height: 44,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      color: theme.textPrimary,
      fontSize: 15,
    },
    hiddenHeaderBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surfaceHighlight,
      paddingHorizontal: 20,
      paddingVertical: 8,
      gap: 8,
    },
    hiddenBannerText: {
      color: theme.accentGreen,
      fontWeight: '600',
      fontSize: 13,
    },
    listContent: {
      paddingVertical: 8,
    },
    threadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: theme.surfaceHighlight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
    },
    avatarText: {
      color: theme.accentGreen,
      fontSize: 18,
      fontWeight: '700',
    },
    onlineIndicatorDot: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.onlineGreen,
      borderWidth: 2,
      borderColor: theme.bgCard,
    },
    threadMiddle: {
      flex: 1,
      justifyContent: 'center',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    threadTitle: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    lastMessageRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    lastMessageText: {
      color: theme.textSecondary,
      fontSize: 13.5,
      flex: 1,
    },
    threadRight: {
      alignItems: 'flex-end',
      marginLeft: 10,
    },
    timeText: {
      color: theme.textSecondary,
      fontSize: 12,
    },
    unreadBadge: {
      marginTop: 6,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: theme.badgeBg,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 6,
    },
    unreadBadgeText: {
      color: theme.badgeText,
      fontSize: 11,
      fontWeight: '700',
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
      gap: 12,
    },
    emptyText: {
      color: theme.textSecondary,
      textAlign: 'center',
      fontSize: 15,
      lineHeight: 22,
    },
    bottomDockSafe: {
      backgroundColor: theme.bgCard,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    bottomDock: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingVertical: 10,
    },
    dockItem: {
      paddingHorizontal: 20,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dockAlertDot: {
      position: 'absolute',
      top: -1,
      right: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.badgeBg,
    },
    fab: {
      position: 'absolute',
      bottom: 24,
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: theme.accentGreen,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: theme.bgCard,
      borderRadius: 20,
      padding: 22,
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.35 : 0.16,
      shadowRadius: 20,
      elevation: 10,
    },
    modalTitle: {
      color: theme.textPrimary,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 16,
    },
    modalInput: {
      backgroundColor: theme.bgInputPill,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      paddingHorizontal: 14,
      height: 48,
      color: theme.textPrimary,
      fontSize: 15,
      marginBottom: 20,
    },
    modalActionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 14,
    },
    modalCancelBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    modalCancelText: {
      color: theme.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },
    modalCreateBtn: {
      backgroundColor: theme.accentGreen,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 18,
    },
    modalCreateText: {
      color: theme.textOnAccent,
      fontSize: 15,
      fontWeight: '700',
    },
    actionSheetOverlay: {
      flex: 1,
      backgroundColor: theme.modalOverlay,
      justifyContent: 'flex-end',
    },
    actionSheetContent: {
      backgroundColor: theme.bgCard,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 18,
      paddingBottom: 36,
      paddingHorizontal: 20,
      gap: 6,
    },
    actionSheetTitle: {
      color: theme.textPrimary,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
      paddingBottom: 10,
    },
    actionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
    },
    actionItemText: {
      color: theme.textPrimary,
      fontSize: 16,
    },
    skeletonList: {
      flex: 1,
      paddingTop: 8,
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
    },
    skeletonAvatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: theme.surfaceHighlight,
      marginRight: 14,
    },
    skeletonMiddle: {
      flex: 1,
      gap: 8,
    },
    skeletonLinePrimary: {
      width: '48%',
      height: 14,
      borderRadius: 7,
      backgroundColor: theme.surfaceHighlight,
    },
    skeletonLineSecondary: {
      width: '72%',
      height: 11,
      borderRadius: 6,
      backgroundColor: theme.bgInputPill,
    },
    skeletonTime: {
      width: 42,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.surfaceHighlight,
      marginLeft: 10,
    },
  });

