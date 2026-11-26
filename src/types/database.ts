export interface User {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  created_at?: string;
}

export interface Thread {
  id: string;
  title: string;
  is_hidden: boolean;
  pin_hash: string | null;
  disappear_seconds: number;
  burn_on_read: boolean;
  created_at: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string; // Plaintext content in React state memory
  read_at: string | null;
  expires_at: string;
  created_at: string;
}

export type RootScreen = 'calculator' | 'decoy_notes' | 'auth' | 'vault_list' | 'chat' | 'duress_vault';
