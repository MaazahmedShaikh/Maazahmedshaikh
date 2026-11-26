import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { decryptMessage, encryptMessage } from '../lib/cryptoCodec';
import {
  decodeMessagePayload,
  encodeMessagePayload,
  ReplyPreview,
} from '../lib/messagePayload';
import { Message, Thread, User } from '../types/database';
import { getThreadDisplayTitle } from '../lib/directChat';
import { whatsappTheme } from '../theme/whatsappTheme';

const QUICK_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😘', '😊', '🤔', '😭',
  '🙏', '🔥', '❤️', '👍', '🎉', '👀', '💯', '✨',
];

interface ChatScreenProps {
  thread: Thread;
  currentUserId: string;
  currentUser?: User | null;
  onBack: () => void;
  onLock: () => void;
}

interface DecryptedMessage extends Message {
  remainingSeconds?: number;
  isBurning?: boolean;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  thread,
  currentUserId,
  currentUser,
  onBack,
  onLock,
}) => {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<DecryptedMessage | null>(null);
  const [emojiVisible, setEmojiVisible] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const burningIdsRef = useRef<Set<string>>(new Set());
  const burnIntervalsRef = useRef<Map<string, any>>(new Map());

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

  // Burn on read (receiver): mark read_at in Supabase so sender syncs, then count down 8s and delete
  const handleIncomingBurn = useCallback(
    async (messageId: string) => {
      if (burningIdsRef.current.has(messageId)) return;
      startBurnCountdown(messageId, 8, true);
      const readAt = new Date().toISOString();
      await supabase
        .from('messages')
        .update({ read_at: readAt })
        .eq('id', messageId);

      channelRef.current?.send({
        type: 'broadcast',
        event: 'read_msg',
        payload: { id: messageId, read_at: readAt },
      });
    },
    [startBurnCountdown]
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

  // Scroll to bottom when keyboard opens
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    });
    return () => sub.remove();
  }, []);

  // Fetch messages, subscribe to Realtime (WAL + Broadcast + Presence), and keep 2.5s silent sync fallback
  useEffect(() => {
    let mounted = true;

    const applyIncomingRow = async (rawMsg: Message) => {
      if (new Date(rawMsg.expires_at) <= new Date()) return;
      const plainContent = await decryptMessage(rawMsg.content);
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

      if (rawMsg.sender_id !== currentUserId && thread.burn_on_read) {
        handleIncomingBurn(rawMsg.id);
      }
    };

    const syncFromServer = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true });

      if (!mounted || error || !data) return;

      const now = new Date();
      const validRows = (data as Message[]).filter((m) => new Date(m.expires_at) > now);
      const serverIds = new Set(validRows.map((m) => m.id));

      const decryptedRows = await Promise.all(
        validRows.map(async (m) => {
          const content = await decryptMessage(m.content);
          return { ...m, content } as DecryptedMessage;
        })
      );

      if (!mounted) return;

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
        // Preserve any just-sent local message not yet pruned, drop deleted server messages
        prev.forEach((m) => {
          if (!serverIds.has(m.id)) {
            const interval = burnIntervalsRef.current.get(m.id);
            if (interval) {
              clearInterval(interval);
              burnIntervalsRef.current.delete(m.id);
            }
            burningIdsRef.current.delete(m.id);
          }
        });
        return next;
      });

      if (thread.burn_on_read) {
        decryptedRows.forEach((m) => {
          if (m.sender_id !== currentUserId) {
            handleIncomingBurn(m.id);
          } else if (m.read_at) {
            const elapsed = Math.floor((Date.now() - new Date(m.read_at).getTime()) / 1000);
            const remaining = Math.max(1, 8 - elapsed);
            startBurnCountdown(m.id, remaining, false);
          }
        });
      }
    };

    syncFromServer();
    const syncTimer = setInterval(syncFromServer, 2500);

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
          setMessages((prev) => prev.filter((m) => m.id !== payload.id));
        }
      })
      .on('broadcast', { event: 'read_msg' }, ({ payload }) => {
        if (payload?.id && payload?.read_at && thread.burn_on_read) {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.id ? { ...m, read_at: payload.read_at } : m))
          );
          const elapsed = Math.floor((Date.now() - new Date(payload.read_at).getTime()) / 1000);
          const remaining = Math.max(1, 8 - elapsed);
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
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Message;
            const plainContent = await decryptMessage(updated.content);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === updated.id ? { ...m, ...updated, content: plainContent } : m
              )
            );

            // Sync burn countdown on sender screen when recipient marks read_at
            if (updated.read_at && updated.sender_id === currentUserId && thread.burn_on_read) {
              const elapsed = Math.floor((Date.now() - new Date(updated.read_at).getTime()) / 1000);
              const remaining = Math.max(1, 8 - elapsed);
              startBurnCountdown(updated.id, remaining, false);
            }
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online: true, typing: false });
        }
      });

    channelRef.current = channel;

    return () => {
      mounted = false;
      clearInterval(syncTimer);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [thread.id, thread.burn_on_read, currentUserId, handleIncomingBurn, startBurnCountdown]);

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
    ch.track({ online: true, typing: isTyping }).catch(() => {});

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        channelRef.current?.track({ online: true, typing: false }).catch(() => {});
      }, 2500);
    }
  };

  const sendEncryptedPayload = async (rawPayload: string) => {
    setSending(true);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    channelRef.current?.track({ online: true, typing: false }).catch(() => {});

    const disappearSecs = thread.disappear_seconds || 60;
    const expiresAt = new Date(Date.now() + disappearSecs * 1000).toISOString();
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
      Alert.alert('Send Error', error.message);
      return false;
    }

    if (data) {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'new_msg',
        payload: data,
      });

      const newMsg: DecryptedMessage = {
        ...data,
        content: rawPayload,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
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
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Allow photo library access to share images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.4,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const caption = inputText.trim() || undefined;
      const currentReply = replyTo;
      setInputText('');
      setReplyTo(null);
      setEmojiVisible(false);

      const payload = encodeMessagePayload({
        text: caption,
        imageBase64: result.assets[0].base64,
        replyTo: currentReply,
      });
      await sendEncryptedPayload(payload);
    } catch {
      Alert.alert('Image Error', 'Unable to attach image.');
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

  const handleReplyMessage = (msg: DecryptedMessage) => {
    const parsed = decodeMessagePayload(msg.content);
    const preview = parsed.imageBase64
      ? parsed.text
        ? `📷 ${parsed.text}`
        : '📷 Photo'
      : parsed.text || '';
    setReplyTo({ id: msg.id, preview: preview.slice(0, 80) });
    setSelectedMsg(null);
  };

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

  const safeTitle = getThreadDisplayTitle(thread, currentUser ?? null);
  const initials = safeTitle
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'C';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color={whatsappTheme.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{initials || 'C'}</Text>
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {safeTitle}
          </Text>
          <View style={styles.headerSubRow}>
            {partnerTyping ? (
              <Text style={[styles.headerSubtitle, { color: whatsappTheme.accentGreen }]}>
                typing...
              </Text>
            ) : (
              <Text style={styles.headerSubtitle}>
                {partnerOnline ? 'online • ' : ''}
                {thread.burn_on_read
                  ? '🔥 Burn on read'
                  : `⏱ ${thread.disappear_seconds}s timer`}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={onLock}>
            <Ionicons name="lock-closed-outline" size={20} color={whatsappTheme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Body + Composer wrapped in KeyboardAvoidingView so textbox always sits on top of keyboard on Android & iOS */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Messages Canvas */}
        <View style={styles.canvas}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.messagesList}
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
          renderItem={({ item }) => {
            const isOutgoing = item.sender_id === currentUserId;
            const parsed = decodeMessagePayload(item.content);
            const timeStr = new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <View
                style={[
                  styles.bubbleContainer,
                  isOutgoing ? styles.outgoingContainer : styles.incomingContainer,
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
                  ]}
                >
                  {parsed.replyTo ? (
                    <View style={styles.replyQuoteBox}>
                      <Text style={styles.replyQuoteText} numberOfLines={2}>
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
                    >
                      <Image
                        source={{ uri: `data:image/jpeg;base64,${parsed.imageBase64}` }}
                        style={styles.bubbleImage}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ) : null}

                  {parsed.text ? (
                    <Text style={styles.messageText}>{parsed.text}</Text>
                  ) : null}

                  <View style={styles.metaRow}>
                    {item.isBurning && item.remainingSeconds !== undefined ? (
                      <View style={styles.burnBadge}>
                        <Ionicons name="flame" size={12} color="#FFA500" />
                        <Text style={styles.burnBadgeText}>
                          {item.remainingSeconds}s
                        </Text>
                      </View>
                    ) : thread.burn_on_read ? (
                      <Text style={styles.burnHint}>🔥</Text>
                    ) : null}

                    <Text style={styles.timeMeta}>{timeStr}</Text>

                    {isOutgoing ? (
                      <Ionicons
                        name="checkmark-done"
                        size={15}
                        color={item.read_at ? whatsappTheme.tickBlue : whatsappTheme.tickGray}
                        style={{ marginLeft: 3 }}
                      />
                    ) : null}
                  </View>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyMessagesContainer}>
              <View style={styles.securityBanner}>
                <Ionicons name="lock-closed" size={14} color="#F5A623" />
                <Text style={styles.securityBannerText}>
                  Messages are end-to-end ciphered with your device secret and burn automatically from Supabase. Zero messages are saved to disk.
                </Text>
              </View>
            </View>
          }
        />

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
            <Ionicons name="arrow-down" size={20} color={whatsappTheme.textPrimary} />
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
              <Ionicons name="close" size={18} color={whatsappTheme.textSecondary} />
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

        <View style={styles.composerContainer}>
          <View style={styles.pillInput}>
            <TouchableOpacity
              onPress={() => setEmojiVisible((prev) => !prev)}
              style={{ marginRight: 8 }}
            >
              <Ionicons
                name={emojiVisible ? 'keypad-outline' : 'happy-outline'}
                size={22}
                color={emojiVisible ? whatsappTheme.accentGreen : whatsappTheme.textSecondary}
              />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Message"
              placeholderTextColor={whatsappTheme.textSecondary}
              value={inputText}
              onChangeText={handleInputChange}
              multiline
            />
            <TouchableOpacity onPress={handlePickImage} style={{ marginLeft: 8 }}>
              <Ionicons
                name="attach-outline"
                size={22}
                color={whatsappTheme.textSecondary}
              />
            </TouchableOpacity>
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
              color="#0B141A"
              style={{ marginLeft: 2 }}
            />
          </TouchableOpacity>
        </View>
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
                  <Ionicons name="arrow-undo-outline" size={20} color={whatsappTheme.textPrimary} />
                  <Text style={styles.actionText}>Reply</Text>
                </TouchableOpacity>

                {decodeMessagePayload(selectedMsg.content).text ? (
                  <TouchableOpacity
                    style={styles.actionRow}
                    onPress={() => handleCopyMessage(selectedMsg)}
                  >
                    <Ionicons name="copy-outline" size={20} color={whatsappTheme.textPrimary} />
                    <Text style={styles.actionText}>Copy</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => handleUnsendMessage(selectedMsg)}
                >
                  <Ionicons name="trash-outline" size={20} color={whatsappTheme.danger} />
                  <Text style={[styles.actionText, { color: whatsappTheme.danger }]}>
                    Unsend (Delete for Both)
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: whatsappTheme.bgHeader,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: whatsappTheme.bgHeader,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whatsappTheme.divider,
  },
  backBtn: {
    padding: 6,
    marginRight: 4,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: whatsappTheme.bgSearchFocus,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerAvatarText: {
    color: whatsappTheme.accentGreen,
    fontSize: 15,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: whatsappTheme.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSubtitle: {
    color: whatsappTheme.textSecondary,
    fontSize: 12,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  headerIconBtn: {
    padding: 6,
  },
  canvas: {
    flex: 1,
    backgroundColor: whatsappTheme.bgPrimary,
  },
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  bubbleContainer: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  outgoingContainer: {
    justifyContent: 'flex-end',
  },
  incomingContainer: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  outgoingBubble: {
    backgroundColor: whatsappTheme.bubbleOutgoing,
    borderTopRightRadius: 2,
  },
  incomingBubble: {
    backgroundColor: whatsappTheme.bubbleIncoming,
    borderTopLeftRadius: 2,
  },
  messageText: {
    color: whatsappTheme.textPrimary,
    fontSize: 15,
    lineHeight: 20,
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
    backgroundColor: 'rgba(255, 165, 0, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    marginRight: 6,
    gap: 3,
  },
  burnBadgeText: {
    color: '#FFA500',
    fontSize: 10,
    fontWeight: '700',
  },
  burnHint: {
    fontSize: 10,
    marginRight: 4,
  },
  timeMeta: {
    color: whatsappTheme.textSecondary,
    fontSize: 11,
  },
  emptyMessagesContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  securityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 44, 52, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '90%',
    gap: 8,
  },
  securityBannerText: {
    color: '#D1D7DB',
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
    textAlign: 'center',
  },
  composerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: whatsappTheme.bgPrimary,
    gap: 8,
  },
  pillInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: whatsappTheme.bgInputPill,
    borderRadius: 24,
    paddingHorizontal: 14,
    minHeight: 46,
    maxHeight: 120,
  },
  textInput: {
    flex: 1,
    color: whatsappTheme.textPrimary,
    fontSize: 15,
    paddingVertical: 8,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: whatsappTheme.accentGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  replyQuoteBox: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderLeftWidth: 3,
    borderLeftColor: whatsappTheme.accentGreen,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  replyQuoteText: {
    color: whatsappTheme.textSecondary,
    fontSize: 12,
  },
  bubbleImage: {
    width: 210,
    height: 210,
    borderRadius: 8,
    marginBottom: 4,
  },
  scrollBottomBtn: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: whatsappTheme.bgHeader,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: whatsappTheme.bgHeader,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: whatsappTheme.divider,
    gap: 10,
  },
  replyBannerBar: {
    width: 3,
    height: 30,
    backgroundColor: whatsappTheme.accentGreen,
    borderRadius: 2,
  },
  replyBannerLabel: {
    color: whatsappTheme.accentGreen,
    fontSize: 11,
    fontWeight: '700',
  },
  replyBannerText: {
    color: whatsappTheme.textSecondary,
    fontSize: 13,
  },
  emojiBar: {
    backgroundColor: whatsappTheme.bgHeader,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: whatsappTheme.divider,
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionCard: {
    width: '80%',
    backgroundColor: whatsappTheme.bgHeader,
    borderRadius: 14,
    paddingVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  actionText: {
    color: whatsappTheme.textPrimary,
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
});

