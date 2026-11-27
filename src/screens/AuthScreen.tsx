import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { AppTheme } from '../theme/whatsappTheme';
import { useAppTheme } from '../theme/ThemeContext';

interface AuthScreenProps {
  onAuthSuccess: () => void;
  onLock: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, onLock }) => {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    setLoading(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    } else {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      onAuthSuccess();
    }
  };

  return (
    <View style={styles.root}>
      {/* Top Curved Gradient Header */}
      <LinearGradient
        colors={[theme.gradientStart, theme.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        <SafeAreaView edges={['top']} style={styles.heroSafe}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onLock} style={styles.headerButton}>
              <Ionicons name="chevron-back" size={24} color={theme.headerText} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Messenger Vault</Text>
            <TouchableOpacity onPress={onLock} style={styles.headerButton}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.headerText} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Elevated Form Sheet */}
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Floating Circular Badge on Header Seam */}
          <View style={styles.floatingBadge}>
            <LinearGradient
              colors={[theme.gradientStart, theme.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.badgeInner}
            >
              <Ionicons name="shield-checkmark-outline" size={38} color={theme.headerText} />
            </LinearGradient>
          </View>

          <Text style={styles.welcomeText}>Secured Access</Text>
          <Text style={styles.instructionText}>
            Sign in with your private credentials to unlock your encrypted chats.
          </Text>

          {errorMessage ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <View style={styles.inputWrapper}>
              <Ionicons
                name="mail-outline"
                size={20}
                color={theme.accentGreen}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={theme.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View style={styles.inputWrapper}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={theme.accentGreen}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
            </View>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              style={[styles.ctaShadow, loading && styles.buttonDisabled]}
            >
              <LinearGradient
                colors={[theme.gradientStart, theme.accentGreen]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButton}
              >
                {loading ? (
                  <ActivityIndicator color={theme.textOnAccent} />
                ) : (
                  <Text style={styles.loginButtonText}>
                    {theme.preset === 'ice' ? 'START NOW' : 'Enter Vault'}
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.bgCard,
    },
    heroGradient: {
      paddingBottom: 62,
      borderBottomLeftRadius: theme.preset === 'ice' ? 30 : 0,
      borderBottomRightRadius: theme.preset === 'ice' ? 30 : 0,
    },
    heroSafe: {
      paddingTop: 4,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    headerButton: {
      padding: 8,
    },
    headerTitle: {
      color: theme.headerText,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    keyboardView: {
      flex: 1,
      marginTop: -42,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 26,
      paddingBottom: 36,
      alignItems: 'center',
    },
    floatingBadge: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor: theme.bgCard,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.35 : 0.16,
      shadowRadius: 16,
      elevation: 8,
    },
    badgeInner: {
      width: 76,
      height: 76,
      borderRadius: 38,
      justifyContent: 'center',
      alignItems: 'center',
    },
    welcomeText: {
      color: theme.textPrimary,
      fontSize: 24,
      fontWeight: '700',
      marginBottom: 8,
    },
    instructionText: {
      color: theme.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 26,
      maxWidth: 300,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.isDark ? 'rgba(248, 113, 113, 0.15)' : '#FEF2F2',
      borderWidth: 1,
      borderColor: theme.danger,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      marginBottom: 16,
      width: '100%',
      gap: 8,
    },
    errorText: {
      color: theme.danger,
      fontSize: 13,
      flex: 1,
    },
    form: {
      width: '100%',
      gap: 14,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bgInputPill,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 14,
      paddingHorizontal: 14,
      height: 54,
    },
    inputIcon: {
      marginRight: 10,
    },
    input: {
      flex: 1,
      color: theme.textPrimary,
      fontSize: 15,
    },
    ctaShadow: {
      marginTop: 10,
      borderRadius: theme.preset === 'ice' ? 27 : 14,
      shadowColor: theme.accentGreen,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 6,
    },
    loginButton: {
      height: 54,
      borderRadius: theme.preset === 'ice' ? 27 : 14,
      justifyContent: 'center',
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    loginButtonText: {
      color: theme.textOnAccent,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.8,
    },
  });
