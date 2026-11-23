import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://npdyfmqjhijnvnhwzvcp.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZHlmbXFqaGlqbnZuaHd6dmNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MTgzMTgsImV4cCI6MjExMDk5NDMxOH0.Zd4Nsit7vVLu5si3rWp_EqdUSXZv05fkgwEMRZFnO_k';

export const supabase: SupabaseClient<any, 'public', any> & { auth: any } = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
}) as any;
