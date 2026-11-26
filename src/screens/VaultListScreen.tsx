import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';
import { hashPin } from '../lib/cryptoCodec';
import { Thread } from '../types/database';
import { whatsappTheme } from '../theme/whatsappTheme';
import { PinModal } from '../components/PinModal';
import { StealthSettingsModal } from '../components/StealthSettingsModal';
import { DEFAULT_STEALTH_CONFIG, StealthConfig } from '../lib/stealthConfig';

interface VaultListScreenProps {
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
  const [threads, setThreads] = useState<Thread[]>([]);
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
      setThreads(data as Thread[]);
    }
    setLoading(false);
  }, [isDuressMode]);

  // Fetch threads and subscribe to Realtime (skipped in Duress decoy mode)
  useEffect(() => {
    if (isDuressMode) {
      return;
    }

    let mounted = true;

    (async () => {
      const { data, error } = await supabase
        .from('threads')
        .select('*')
        .order('created_at', { ascending: false });

      if (!mounted) return;
      if (error) {
        Alert.alert('Database Error', error.message);
      } else if (data) {
        setThreads(data as Thread[]);
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
  }, [isDuressMode]);

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
    return t.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getTimerLabel = (seconds: number) => {
    if (seconds === 10) return '10s';
    if (seconds === 60) return '1m';
    if (seconds === 3600) return '1h';
    if (seconds === 86400) return '24h';
    return `${seconds}s`;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <View style={styles.headerRightRow}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={onLock}>
            <Ionicons name="lock-closed-outline" size={22} color={whatsappTheme.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setMenuVisible((prev) => !prev)}
          >
            <Ionicons name="ellipsis-vertical" size={22} color={whatsappTheme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

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
            <Ionicons name="chatbubble-outline" size={18} color={whatsappTheme.textPrimary} />
            <Text style={styles.menuItemText}>New chat</Text>
          </TouchableOpacity>
          {!isDuressMode && onUpdateStealthConfig ? (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setSettingsModalVisible(true);
              }}
            >
              <Ionicons name="shield-outline" size={18} color={whatsappTheme.textPrimary} />
              <Text style={styles.menuItemText}>Stealth settings</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              onSignOut();
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={whatsappTheme.textPrimary} />
            <Text style={styles.menuItemText}>Sign out</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={handlePanicWipe}>
            <Ionicons name="trash-outline" size={18} color={whatsappTheme.danger} />
            <Text style={[styles.menuItemText, { color: whatsappTheme.danger }]}>
              Panic Wipe All Data
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* WhatsApp Pill Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchPill}>
          <Ionicons
            name="search-outline"
            size={18}
            color={whatsappTheme.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Ask Meta AI or Search"
            placeholderTextColor={whatsappTheme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={whatsappTheme.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Section Header if in Hidden Chats Mode */}
      {isRevealingHidden ? (
        <View style={styles.hiddenHeaderBanner}>
          <Ionicons name="eye-off" size={18} color={whatsappTheme.accentGreen} />
          <Text style={styles.hiddenBannerText}>
            Hidden Chats Revealed ({stealthConfig.hiddenSearchCode})
          </Text>
        </View>
      ) : null}

      {/* Threads List */}
      <FlatList
        data={displayedThreads}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={fetchThreads}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const safeTitle = (item && typeof item.title === 'string' && item.title.trim()) ? item.title : 'Chat';
          const initials = safeTitle
            .split(' ')
            .filter(Boolean)
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'C';

          const safeTime = item.created_at
            ? new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            : '';

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
                {/* Timer badge */}
                <View style={styles.timerBadge}>
                  <Text style={styles.timerBadgeText}>
                    {getTimerLabel(item.disappear_seconds || 60)}
                  </Text>
                </View>
              </View>

              {/* Thread Info */}
              <View style={styles.threadMiddle}>
                <View style={styles.titleRow}>
                  <Text style={styles.threadTitle} numberOfLines={1}>
                    {safeTitle}
                  </Text>
                  {item.pin_hash ? (
                    <Ionicons
                      name="lock-closed"
                      size={14}
                      color={whatsappTheme.textSecondary}
                      style={{ marginLeft: 6 }}
                    />
                  ) : null}
                  {item.is_hidden ? (
                    <Ionicons
                      name="eye-off"
                      size={14}
                      color={whatsappTheme.accentGreen}
                      style={{ marginLeft: 6 }}
                    />
                  ) : null}
                </View>
                <View style={styles.lastMessageRow}>
                  <Ionicons
                    name="checkmark-done"
                    size={16}
                    color={whatsappTheme.tickBlue}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.lastMessageText} numberOfLines={1}>
                    {item.burn_on_read ? '🔥 Burn after reading' : 'Disappearing chat'}
                  </Text>
                </View>
              </View>

              {/* Time */}
              <View style={styles.threadRight}>
                <Text style={styles.timeText}>{safeTime}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={56} color={whatsappTheme.textSecondary} />
            <Text style={styles.emptyText}>
              {isRevealingHidden
                ? 'No hidden chats found'
                : 'No conversations yet.\nTap the green button to start a chat.'}
            </Text>
          </View>
        }
      />

      {/* Floating Action Button (New Chat) */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => setNewChatModalVisible(true)}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#0B141A" />
      </TouchableOpacity>

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
              placeholderTextColor={whatsappTheme.textSecondary}
              value={newChatTitle}
              onChangeText={setNewChatTitle}
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
            <Text style={styles.actionSheetTitle}>{selectedThread?.title}</Text>

            <TouchableOpacity style={styles.actionItem} onPress={toggleHideThread}>
              <Ionicons
                name={selectedThread?.is_hidden ? 'eye-outline' : 'eye-off-outline'}
                size={22}
                color={whatsappTheme.textPrimary}
              />
              <Text style={styles.actionItemText}>
                {selectedThread?.is_hidden
                  ? 'Unhide Chat'
                  : `Hide Chat (Reveal with ${stealthConfig.hiddenSearchCode})`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={promptSetPin}>
              <Ionicons name="key-outline" size={22} color={whatsappTheme.textPrimary} />
              <Text style={styles.actionItemText}>
                {selectedThread?.pin_hash ? 'Change 4-Digit PIN' : 'Set 4-Digit PIN'}
              </Text>
            </TouchableOpacity>

            {selectedThread?.pin_hash ? (
              <TouchableOpacity style={styles.actionItem} onPress={removePin}>
                <Ionicons name="lock-open-outline" size={22} color={whatsappTheme.textPrimary} />
                <Text style={styles.actionItemText}>Remove PIN Lock</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.actionItem} onPress={cycleTimer}>
              <Ionicons name="timer-outline" size={22} color={whatsappTheme.textPrimary} />
              <Text style={styles.actionItemText}>
                Timer: {getTimerLabel(selectedThread?.disappear_seconds || 60)} (Tap to cycle)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={toggleBurnOnRead}>
              <Ionicons name="flame-outline" size={22} color={whatsappTheme.textPrimary} />
              <Text style={styles.actionItemText}>
                Burn on Read: {selectedThread?.burn_on_read ? 'Enabled' : 'Disabled'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={deleteThread}>
              <Ionicons name="trash-outline" size={22} color={whatsappTheme.danger} />
              <Text style={[styles.actionItemText, { color: whatsappTheme.danger }]}>
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: whatsappTheme.bgPrimary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: whatsappTheme.bgPrimary,
  },
  headerTitle: {
    color: whatsappTheme.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  headerRightRow: {
    flexDirection: 'row',
    gap: 16,
  },
  headerIconBtn: {
    padding: 4,
  },
  menuDropdown: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: whatsappTheme.bgHeader,
    borderRadius: 12,
    paddingVertical: 8,
    width: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
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
    color: whatsappTheme.textPrimary,
    fontSize: 15,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: whatsappTheme.divider,
    marginVertical: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: whatsappTheme.bgSearchFocus,
    borderRadius: 24,
    paddingHorizontal: 14,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: whatsappTheme.textPrimary,
    fontSize: 15,
  },
  hiddenHeaderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 168, 132, 0.15)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  hiddenBannerText: {
    color: whatsappTheme.accentGreen,
    fontWeight: '600',
    fontSize: 13,
  },
  listContent: {
    paddingVertical: 4,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: whatsappTheme.bgHeader,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: whatsappTheme.accentGreen,
    fontSize: 18,
    fontWeight: '700',
  },
  timerBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: whatsappTheme.accentGreen,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  timerBadgeText: {
    color: '#0B141A',
    fontSize: 9,
    fontWeight: '700',
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
    color: whatsappTheme.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  lastMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastMessageText: {
    color: whatsappTheme.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  threadRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  timeText: {
    color: whatsappTheme.textSecondary,
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  emptyText: {
    color: whatsappTheme.textSecondary,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: whatsappTheme.accentGreen,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: whatsappTheme.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: whatsappTheme.bgHeader,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    color: whatsappTheme.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: whatsappTheme.bgInputPill,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
    color: whatsappTheme.textPrimary,
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
    color: whatsappTheme.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  modalCreateBtn: {
    backgroundColor: whatsappTheme.accentGreen,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  modalCreateText: {
    color: '#0B141A',
    fontSize: 15,
    fontWeight: '700',
  },
  actionSheetOverlay: {
    flex: 1,
    backgroundColor: whatsappTheme.modalOverlay,
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    backgroundColor: whatsappTheme.bgHeader,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 36,
    paddingHorizontal: 20,
    gap: 6,
  },
  actionSheetTitle: {
    color: whatsappTheme.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whatsappTheme.divider,
    paddingBottom: 10,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  actionItemText: {
    color: whatsappTheme.textPrimary,
    fontSize: 16,
  },
});

