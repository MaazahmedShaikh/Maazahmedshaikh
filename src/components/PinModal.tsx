import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { whatsappTheme } from '../theme/whatsappTheme';

interface PinModalProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onSuccess: (pin: string) => void;
  onCancel: () => void;
  errorMessage?: string;
}

export const PinModal: React.FC<PinModalProps> = ({
  visible,
  title = 'Enter PIN',
  subtitle = 'Enter 4-digit PIN to access this chat',
  onSuccess,
  onCancel,
  errorMessage,
}) => {
  const [pin, setPin] = useState('');

  const handlePressDigit = (digit: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPin(nextPin);
      if (nextPin.length === 4) {
        setTimeout(() => {
          onSuccess(nextPin);
          setPin('');
        }, 150);
      }
    }
  };

  const handleBackspace = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClose = () => {
    setPin('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Ionicons name="lock-closed" size={24} color={whatsappTheme.accentGreen} />
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {/* 4-dot PIN indicator */}
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map((index) => {
              const isFilled = index < pin.length;
              return (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    isFilled && styles.dotFilled,
                    errorMessage ? styles.dotError : null,
                  ]}
                />
              );
            })}
          </View>

          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          {/* Keypad */}
          <View style={styles.keypad}>
            {[
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
              ['cancel', '0', 'backspace'],
            ].map((row, rIndex) => (
              <View key={rIndex} style={styles.keypadRow}>
                {row.map((btn) => {
                  if (btn === 'cancel') {
                    return (
                      <TouchableOpacity
                        key={btn}
                        style={styles.keyButton}
                        onPress={handleClose}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                    );
                  }
                  if (btn === 'backspace') {
                    return (
                      <TouchableOpacity
                        key={btn}
                        style={styles.keyButton}
                        onPress={handleBackspace}
                      >
                        <Ionicons
                          name="backspace-outline"
                          size={24}
                          color={whatsappTheme.textSecondary}
                        />
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={btn}
                      style={styles.digitButton}
                      onPress={() => handlePressDigit(btn)}
                    >
                      <Text style={styles.digitText}>{btn}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: whatsappTheme.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: whatsappTheme.bgHeader,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: whatsappTheme.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
  subtitle: {
    color: whatsappTheme.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: whatsappTheme.textSecondary,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: whatsappTheme.accentGreen,
    borderColor: whatsappTheme.accentGreen,
  },
  dotError: {
    borderColor: whatsappTheme.danger,
    backgroundColor: whatsappTheme.danger,
  },
  errorText: {
    color: whatsappTheme.danger,
    fontSize: 13,
    marginBottom: 12,
  },
  keypad: {
    width: '100%',
    marginTop: 8,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  keyButton: {
    width: 72,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitButton: {
    width: 72,
    height: 64,
    borderRadius: 32,
    backgroundColor: whatsappTheme.bgSearchFocus,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitText: {
    color: whatsappTheme.textPrimary,
    fontSize: 24,
    fontWeight: '600',
  },
  cancelText: {
    color: whatsappTheme.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});

