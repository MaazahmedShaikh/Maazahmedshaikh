import React, { useState } from 'react';
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
  saveStealthConfig,
  StealthConfig,
} from '../lib/stealthConfig';
import { triggerDisguisedNotification } from '../lib/notifications';
import { whatsappTheme } from '../theme/whatsappTheme';

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
    });
    onSave(updated);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Stealth & Security</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={whatsappTheme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
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
                trackColor={{ false: '#2A3942', true: whatsappTheme.accentGreen }}
              />
            </View>

            <TouchableOpacity
              style={styles.testNotifBtn}
              onPress={() => triggerDisguisedNotification()}
            >
              <Ionicons name="notifications-outline" size={16} color={whatsappTheme.accentGreen} />
              <Text style={styles.testNotifText}>Send Test Disguised Alert</Text>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>Save Stealth Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: whatsappTheme.bgHeader,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    color: whatsappTheme.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  sectionLabel: {
    color: whatsappTheme.accentGreen,
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
    borderBottomColor: whatsappTheme.divider,
  },
  fieldLabel: {
    color: whatsappTheme.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  codeInput: {
    backgroundColor: whatsappTheme.bgPrimary,
    color: whatsappTheme.textPrimary,
    borderRadius: 8,
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
    borderRadius: 8,
    backgroundColor: whatsappTheme.bgPrimary,
    alignItems: 'center',
  },
  duressOptionActive: {
    backgroundColor: whatsappTheme.accentGreen,
  },
  duressOptionDanger: {
    backgroundColor: whatsappTheme.danger,
  },
  duressOptionText: {
    color: whatsappTheme.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  duressOptionTextActive: {
    color: '#0B141A',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  helperText: {
    color: whatsappTheme.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  testNotifBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: whatsappTheme.accentGreen,
  },
  testNotifText: {
    color: whatsappTheme.accentGreen,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: whatsappTheme.accentGreen,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#0B141A',
    fontSize: 15,
    fontWeight: '700',
  },
});
