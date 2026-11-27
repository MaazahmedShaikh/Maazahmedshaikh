import { Message } from '../types/database';

export interface CachedMessage extends Message {
  remainingSeconds?: number;
  isBurning?: boolean;
  isOptimistic?: boolean;
}

export interface ThreadActivitySummary {
  lastMessageAt: string;
  lastSenderId: string;
  lastReadAt: string | null;
}

// Strict volatile RAM-only cache (zero disk/AsyncStorage persistence).
// Wiped cleanly whenever panic lock, duress, or sign-out occurs.
const messagesByThread = new Map<string, CachedMessage[]>();
const plaintextById = new Map<string, string>();
const activityByThread = new Map<string, ThreadActivitySummary>();

export function getCachedThreadMessages(threadId: string): CachedMessage[] {
  const list = messagesByThread.get(threadId) || [];
  const nowMs = Date.now();
  return list.filter((m) => new Date(m.expires_at).getTime() > nowMs);
}

export function setCachedThreadMessages(threadId: string, messages: CachedMessage[]): void {
  const nowMs = Date.now();
  const valid = messages.filter((m) => new Date(m.expires_at).getTime() > nowMs);
  messagesByThread.set(threadId, valid);

  if (valid.length > 0) {
    const latest = valid[valid.length - 1];
    activityByThread.set(threadId, {
      lastMessageAt: latest.created_at,
      lastSenderId: latest.sender_id,
      lastReadAt: latest.read_at,
    });
  }
}

export function getCachedPlaintext(messageId: string): string | undefined {
  return plaintextById.get(messageId);
}

export function setCachedPlaintext(messageId: string, plaintext: string): void {
  plaintextById.set(messageId, plaintext);
}

export function deleteCachedPlaintext(messageId: string): void {
  plaintextById.delete(messageId);
}

export function getCachedThreadActivity(threadId: string): ThreadActivitySummary | undefined {
  return activityByThread.get(threadId);
}

export function setCachedThreadActivity(
  threadId: string,
  summary: ThreadActivitySummary
): void {
  activityByThread.set(threadId, summary);
}

export function clearMemoryCache(): void {
  messagesByThread.clear();
  plaintextById.clear();
  activityByThread.clear();
}
