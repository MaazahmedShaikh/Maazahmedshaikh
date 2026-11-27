import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DuressAction,
  InactivityTimeout,
  saveStealthConfig,
  StealthConfig,
} from '../lib/stealthConfig';
import { triggerDisguisedNotification } from '../lib/notifications';
import { AppTheme, getTheme, ThemeMode, ThemePreset } from '../theme/whatsappTheme';

interface StealthSettingsModalProps {
  visible: boolean;
  config: StealthConfig;
  onSave: (updated: StealthConfig) => void;
  onClose: () => void;
}

export const StealthSettingsModal: React.FC<StealthSettingsModalProps> = ({
  visible,
  config,
  onSave,
  onClose,
}) => {
  const [vaultCode, setVaultCode] = useState(config.vaultCode);
  const [decoyNotesCode, setDecoyNotesCode] = useState(config.decoyNotesCode);
  const [hiddenSearchCode, setHiddenSearchCode] = useState(config.hiddenSearchCode);
  const [duressCode, setDuressCode] = useState(config.duressCode);
  const [duressAction, setDuressAction] = useState<DuressAction>(config.duressAction);
  const [disguisedNotifications, setDisguisedNotifications] = useState(
    config.disguisedNotifications
  );
  const [motionAutoLock, setMotionAutoLock] = useState(config.motionAutoLock);
  const [inactivityTimeoutSeconds, setInactivityTimeoutSeconds] =
    useState<InactivityTimeout>(config.inactivityTimeoutSeconds);
  const [themePreset, setThemePreset] = useState<ThemePreset>(config.themePreset || 'ice');
  const [themeMode, setThemeMode] = useState<ThemeMode>(config.themeMode || 'light');

  // Preview the chosen preset/mode live inside the settings modal
  const theme = useMemo(() => getTheme(themePreset, themeMode), [themePreset, themeMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleSave = async () => {
    const codes = [vaultCode, decoyNotesCode, duressCode];
    if (codes.some((c) => c.trim().length < 3)) {
      Alert.alert('Invalid Code', 'Each calculator code must be at least 3 digits.');
      return;
    }
    if (new Set(codes).size !== codes.length) {
      Alert.alert(
        'Duplicate Codes',
        'Vault, Decoy Notes, and Duress codes must all be different.'
      );
      return;
    }

    const updated = await saveStealthConfig({
      vaultCode,
      decoyNotesCode,
      hiddenSearchCode,
      duressCode,
      duressAction,
      disguisedNotifications,
      motionAutoLock,
      inactivityTimeoutSeconds,
      themePreset,
      themeMode,
    });
    onSave(updated);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Stealth & Appearance</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>Messenger Theme</Text>
            <View style={styles.duressRow}>
              <TouchableOpacity
                style={[styles.duressOption, themePreset === 'ice' && styles.duressOptionActive]}
                onPress={() => setThemePreset('ice')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    themePreset === 'ice' && styles.duressOptionTextActive,
                  ]}
                >
                  Blue-Violet Ice
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.duressOption,
                  themePreset === 'whatsapp' && styles.duressOptionActive,
                ]}
                onPress={() => setThemePreset('whatsapp')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    themePreset === 'whatsapp' && styles.duressOptionTextActive,
                  ]}
                >
                  WhatsApp Classic
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.duressRow, { marginTop: 8 }]}>
              <TouchableOpacity
                style={[styles.duressOption, themeMode === 'light' && styles.duressOptionActive]}
                onPress={() => setThemeMode('light')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    themeMode === 'light' && styles.duressOptionTextActive,
                  ]}
                >
                  ☀ Light Mode
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.duressOption, themeMode === 'dark' && styles.duressOptionActive]}
                onPress={() => setThemeMode('dark')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    themeMode === 'dark' && styles.duressOptionTextActive,
                  ]}
                >
                  🌙 Dark Mode
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>Calculator Access Codes (trigger with =)</Text>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Vault Unlock Code</Text>
              <TextInput
                style={styles.codeInput}
                value={vaultCode}
                onChangeText={(t) => setVaultCode(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Decoy Notes Code</Text>
              <TextInput
                style={styles.codeInput}
                value={decoyNotesCode}
                onChangeText={(t) => setDecoyNotesCode(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Duress Code (Fake Vault)</Text>
              <TextInput
                style={styles.codeInput}
                value={duressCode}
                onChangeText={(t) => setDuressCode(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Hidden Chats Search Code</Text>
              <TextInput
                style={styles.codeInput}
                value={hiddenSearchCode}
                onChangeText={(t) => setHiddenSearchCode(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

            <Text style={styles.sectionLabel}>Duress Behavior</Text>
            <View style={styles.duressRow}>
              <TouchableOpacity
                style={[
                  styles.duressOption,
                  duressAction === 'empty_vault' && styles.duressOptionActive,
                ]}
                onPress={() => setDuressAction('empty_vault')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    duressAction === 'empty_vault' && styles.duressOptionTextActive,
                  ]}
                >
                  Empty Decoy Vault
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.duressOption,
                  duressAction === 'wipe' && styles.duressOptionDanger,
                ]}
                onPress={() => setDuressAction('wipe')}
              >
                <Text
                  style={[
                    styles.duressOptionText,
                    duressAction === 'wipe' && styles.duressOptionTextActive,
                  ]}
                >
                  Silent Wipe + Empty
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>Disguised Notifications</Text>
            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabel}>Harmless Calculator Alerts</Text>
                <Text style={styles.helperText}>
                  Shows generic SmartCalc tips on new messages with zero sender or text.
                </Text>
              </View>
              <Switch
                value={disguisedNotifications}
                onValueChange={setDisguisedNotifications}
                trackColor={{ false: theme.divider, true: theme.accentGreen }}
              />
            </View>

            <View style={[styles.switchRow, { marginTop: 14 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabel}>Flip / Shake Panic Lock</Text>
                <Text style={styles.helperText}>
                  Auto-locks to calculator if held face-down for 1s or shaken hard.
                </Text>
              </View>
              <Switch
                value={motionAutoLock}
                onValueChange={setMotionAutoLock}
                trackColor={{ false: theme.divider, true: theme.accentGreen }}
              />
            </View>

            <Text style={styles.sectionLabel}>Inactivity Auto-Lock</Text>
            <View style={styles.duressRow}>
              {([30, 60, 120, 0] as InactivityTimeout[]).map((secs) => {
                const label = secs === 0 ? 'Off' : secs === 120 ? '2m' : `${secs}s`;
                const active = inactivityTimeoutSeconds === secs;
                return (
                  <TouchableOpacity
                    key={secs}
                    style={[styles.duressOption, active && styles.duressOptionActive]}
                    onPress={() => setInactivityTimeoutSeconds(secs)}
                  >
                    <Text
                      style={[
                        styles.duressOptionText,
                        active && styles.duressOptionTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.testNotifBtn}
              onPress={() => triggerDisguisedNotification()}
            >
              <Ionicons name="notifications-outline" size={16} color={theme.accentGreen} />
              <Text style={styles.testNotifText}>Send Test Disguised Alert</Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Save Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: theme.modalOverlay,
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      backgroundColor: theme.bgCard,
      borderRadius: 22,
      padding: 20,
      maxHeight: '85%',
      borderWidth: 1,
      borderColor: theme.divider,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
      elevation: 10,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    title: {
      color: theme.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    sectionLabel: {
      color: theme.accentGreen,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginTop: 14,
      marginBottom: 8,
    },
    fieldRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.divider,
    },
    fieldLabel: {
      color: theme.textPrimary,
      fontSize: 14,
      fontWeight: '500',
    },
    codeInput: {
      backgroundColor: theme.bgInputPill,
      color: theme.textPrimary,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      width: 96,
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '600',
    },
    duressRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    duressOption: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 10,
      backgroundColor: theme.bgInputPill,
      alignItems: 'center',
    },
    duressOptionActive: {
      backgroundColor: theme.accentGreen,
    },
    duressOptionDanger: {
      backgroundColor: theme.danger,
    },
    duressOptionText: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    duressOptionTextActive: {
      color: theme.textOnAccent,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    helperText: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    testNotifBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 14,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.accentGreen,
    },
    testNotifText: {
      color: theme.accentGreen,
      fontSize: 13,
      fontWeight: '600',
    },
    saveBtn: {
      backgroundColor: theme.accentGreen,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 16,
    },
    saveBtnText: {
      color: theme.textOnAccent,
      fontSize: 15,
      fontWeight: '700',
    },
  });
