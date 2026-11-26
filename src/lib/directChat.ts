import { supabase } from './supabase';
import { Thread, User } from '../types/database';

export const MAAZ_USER_ID = '7003aff8-20e1-4c59-b194-46797fc3957e';
export const FARNAZ_USER_ID = '0389abd2-3e56-4142-93d2-76a582f86642';
export const SHARED_THREAD_KEY = 'Maaz <-> Farnaz';

/**
 * Returns the partner's display name for the currently logged-in user:
 * - Maaz sees "Farnaz"
 * - Farnaz sees "Maaz"
 */
export function getPartnerDisplayName(user: User | null): string {
  if (!user) return 'Private Chat';
  const email = (user.email || '').toLowerCase();
  if (user.id === MAAZ_USER_ID || email.includes('maaz')) {
    return 'Farnaz';
  }
  if (user.id === FARNAZ_USER_ID || email.includes('farnaz')) {
    return 'Maaz';
  }
  return 'Private Chat';
}

/**
 * Resolves the thread title relative to the logged-in user so both Maaz and Farnaz
 * see each other's name on their shared conversation.
 */
export function getThreadDisplayTitle(thread: Thread | null | undefined, user: User | null): string {
  const raw = thread && typeof thread.title === 'string' ? thread.title.trim() : '';
  if (!raw || raw === SHARED_THREAD_KEY || raw.toLowerCase() === 'farnaz' || raw.toLowerCase() === 'maaz') {
    return getPartnerDisplayName(user);
  }
  return raw;
}

/**
 * Finds the shared Maaz <-> Farnaz thread or creates it automatically if none exists yet.
 */
export async function ensureDirectThread(user: User | null): Promise<Thread | null> {
  if (!user) return null;

  const { data: existing, error: fetchErr } = await supabase
    .from('threads')
    .select('*')
    .in('title', [SHARED_THREAD_KEY, 'Farnaz', 'Maaz'])
    .order('created_at', { ascending: true })
    .limit(1);

  if (!fetchErr && existing && existing.length > 0) {
    return existing[0] as Thread;
  }

  const { data: created, error: insertErr } = await supabase
    .from('threads')
    .insert({
      title: SHARED_THREAD_KEY,
      is_hidden: false,
      burn_on_read: true,
      disappear_seconds: 60,
    })
    .select()
    .single();

  if (insertErr || !created) {
    return null;
  }

  return created as Thread;
}
