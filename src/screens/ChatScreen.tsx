import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { setActiveChatForPush } from '../lib/notifications';
import { decryptMessage, encryptMessage } from '../lib/cryptoCodec';
import {
  decodeMessagePayload,
  encodeMessagePayload,
  ReplyPreview,
} from '../lib/messagePayload';
import {
  deleteCachedPlaintext,
  getCachedPlaintext,
  getCachedThreadMessages,
  setCachedPlaintext,
  setCachedThreadMessages,
} from '../lib/memoryCache';
import { Message, Thread, User } from '../types/database';
import { getThreadDisplayTitle } from '../lib/directChat';
import { AppTheme } from '../theme/whatsappTheme';
import { useAppTheme } from '../theme/ThemeContext';

const QUICK_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😘', '😊', '🤔', '😭',
  '🙏', '🔥', '❤️', '👍', '🎉', '👀', '💯', '✨',
];

const TIMER_OPTIONS = [
  { label: '10s', seconds: 10 },
  { label: '1m', seconds: 60 },
  { label: '1h', seconds: 3600 },
  { label: '24h', seconds: 86400 },
];

interface ChatScreenProps {
  thread: Thread;
  currentUserId: string;
  currentUser?: User | null;
  onUpdateThread?: (updated: Thread) => void;
  onSuspendAutoLock?: (suspend: boolean) => void;
  onBack: () => void;
  onLock: () => void;
}

interface DecryptedMessage extends Message {
  remainingSeconds?: number;
  isBurning?: boolean;
  isOptimistic?: boolean;
}

const SwipeableMessageBubble: React.FC<{
  message: DecryptedMessage;
  onSwipeReply: (msg: DecryptedMessage) => void;
  hintStyle: any;
  children: React.ReactNode;
}> = ({ message, onSwipeReply, hintStyle, children }) => {
  const theme = useAppTheme();
  const [translateX] = useState(() => new Animated.Value(0));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          gesture.dx > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dx <= 0) return;
          translateX.setValue(Math.min(68, gesture.dx));
        },
        onPanResponderRelease: (_evt, gesture) => {
          const shouldReply = gesture.dx >= 48;
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
          if (shouldReply) {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } catch {}
            onSwipeReply(message);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [message, onSwipeReply, translateX]
  );

  const iconOpacity = translateX.interpolate({
    inputRange: [0, 24, 52],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative' }} {...panResponder.panHandlers}>
      <Animated.View
        pointerEvents="none"
        style={[hintStyle, { opacity: iconOpacity }]}
      >
        <Ionicons name="arrow-undo" size={18} color={theme.accentGreen} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }}>{children}</Animated.View>
    </View>
  );
};

export const ChatScreen: React.FC<ChatScreenProps> = ({
  thread,
  currentUserId,
  currentUser,
  onUpdateThread,
  onSuspendAutoLock,
  onBack,
  onLock,
}) => {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [messages, setMessages] = useState<DecryptedMessage[]>(() =>
    getCachedThreadMessages(thread.id)
  );
  const [initialLoading, setInitialLoading] = useState<boolean>(
    () => getCachedThreadMessages(thread.id).length === 0
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<DecryptedMessage | null>(null);
  const [emojiVisible, setEmojiVisible] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [timerModalVisible, setTimerModalVisible] = useState(false);
  const [androidKbPad, setAndroidKbPad] = useState(0);

  const insets = useSafeAreaInsets();
  const baseHeightRef = useRef(0);
  const latestLayoutHeightRef = useRef(0);
  const activeKbHeightRef = useRef(0);
  const pageLimitRef = useRef(40);
  const messagesRef = useRef<DecryptedMessage[]>(messages);
  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const isCurrentlyTypingRef = useRef(false);
  const burningIdsRef = useRef<Set<string>>(new Set());
  const burnIntervalsRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    messagesRef.current = messages;
    setCachedThreadMessages(thread.id, messages);
  }, [thread.id, messages]);

  // Starts a synchronized burn countdown in memory for either sender (display) or receiver (delete)
  const startBurnCountdown = useCallback(
    (messageId: string, initialSeconds: number, deleteOnZero: boolean) => {
      if (burningIdsRef.current.has(messageId)) return;
      burningIdsRef.current.add(messageId);

      let remaining = Math.max(1, initialSeconds);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, isBurning: true, remainingSeconds: remaining } : m
        )
      );

      const interval = setInterval(async () => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(interval);
          burnIntervalsRef.current.delete(messageId);
          burningIdsRef.current.delete(messageId);
          if (deleteOnZero) {
            await supabase.from('messages').delete().eq('id', messageId);
          }
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, remainingSeconds: remaining } : m))
          );
        }
      }, 1000);

      burnIntervalsRef.current.set(messageId, interval);
    },
    []
  );

  // Starts burn timer ONLY when recipient actively views the chat in foreground ('active').
  // Unread messages remain safely queued (up to 7 days) regardless of whether Burn (8s) or 10s/1m/1h/24h is chosen.
  const handleIncomingBurn = useCallback(
    async (msg: Message) => {
      if (AppState.currentState !== 'active') return;
      if (burningIdsRef.current.has(msg.id)) return;

      if (msg.read_at) {
        const remaining = Math.max(
          1,
          Math.ceil((new Date(msg.expires_at).getTime() - Date.now()) / 1000)
        );
        startBurnCountdown(msg.id, remaining, true);
        return;
      }

      const burnSeconds = thread.burn_on_read ? 8 : thread.disappear_seconds || 60;
      const nowMs = Date.now();
      const readAt = new Date(nowMs).toISOString();
      const burnExpiresAt = new Date(nowMs + burnSeconds * 1000).toISOString();

      startBurnCountdown(msg.id, burnSeconds, true);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, read_at: readAt, expires_at: burnExpiresAt } : m
        )
      );

      await supabase
        .from('messages')
        .update({ read_at: readAt, expires_at: burnExpiresAt })
        .eq('id', msg.id);

      channelRef.current?.send({
        type: 'broadcast',
        event: 'read_msg',
        payload: { id: msg.id, read_at: readAt, expires_at: burnExpiresAt },
      });
    },
    [startBurnCountdown, thread.burn_on_read, thread.disappear_seconds]
  );

  // Clean up all burn timers and typing timers on unmount
  useEffect(() => {
    const intervals = burnIntervalsRef.current;
    return () => {
      intervals.forEach((id) => clearInterval(id));
      intervals.clear();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Suppress backend push alerts (ntfy & Expo Push) while this chat is actively open in foreground
  useEffect(() => {
    if (AppState.currentState === 'active') {
      setActiveChatForPush(currentUserId, thread.id);
    }

    const heartbeat = setInterval(() => {
      if (AppState.currentState === 'active') {
        setActiveChatForPush(currentUserId, thread.id);
      }
    }, 20000);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setActiveChatForPush(currentUserId, thread.id);
      } else {
        setActiveChatForPush(currentUserId, null);
      }
    });

    return () => {
      clearInterval(heartbeat);
      appStateSub.remove();
      setActiveChatForPush(currentUserId, null);
    };
  }, [currentUserId, thread.id]);

  // Self-calibrating keyboard listener (handles Android edge-to-edge & scrolls to bottom)
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      if (Platform.OS === 'android') {
        const kbH = e.endCoordinates?.height || 0;
        activeKbHeightRef.current = kbH;
        const osResizedBy = Math.max(0, baseHeightRef.current - latestLayoutHeightRef.current);
        setAndroidKbPad(Math.max(0, kbH - osResizedBy - insets.bottom));
      }
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      if (Platform.OS === 'android') {
        activeKbHeightRef.current = 0;
        setAndroidKbPad(0);
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom]);

  // Fast paginated sync + lightweight metadata delta fallback (keeps Supabase RAM minimal)
  const decryptCached = useCallback(async (m: Message): Promise<string> => {
    const cached = getCachedPlaintext(m.id);
    if (cached !== undefined) return cached;
    const plain = await decryptMessage(m.content);
    setCachedPlaintext(m.id, plain);
    return plain;
  }, []);

  const syncFromServer = useCallback(async (limitCount = pageLimitRef.current) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', thread.id)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(limitCount);

    if (error || !data) {
      setInitialLoading(false);
      return;
    }

    setHasOlderMessages(data.length >= limitCount);
    const validRows = (data as Message[]).slice().reverse();
    const serverIds = new Set(validRows.map((m) => m.id));

    const decryptedRows = await Promise.all(
      validRows.map(async (m) => {
        const content = await decryptCached(m);
        return { ...m, content } as DecryptedMessage;
      })
    );

    setMessages((prev) => {
      const prevMap = new Map(prev.map((m) => [m.id, m]));
      const next: DecryptedMessage[] = decryptedRows.map((row) => {
        const existing = prevMap.get(row.id);
        return existing
          ? {
              ...row,
              isBurning: existing.isBurning,
              remainingSeconds: existing.remainingSeconds,
            }
          : row;
      });
      // Keep mid-flight optimistic messages so UI never flickers while uploading
      prev.forEach((m) => {
        if (m.isOptimistic && !serverIds.has(m.id)) {
          next.push(m);
        } else if (!m.isOptimistic && !serverIds.has(m.id)) {
          const interval = burnIntervalsRef.current.get(m.id);
          if (interval) {
            clearInterval(interval);
            burnIntervalsRef.current.delete(m.id);
          }
          burningIdsRef.current.delete(m.id);
          deleteCachedPlaintext(m.id);
        }
      });
      return next;
    });

    setInitialLoading(false);

    decryptedRows.forEach((m) => {
      if (m.sender_id !== currentUserId) {
        handleIncomingBurn(m);
      } else if (m.read_at) {
        const remaining = Math.max(
          1,
          Math.ceil((new Date(m.expires_at).getTime() - Date.now()) / 1000)
        );
        startBurnCountdown(m.id, remaining, false);
      }
    });
  }, [thread.id, currentUserId, decryptCached, handleIncomingBurn, startBurnCountdown]);

  const handleLoadEarlier = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    pageLimitRef.current += 40;
    await syncFromServer(pageLimitRef.current);
    setLoadingOlder(false);
  };

  useEffect(() => {
    let mounted = true;

    const applyIncomingRow = async (rawMsg: Message) => {
      if (new Date(rawMsg.expires_at) <= new Date()) return;
      const plainContent = await decryptCached(rawMsg);
      const decryptedMsg: DecryptedMessage = {
        ...rawMsg,
        content: plainContent,
      };

      if (!mounted) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === decryptedMsg.id)) return prev;
        return [...prev, decryptedMsg].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

      if (rawMsg.sender_id !== currentUserId) {
        handleIncomingBurn(decryptedMsg);
      }
    };

    // Lightweight metadata delta sync: avoids re-transferring large image blobs every interval
    const lightweightDeltaSync = async () => {
      const nowIso = new Date().toISOString();
      const { data: metaRows, error } = await supabase
        .from('messages')
        .select('id, sender_id, read_at, expires_at')
        .eq('thread_id', thread.id)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(pageLimitRef.current);

      if (!mounted || error || !metaRows) return;

      const typedMeta = metaRows as { id: string; sender_id: string; read_at: string | null; expires_at: string }[];
      const metaMap = new Map(typedMeta.map((r) => [r.id, r]));
      const existingIds = new Set(messagesRef.current.map((m) => m.id));
      const missingIds = typedMeta.filter((r) => !existingIds.has(r.id)).map((r) => r.id);

      setMessages((prev) =>
        prev
          .filter((m) => m.isOptimistic || metaMap.has(m.id))
          .map((m) => {
            const meta = metaMap.get(m.id);
            return meta ? { ...m, read_at: meta.read_at, expires_at: meta.expires_at } : m;
          })
      );

      typedMeta.forEach((meta) => {
        if (meta.sender_id === currentUserId && meta.read_at) {
          const remaining = Math.max(
            1,
            Math.ceil((new Date(meta.expires_at).getTime() - Date.now()) / 1000)
          );
          startBurnCountdown(meta.id, remaining, false);
        }
      });

      if (missingIds.length > 0) {
        const { data: missingRows } = await supabase
          .from('messages')
          .select('*')
          .in('id', missingIds);

        if (mounted && missingRows) {
          for (const row of missingRows as Message[]) {
            await applyIncomingRow(row);
          }
        }
      }
    };

    syncFromServer();
    const syncTimer = setInterval(lightweightDeltaSync, 12000);

    // Realtime channel for WAL postgres_changes + instant WebSocket broadcast + ephemeral presence
    const channel = supabase
      .channel(`realtime:messages:${thread.id}`, {
        config: {
          presence: { key: currentUserId },
          broadcast: { self: false },
        },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<
          string,
          { online?: boolean; typing?: boolean }[]
        >;
        let otherOnline = false;
        let otherTyping = false;

        Object.entries(state).forEach(([key, presences]) => {
          if (key !== currentUserId && Array.isArray(presences) && presences.length > 0) {
            otherOnline = true;
            if (presences.some((p) => p.typing)) {
              otherTyping = true;
            }
          }
        });

        setPartnerOnline(otherOnline);
        setPartnerTyping(otherTyping);
      })
      .on('broadcast', { event: 'new_msg' }, async ({ payload }) => {
        if (payload && payload.thread_id === thread.id) {
          await applyIncomingRow(payload as Message);
        }
      })
      .on('broadcast', { event: 'del_msg' }, ({ payload }) => {
        if (payload?.id) {
          deleteCachedPlaintext(payload.id);
          setMessages((prev) => prev.filter((m) => m.id !== payload.id));
        }
      })
      .on('broadcast', { event: 'read_msg' }, ({ payload }) => {
        if (payload?.id && payload?.read_at) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.id
                ? {
                    ...m,
                    read_at: payload.read_at,
                    expires_at: payload.expires_at || m.expires_at,
                  }
                : m
            )
          );
          const remaining = payload.expires_at
            ? Math.max(1, Math.ceil((new Date(payload.expires_at).getTime() - Date.now()) / 1000))
            : Math.max(1, 8 - Math.floor((Date.now() - new Date(payload.read_at).getTime()) / 1000));
          startBurnCountdown(payload.id, remaining, false);
        }
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${thread.id}`,
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            await applyIncomingRow(payload.new as Message);
          } else if (payload.eventType === 'DELETE') {
            deleteCachedPlaintext(payload.old.id);
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            const cachedPlain = getCachedPlaintext(updated.id);
            const plainContent =
              cachedPlain !== undefined ? cachedPlain : await decryptCached(updated);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === updated.id ? { ...m, ...updated, content: plainContent } : m
              )
            );

            // Sync countdown on sender screen when recipient marks read_at
            if (updated.read_at && updated.sender_id === currentUserId) {
              const remaining = Math.max(
                1,
                Math.ceil((new Date(updated.expires_at).getTime() - Date.now()) / 1000)
              );
              startBurnCountdown(updated.id, remaining, false);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'threads',
          filter: `id=eq.${thread.id}`,
        },
        (payload) => {
          if (payload.new && onUpdateThread) {
            onUpdateThread(payload.new as Thread);
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online: true, typing: false });
        }
      });

    channelRef.current = channel;

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        messagesRef.current.forEach((m) => {
          if (m.sender_id !== currentUserId) {
            handleIncomingBurn(m);
          }
        });
      }
    });

    return () => {
      mounted = false;
      clearInterval(syncTimer);
      appStateSub.remove();
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [
    thread.id,
    currentUserId,
    decryptCached,
    handleIncomingBurn,
    startBurnCountdown,
    syncFromServer,
    onUpdateThread,
  ]);

  // 1-second interval to purge expired messages from memory and clean up expired rows
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMessages((prev) => prev.filter((m) => new Date(m.expires_at) > now));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleInputChange = (text: string) => {
    setInputText(text);
    const ch = channelRef.current;
    if (!ch) return;

    const isTyping = text.trim().length > 0;
    if (isTyping !== isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = isTyping;
      ch.track({ online: true, typing: isTyping }).catch(() => {});
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        if (isCurrentlyTypingRef.current) {
          isCurrentlyTypingRef.current = false;
          channelRef.current?.track({ online: true, typing: false }).catch(() => {});
        }
      }, 2500);
    }
  };

  const sendEncryptedPayload = async (rawPayload: string) => {
    setSending(true);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = false;
      channelRef.current?.track({ online: true, typing: false }).catch(() => {});
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    // Keep EVERY unread message queued up to 7 days until recipient actively reads it
    const ttlMs = 7 * 86400 * 1000;
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Optimistic UI: show bubble immediately on tap without waiting for network
    const optimisticMsg: DecryptedMessage = {
      id: tempId,
      thread_id: thread.id,
      sender_id: currentUserId,
      content: rawPayload,
      read_at: null,
      expires_at: expiresAt,
      created_at: nowIso,
      isOptimistic: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 50);

    const encryptedContent = await encryptMessage(rawPayload);

    const { data, error } = await supabase
      .from('messages')
      .insert({
        thread_id: thread.id,
        sender_id: currentUserId,
        content: encryptedContent,
        expires_at: expiresAt,
      })
      .select()
      .single();

    setSending(false);

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Send Error', error.message);
      return false;
    }

    if (data) {
      setCachedPlaintext(data.id, rawPayload);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'new_msg',
        payload: data,
      });

      const confirmedMsg: DecryptedMessage = {
        ...data,
        content: rawPayload,
        isOptimistic: false,
      };
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId && m.id !== confirmedMsg.id);
        return [...withoutTemp, confirmedMsg];
      });
    }
    return true;
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    const currentReply = replyTo;
    setInputText('');
    setReplyTo(null);
    setEmojiVisible(false);

    const payload = encodeMessagePayload({ text, replyTo: currentReply });
    const ok = await sendEncryptedPayload(payload);
    if (!ok) {
      setInputText(text);
      setReplyTo(currentReply);
    }
  };

  const handlePickImage = async () => {
    if (sending) return;
    let selectedUri: string | null = null;
    let selectedWidth = 0;
    let selectedHeight = 0;

    onSuspendAutoLock?.(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Allow photo library access to share images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });

      const asset = result.assets?.[0];
      if (result.canceled || !asset?.uri) return;
      selectedUri = asset.uri;
      selectedWidth = asset.width ?? 0;
      selectedHeight = asset.height ?? 0;
    } catch {
      Alert.alert('Image Error', 'Unable to pick image.');
      return;
    } finally {
      onSuspendAutoLock?.(false);
    }

    let context: ReturnType<typeof ImageManipulator.manipulate> | null = null;
    let rendered: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | null = null;
    try {
      // Normalize HEIC/PNG/48MP photos into compact <=1080px JPEG across iOS & Android
      context = ImageManipulator.manipulate(selectedUri, {
        maxWidth: 1080,
        maxHeight: 1080,
      });
      if (selectedWidth > 1080 || selectedHeight > 1080) {
        context.resize(selectedWidth >= selectedHeight ? { width: 1080 } : { height: 1080 });
      }
      rendered = await context.renderAsync();
      const manipulated = await rendered.saveAsync({
        compress: 0.55,
        format: SaveFormat.JPEG,
        base64: true,
      });

      if (!manipulated.base64) {
        Alert.alert('Image Error', 'Unable to process image.');
        return;
      }

      const caption = inputText.trim() || undefined;
      const currentReply = replyTo;
      setInputText('');
      setReplyTo(null);
      setEmojiVisible(false);

      const payload = encodeMessagePayload({
        text: caption,
        imageBase64: manipulated.base64,
        replyTo: currentReply,
      });
      await sendEncryptedPayload(payload);
    } catch {
      Alert.alert('Image Error', 'Unable to attach image.');
    } finally {
      try {
        rendered?.release();
      } catch {}
      try {
        context?.release();
      } catch {}
    }
  };

  const handleCopyMessage = async (msg: DecryptedMessage) => {
    const parsed = decodeMessagePayload(msg.content);
    const copyText = parsed.text || '';
    setSelectedMsg(null);
    if (copyText) {
      await Clipboard.setStringAsync(copyText);
    }
  };

  const handleReplyMessage = useCallback((msg: DecryptedMessage) => {
    const parsed = decodeMessagePayload(msg.content);
    const preview = parsed.imageBase64
      ? parsed.text
        ? `📷 ${parsed.text}`
        : '📷 Photo'
      : parsed.text || '';
    setReplyTo({ id: msg.id, preview: preview.slice(0, 80) });
    setSelectedMsg(null);
  }, []);

  const handleUnsendMessage = async (msg: DecryptedMessage) => {
    setSelectedMsg(null);
    const { error } = await supabase.from('messages').delete().eq('id', msg.id);
    if (error) {
      Alert.alert('Unsend Error', error.message);
      return;
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'del_msg',
      payload: { id: msg.id },
    });
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  };

  const handleUpdateTimer = async (patch: { disappear_seconds?: number; burn_on_read?: boolean }) => {
    const nextThread: Thread = {
      ...thread,
      ...patch,
    };
    onUpdateThread?.(nextThread);

    const { error } = await supabase
      .from('threads')
      .update(patch)
      .eq('id', thread.id);

    if (error) {
      onUpdateThread?.(thread);
      Alert.alert('Timer Update Failed', error.message);
    }
  };

  const formatTimerLabel = (seconds: number) => {
    if (seconds === 10) return '10s';
    if (seconds === 60) return '1m';
    if (seconds === 3600) return '1h';
    if (seconds === 86400) return '24h';
    return `${seconds}s`;
  };

  const safeTitle = getThreadDisplayTitle(thread, currentUser ?? null);
  const initials = safeTitle
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'C';

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastActivityLabel = lastMessage
    ? `${lastMessage.sender_id === currentUserId ? 'Last sent' : 'Last recd'} ${new Date(
        lastMessage.created_at
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null;

  const formatDatePill = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <View
      style={styles.container}
      onLayout={(e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        latestLayoutHeightRef.current = h;
        if (Platform.OS !== 'android') return;
        if (activeKbHeightRef.current === 0) {
          baseHeightRef.current = h;
        } else {
          const osResizedBy = Math.max(0, baseHeightRef.current - h);
          setAndroidKbPad(Math.max(0, activeKbHeightRef.current - osResizedBy - insets.bottom));
        }
      }}
    >
      {/* Dynamic Header Gradient (Blue-Violet Ice or Classic WhatsApp) */}
      <LinearGradient
        colors={[theme.gradientMid, theme.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Ionicons name="chevron-back" size={26} color={theme.headerText} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerInfo}
              activeOpacity={0.7}
              onPress={() => setTimerModalVisible(true)}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>
                {safeTitle}
              </Text>
              <View style={styles.headerSubRow}>
                {partnerTyping ? (
                  <Text style={[styles.headerSubtitle, { color: theme.headerText, fontWeight: '700' }]}>
                    typing...
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                      {partnerOnline ? 'online • ' : ''}
                      {lastActivityLabel ? `${lastActivityLabel} • ` : ''}
                      {thread.burn_on_read
                        ? '🔥 Burn (8s)'
                        : `⏱ ${formatTimerLabel(thread.disappear_seconds || 60)}`}
                    </Text>
                    <Ionicons name="chevron-down" size={12} color={theme.headerSubtext} />
                  </View>
                )}
              </View>
            </TouchableOpacity>

            <View style={styles.headerRight}>
              <View style={styles.headerAvatar}>
                <Text style={styles.headerAvatarText}>{initials || 'C'}</Text>
                {partnerOnline ? <View style={styles.onlineDot} /> : null}
              </View>
              <TouchableOpacity style={styles.headerIconBtn} onPress={onLock}>
                <Ionicons name="lock-closed-outline" size={20} color={theme.headerText} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Body + Composer: iOS uses native KeyboardAvoidingView, Android uses calibrated IME padding */}
      <KeyboardAvoidingView
        style={{ flex: 1, paddingBottom: Platform.OS === 'android' ? androidKbPad : 0 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages Canvas */}
        <View style={styles.canvas}>
          {initialLoading && messages.length === 0 ? (
            <View style={styles.chatLoaderContainer}>
              <View style={styles.chatLoaderCard}>
                <ActivityIndicator size="small" color={theme.accentGreen} />
                <Text style={styles.chatLoaderText}>Decrypting messages...</Text>
              </View>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.messagesList}
              ListHeaderComponent={
                hasOlderMessages ? (
                  <TouchableOpacity
                    style={styles.loadEarlierBtn}
                    activeOpacity={0.75}
                    onPress={handleLoadEarlier}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? (
                      <ActivityIndicator size="small" color={theme.accentGreen} />
                    ) : (
                      <Text style={styles.loadEarlierText}>Load earlier messages</Text>
                    )}
                  </TouchableOpacity>
                ) : undefined
              }
              onContentSizeChange={() => {
                if (!showScrollBottom) {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                const distanceFromBottom =
                  contentSize.height - contentOffset.y - layoutMeasurement.height;
                setShowScrollBottom(distanceFromBottom > 140);
              }}
              scrollEventThrottle={100}
              renderItem={({ item, index }) => {
                const isOutgoing = item.sender_id === currentUserId;
                const parsed = decodeMessagePayload(item.content);
                const timeStr = new Date(item.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                const prevMsg = index > 0 ? messages[index - 1] : null;
                const nextMsg = index < messages.length - 1 ? messages[index + 1] : null;
                const curDayKey = new Date(item.created_at).toDateString();
                const prevDayKey = prevMsg ? new Date(prevMsg.created_at).toDateString() : null;
                const nextDayKey = nextMsg ? new Date(nextMsg.created_at).toDateString() : null;
                const showDateDivider = curDayKey !== prevDayKey;
                const isFirstInGroup = showDateDivider || prevMsg?.sender_id !== item.sender_id;
                const isLastInGroup = nextDayKey !== curDayKey || nextMsg?.sender_id !== item.sender_id;

                return (
                  <View>
                    {showDateDivider ? (
                      <View style={styles.datePillWrapper}>
                        <View style={styles.datePill}>
                          <Text style={styles.datePillText}>{formatDatePill(item.created_at)}</Text>
                        </View>
                      </View>
                    ) : null}

                    <SwipeableMessageBubble
                      message={item}
                      onSwipeReply={handleReplyMessage}
                      hintStyle={styles.swipeReplyHint}
                    >
                      <View
                        style={[
                          styles.bubbleContainer,
                          isOutgoing ? styles.outgoingContainer : styles.incomingContainer,
                          {
                            marginTop: isFirstInGroup ? 8 : 2,
                            marginBottom: isLastInGroup ? 4 : 1,
                          },
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onLongPress={() => {
                            try {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            } catch {}
                            setSelectedMsg(item);
                          }}
                          style={[
                            styles.bubble,
                            isOutgoing ? styles.outgoingBubble : styles.incomingBubble,
                            isOutgoing && isLastInGroup && { borderBottomRightRadius: 4 },
                            !isOutgoing && isLastInGroup && { borderBottomLeftRadius: 4 },
                          ]}
                        >
                          {parsed.replyTo ? (
                            <View
                              style={[
                                styles.replyQuoteBox,
                                {
                                  backgroundColor: isOutgoing
                                    ? theme.quoteOutgoingBg
                                    : theme.quoteIncomingBg,
                                  borderLeftColor: isOutgoing
                                    ? theme.quoteOutgoingBorder
                                    : theme.quoteIncomingBorder,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.replyQuoteAuthor,
                                  {
                                    color: isOutgoing
                                      ? theme.quoteOutgoingAuthor
                                      : theme.quoteIncomingAuthor,
                                  },
                                ]}
                              >
                                Quoted message
                              </Text>
                              <Text
                                style={[
                                  styles.replyQuoteText,
                                  {
                                    color: isOutgoing
                                      ? theme.bubbleOutgoingMeta
                                      : theme.textSecondary,
                                  },
                                ]}
                                numberOfLines={2}
                              >
                                {parsed.replyTo.preview}
                              </Text>
                            </View>
                          ) : null}

                          {parsed.imageBase64 ? (
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() =>
                                setPreviewImageUri(`data:image/jpeg;base64,${parsed.imageBase64}`)
                              }
                              onLongPress={() => setSelectedMsg(item)}
                              style={styles.imageWrapper}
                            >
                              <Image
                                source={{ uri: `data:image/jpeg;base64,${parsed.imageBase64}` }}
                                style={styles.bubbleImage}
                                resizeMode="cover"
                              />
                              {item.isOptimistic ? (
                                <View style={styles.imageUploadOverlay}>
                                  <ActivityIndicator size="small" color="#FFFFFF" />
                                  <Text style={styles.imageUploadText}>Encrypting...</Text>
                                </View>
                              ) : null}
                            </TouchableOpacity>
                          ) : null}

                          {parsed.text ? (
                            <Text
                              style={[
                                styles.messageText,
                                isOutgoing ? styles.outgoingMessageText : styles.incomingMessageText,
                              ]}
                            >
                              {parsed.text}
                            </Text>
                          ) : null}

                          <View style={styles.metaRow}>
                            {item.isBurning && item.remainingSeconds !== undefined ? (
                              <View
                                style={[
                                  styles.burnBadge,
                                  {
                                    backgroundColor: isOutgoing
                                      ? theme.burnBadgeOutgoingBg
                                      : theme.burnBadgeIncomingBg,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name="flame"
                                  size={12}
                                  color={
                                    isOutgoing
                                      ? theme.burnBadgeOutgoingText
                                      : theme.burnBadgeIncomingText
                                  }
                                />
                                <Text
                                  style={[
                                    styles.burnBadgeText,
                                    {
                                      color: isOutgoing
                                        ? theme.burnBadgeOutgoingText
                                        : theme.burnBadgeIncomingText,
                                    },
                                  ]}
                                >
                                  {item.remainingSeconds < 60
                                    ? `${item.remainingSeconds}s`
                                    : item.remainingSeconds < 3600
                                    ? `${Math.ceil(item.remainingSeconds / 60)}m`
                                    : item.remainingSeconds < 86400
                                    ? `${Math.ceil(item.remainingSeconds / 3600)}h`
                                    : `${Math.ceil(item.remainingSeconds / 86400)}d`}
                                </Text>
                              </View>
                            ) : thread.burn_on_read ? (
                              <Text style={styles.burnHint}>🔥</Text>
                            ) : null}

                            <Text
                              style={[
                                styles.timeMeta,
                                isOutgoing && { color: theme.bubbleOutgoingMeta },
                              ]}
                            >
                              {timeStr}
                            </Text>

                            {isOutgoing ? (
                              <Ionicons
                                name={item.isOptimistic ? 'time-outline' : 'checkmark-done'}
                                size={15}
                                color={item.read_at ? theme.tickReadOnBubble : theme.tickGrayOnBubble}
                                style={{ marginLeft: 4 }}
                              />
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      </View>
                    </SwipeableMessageBubble>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyMessagesContainer}>
                  <View style={styles.securityBanner}>
                    <Ionicons name="lock-closed-outline" size={16} color={theme.accentGreen} />
                    <Text style={styles.securityBannerText}>
                      Messages are end-to-end ciphered with your device secret and burn automatically from Supabase. Zero messages are saved to disk.
                    </Text>
                  </View>
                </View>
              }
            />
          )}

        {/* Floating Scroll-to-Bottom Button */}
        {showScrollBottom ? (
          <TouchableOpacity
            style={styles.scrollBottomBtn}
            activeOpacity={0.8}
            onPress={() => {
              setShowScrollBottom(false);
              flatListRef.current?.scrollToEnd({ animated: true });
            }}
          >
            <Ionicons name="arrow-down" size={20} color={theme.accentGreen} />
          </TouchableOpacity>
        ) : null}
        </View>

        {/* Reply Preview Banner */}
        {replyTo ? (
          <View style={styles.replyBanner}>
            <View style={styles.replyBannerBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyBannerLabel}>Replying to message</Text>
              <Text style={styles.replyBannerText} numberOfLines={1}>
                {replyTo.preview}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} style={{ padding: 4 }}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Quick Emoji Picker Bar */}
        {emojiVisible ? (
          <View style={styles.emojiBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {QUICK_EMOJIS.map((em) => (
                <TouchableOpacity
                  key={em}
                  style={styles.emojiBtn}
                  onPress={() => handleInputChange(inputText + em)}
                >
                  <Text style={styles.emojiChar}>{em}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Composer Bar (Adapts cleanly between Ice & WhatsApp layouts) */}
        <SafeAreaView edges={['bottom']} style={styles.composerSafe}>
          <View style={styles.composerContainer}>
            <View style={styles.pillInput}>
              {theme.preset === 'ice' ? (
                <TouchableOpacity onPress={handlePickImage} style={styles.attachCircleBtn}>
                  <Ionicons name="add" size={20} color={theme.textOnAccent} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => setEmojiVisible((prev) => !prev)}
                  style={{ marginRight: 8 }}
                >
                  <Ionicons
                    name={emojiVisible ? 'keypad-outline' : 'happy-outline'}
                    size={22}
                    color={emojiVisible ? theme.accentGreen : theme.textSecondary}
                  />
                </TouchableOpacity>
              )}

              <TextInput
                style={styles.textInput}
                placeholder="Message"
                placeholderTextColor={theme.textSecondary}
                value={inputText}
                onChangeText={handleInputChange}
                multiline
              />

              {theme.preset === 'ice' ? (
                <TouchableOpacity
                  onPress={() => setEmojiVisible((prev) => !prev)}
                  style={{ marginLeft: 8 }}
                >
                  <Ionicons
                    name={emojiVisible ? 'keypad-outline' : 'happy-outline'}
                    size={22}
                    color={emojiVisible ? theme.accentGreen : theme.textSecondary}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={handlePickImage} style={{ marginLeft: 8 }}>
                  <Ionicons name="attach-outline" size={22} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleSendMessage}
              disabled={!inputText.trim() || sending}
            >
              <Ionicons
                name="send"
                size={18}
                color={theme.textOnAccent}
                style={{ marginLeft: 2 }}
              />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* Long-Press Message Action Menu */}
      <Modal
        visible={Boolean(selectedMsg)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMsg(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMsg(null)}
        >
          <View style={styles.actionCard}>
            {selectedMsg ? (
              <>
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => handleReplyMessage(selectedMsg)}
                >
                  <Ionicons name="arrow-undo-outline" size={20} color={theme.textPrimary} />
                  <Text style={styles.actionText}>Reply</Text>
                </TouchableOpacity>

                {decodeMessagePayload(selectedMsg.content).text ? (
                  <TouchableOpacity
                    style={styles.actionRow}
                    onPress={() => handleCopyMessage(selectedMsg)}
                  >
                    <Ionicons name="copy-outline" size={20} color={theme.textPrimary} />
                    <Text style={styles.actionText}>Copy</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => handleUnsendMessage(selectedMsg)}
                >
                  <Ionicons name="trash-outline" size={20} color={theme.danger} />
                  <Text style={[styles.actionText, { color: theme.danger }]}>
                    Unsend (Delete for Both)
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* In-Chat Timer & Burn Switcher Modal */}
      <Modal
        visible={timerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTimerModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setTimerModalVisible(false)}
        >
          <View style={styles.timerCard}>
            <Text style={styles.timerTitle}>Disappearing Message Timer</Text>
            <View style={styles.timerPillsRow}>
              {TIMER_OPTIONS.map((opt) => {
                const active = !thread.burn_on_read && (thread.disappear_seconds || 60) === opt.seconds;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.timerPill, active && styles.timerPillActive]}
                    onPress={() =>
                      handleUpdateTimer({ disappear_seconds: opt.seconds, burn_on_read: false })
                    }
                  >
                    <Text style={[styles.timerPillText, active && styles.timerPillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.burnToggleRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.actionText}>Burn on Read (8s)</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
                  All timers wait safely while unread (up to 7 days), then burn 8s (or your selected timer) after recipient reads the message.
                </Text>
              </View>
              <Switch
                value={thread.burn_on_read}
                onValueChange={(val) => handleUpdateTimer({ burn_on_read: val })}
                trackColor={{ false: theme.divider, true: theme.accentGreen }}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full-Screen Image Preview Modal */}
      <Modal
        visible={Boolean(previewImageUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <View style={styles.imagePreviewOverlay}>
          <TouchableOpacity
            style={styles.imagePreviewClose}
            onPress={() => setPreviewImageUri(null)}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImageUri ? (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.imagePreviewFull}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bgCard,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    backBtn: {
      padding: 4,
      marginRight: 6,
    },
    headerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.headerAvatarBg,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: theme.headerAvatarBorder,
    },
    headerAvatarText: {
      color: theme.headerAvatarText,
      fontSize: 14,
      fontWeight: '700',
    },
    headerInfo: {
      flex: 1,
      paddingRight: 8,
    },
    headerTitle: {
      color: theme.headerText,
      fontSize: 17,
      fontWeight: '700',
    },
    headerSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 2,
    },
    headerSubtitle: {
      color: theme.headerSubtext,
      fontSize: 12,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerIconBtn: {
      padding: 6,
    },
    canvas: {
      flex: 1,
      backgroundColor: theme.bgPrimary,
    },
    messagesList: {
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    bubbleContainer: {
      flexDirection: 'row',
    },
    outgoingContainer: {
      justifyContent: 'flex-end',
    },
    incomingContainer: {
      justifyContent: 'flex-start',
    },
    bubble: {
      maxWidth: '80%',
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 7,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: theme.isDark ? 0.22 : 0.06,
      shadowRadius: 6,
      elevation: 1,
    },
    outgoingBubble: {
      backgroundColor: theme.bubbleOutgoing,
    },
    incomingBubble: {
      backgroundColor: theme.bubbleIncoming,
    },
    onlineDot: {
      position: 'absolute',
      bottom: -1,
      right: -1,
      width: 11,
      height: 11,
      borderRadius: 6,
      backgroundColor: theme.onlineGreen,
      borderWidth: 2,
      borderColor: theme.gradientEnd,
    },
    chatLoaderContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatLoaderCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bgCard,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 24,
      gap: 10,
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.3 : 0.08,
      shadowRadius: 10,
      elevation: 3,
    },
    chatLoaderText: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    loadEarlierBtn: {
      alignSelf: 'center',
      backgroundColor: theme.surfaceHighlight,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      marginBottom: 10,
    },
    loadEarlierText: {
      color: theme.accentGreen,
      fontSize: 12,
      fontWeight: '600',
    },
    datePillWrapper: {
      alignItems: 'center',
      marginVertical: 10,
    },
    datePill: {
      backgroundColor: theme.datePillBg,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 12,
    },
    datePillText: {
      color: theme.datePillText,
      fontSize: 11,
      fontWeight: '600',
    },
    messageText: {
      fontSize: 15,
      lineHeight: 21,
    },
    outgoingMessageText: {
      color: theme.bubbleOutgoingText,
    },
    incomingMessageText: {
      color: theme.bubbleIncomingText,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      marginTop: 4,
    },
    burnBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 8,
      marginRight: 6,
      gap: 3,
    },
    burnBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    burnHint: {
      fontSize: 10,
      marginRight: 4,
    },
    timeMeta: {
      color: theme.textSecondary,
      fontSize: 11,
    },
    emptyMessagesContainer: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    securityBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bgCard,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      maxWidth: '92%',
      gap: 8,
    },
    securityBannerText: {
      color: theme.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      flex: 1,
      textAlign: 'center',
    },
    composerSafe: {
      backgroundColor: theme.bgCard,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    composerContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: theme.bgCard,
      gap: 8,
    },
    pillInput: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bgInputPill,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 26,
      paddingHorizontal: theme.preset === 'ice' ? 8 : 14,
      paddingRight: 14,
      minHeight: 46,
      maxHeight: 120,
    },
    attachCircleBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.accentGreen,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    textInput: {
      flex: 1,
      color: theme.textPrimary,
      fontSize: 15,
      paddingVertical: 8,
    },
    sendButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.accentGreen,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: theme.accentGreen,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 3,
    },
    sendButtonDisabled: {
      opacity: 0.45,
    },
    replyQuoteBox: {
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingHorizontal: 9,
      paddingVertical: 5,
      marginBottom: 6,
    },
    replyQuoteAuthor: {
      fontSize: 11,
      fontWeight: '700',
      marginBottom: 2,
    },
    replyQuoteText: {
      fontSize: 12,
    },
    imageWrapper: {
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
    },
    bubbleImage: {
      width: 224,
      height: 224,
    },
    imageUploadOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.52)',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
    },
    imageUploadText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },
    scrollBottomBtn: {
      position: 'absolute',
      right: 14,
      bottom: 14,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.bgCard,
      borderWidth: 1,
      borderColor: theme.divider,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 6,
    },
    replyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bgCard,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
      gap: 10,
    },
    replyBannerBar: {
      width: 3,
      height: 30,
      backgroundColor: theme.accentGreen,
      borderRadius: 2,
    },
    replyBannerLabel: {
      color: theme.accentGreen,
      fontSize: 11,
      fontWeight: '700',
    },
    replyBannerText: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    emojiBar: {
      backgroundColor: theme.bgCard,
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    emojiBtn: {
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    emojiChar: {
      fontSize: 24,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    actionCard: {
      width: '80%',
      backgroundColor: theme.bgCard,
      borderRadius: 18,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.35 : 0.16,
      shadowRadius: 20,
      elevation: 10,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    actionText: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: '500',
    },
    imagePreviewOverlay: {
      flex: 1,
      backgroundColor: '#000000',
      justifyContent: 'center',
      alignItems: 'center',
    },
    imagePreviewClose: {
      position: 'absolute',
      top: 48,
      right: 20,
      zIndex: 10,
      padding: 8,
    },
    imagePreviewFull: {
      width: '100%',
      height: '80%',
    },
    swipeReplyHint: {
      position: 'absolute',
      left: 10,
      top: '50%',
      marginTop: -12,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.bgCard,
      borderWidth: 1,
      borderColor: theme.divider,
      justifyContent: 'center',
      alignItems: 'center',
    },
    timerCard: {
      width: '88%',
      backgroundColor: theme.bgCard,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.35 : 0.16,
      shadowRadius: 20,
      elevation: 10,
    },
    timerTitle: {
      color: theme.textPrimary,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 14,
    },
    timerPillsRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 18,
    },
    timerPill: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.bgInputPill,
      alignItems: 'center',
    },
    timerPillActive: {
      backgroundColor: theme.accentGreen,
    },
    timerPillText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    timerPillTextActive: {
      color: theme.textOnAccent,
    },
    burnToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
  });

