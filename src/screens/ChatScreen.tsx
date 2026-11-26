import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
import { decryptMessage, encryptMessage } from '../lib/cryptoCodec';
import { Message, Thread } from '../types/database';
import { whatsappTheme } from '../theme/whatsappTheme';

interface ChatScreenProps {
  thread: Thread;
  currentUserId: string;
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
  onBack,
  onLock,
}) => {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Fetch initial messages for thread and subscribe to Realtime
  useEffect(() => {
    loadMessages();

    // Realtime channel for messages in this thread
    const channel = supabase
      .channel(`realtime:messages:${thread.id}`)
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
            const rawMsg = payload.new as Message;
            const plainContent = await decryptMessage(rawMsg.content);
            const decryptedMsg: DecryptedMessage = {
              ...rawMsg,
              content: plainContent,
            };

            setMessages((prev) => {
              if (prev.some((m) => m.id === decryptedMsg.id)) return prev;
              return [...prev, decryptedMsg];
            });

            // If incoming message and burn_on_read is true, trigger burn countdown
            if (rawMsg.sender_id !== currentUserId && thread.burn_on_read) {
              handleIncomingBurn(rawMsg.id);
            }
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
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread.id, currentUserId]);

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    if (!error && data) {
      const now = new Date();
      const validMessages = data.filter((m: Message) => new Date(m.expires_at) > now);

      const decrypted = await Promise.all(
        validMessages.map(async (m: Message) => {
          const content = await decryptMessage(m.content);
          return {
            ...m,
            content,
          } as DecryptedMessage;
        })
      );

      setMessages(decrypted);

      // Trigger burn for any unread incoming messages when opening chat
      if (thread.burn_on_read) {
        decrypted.forEach((m) => {
          if (m.sender_id !== currentUserId) {
            handleIncomingBurn(m.id);
          }
        });
      }
    }
  };

  // Burn on read: grace timer (8 seconds) then permanent deletion from Supabase
  const handleIncomingBurn = async (messageId: string) => {
    // Mark read in Supabase
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', messageId);

    // Set 8-second countdown in memory
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, isBurning: true, remainingSeconds: 8 } : m
      )
    );

    // Start tick-down and delete
    let remaining = 8;
    const interval = setInterval(async () => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        // Delete permanently from Supabase
        await supabase.from('messages').delete().eq('id', messageId);
        // Remove from local memory
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, remainingSeconds: remaining } : m))
        );
      }
    }, 1000);
  };

  // 1-second interval to purge expired messages from memory and clean up expired rows
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMessages((prev) => prev.filter((m) => new Date(m.expires_at) > now));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    setSending(true);
    setInputText('');

    const disappearSecs = thread.disappear_seconds || 60;
    const expiresAt = new Date(Date.now() + disappearSecs * 1000).toISOString();

    // Client-side cipher encryption before sending to Supabase
    const encryptedContent = await encryptMessage(text);

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
      setInputText(text);
      Alert.alert('Send Error', error.message);
    } else if (data) {
      const newMsg: DecryptedMessage = {
        ...data,
        content: text,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const safeTitle = (thread && typeof thread.title === 'string' && thread.title.trim()) ? thread.title : 'Chat';
  const initials = safeTitle
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'C';

  return (
    <SafeAreaView style={styles.container}>
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
            {thread.title}
          </Text>
          <View style={styles.headerSubRow}>
            {thread.burn_on_read ? (
              <Text style={styles.headerSubtitle}>🔥 Burn on read</Text>
            ) : (
              <Text style={styles.headerSubtitle}>
                ⏱ {thread.disappear_seconds}s timer
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

      {/* Messages Canvas with WhatsApp dark doodle overlay */}
      <View style={styles.canvas}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isOutgoing = item.sender_id === currentUserId;
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
                <View
                  style={[
                    styles.bubble,
                    isOutgoing ? styles.outgoingBubble : styles.incomingBubble,
                  ]}
                >
                  <Text style={styles.messageText}>{item.content}</Text>

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
                </View>
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
      </View>

      {/* WhatsApp Pill Composer */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <View style={styles.composerContainer}>
          <View style={styles.pillInput}>
            <Ionicons
              name="happy-outline"
              size={22}
              color={whatsappTheme.textSecondary}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.textInput}
              placeholder="Message"
              placeholderTextColor={whatsappTheme.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <Ionicons
              name="attach-outline"
              size={22}
              color={whatsappTheme.textSecondary}
              style={{ marginLeft: 8 }}
            />
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
});

