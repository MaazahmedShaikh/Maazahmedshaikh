import React, { useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

interface CalculatorScreenProps {
  onUnlockVault: () => void;
  onOpenDecoyNotes: () => void;
  onTriggerDuress: () => void;
  vaultCode?: string;
  decoyNotesCode?: string;
  duressCode?: string;
  isLockedOut?: boolean;
}

export const CalculatorScreen: React.FC<CalculatorScreenProps> = ({
  onUnlockVault,
  onOpenDecoyNotes,
  onTriggerDuress,
  vaultCode = '7391',
  decoyNotesCode = '0000',
  duressCode = '9111',
  isLockedOut = false,
}) => {
  const [displayValue, setDisplayValue] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [keyBuffer, setKeyBuffer] = useState<string>('');
  const [expressionPreview, setExpressionPreview] = useState<string>('');

  const triggerHaptic = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  };

  const updateBufferAndCheckSecret = (token: string) => {
    const nextBuffer = (keyBuffer + token).slice(-10);
    setKeyBuffer(nextBuffer);

    // Stealth codes triggered with '='
    if (token === '=') {
      if (nextBuffer.endsWith(`${vaultCode}=`)) {
        if (!isLockedOut) {
          setDisplayValue('0');
          setPreviousValue(null);
          setOperator(null);
          setKeyBuffer('');
          setExpressionPreview('');
          onUnlockVault();
          return true;
        }
      } else if (nextBuffer.endsWith(`${duressCode}=`)) {
        setDisplayValue('0');
        setPreviousValue(null);
        setOperator(null);
        setKeyBuffer('');
        setExpressionPreview('');
        onTriggerDuress();
        return true;
      } else if (nextBuffer.endsWith(`${decoyNotesCode}=`)) {
        setDisplayValue('0');
        setPreviousValue(null);
        setOperator(null);
        setKeyBuffer('');
        setExpressionPreview('');
        onOpenDecoyNotes();
        return true;
      }
    }
    return false;
  };

  const handleDigit = (digit: string) => {
    triggerHaptic();
    updateBufferAndCheckSecret(digit);

    if (waitingForOperand) {
      setDisplayValue(digit);
      setWaitingForOperand(false);
    } else {
      setDisplayValue(displayValue === '0' ? digit : displayValue + digit);
    }
  };

  const handleDecimal = () => {
    triggerHaptic();
    updateBufferAndCheckSecret('.');

    if (waitingForOperand) {
      setDisplayValue('0.');
      setWaitingForOperand(false);
    } else if (!displayValue.includes('.')) {
      setDisplayValue(displayValue + '.');
    }
  };

  const handleClear = () => {
    triggerHaptic();
    setDisplayValue('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setExpressionPreview('');
  };

  const handleToggleSign = () => {
    triggerHaptic();
    const val = parseFloat(displayValue);
    if (!isNaN(val)) {
      setDisplayValue(String(-val));
    }
  };

  const handlePercent = () => {
    triggerHaptic();
    const val = parseFloat(displayValue);
    if (!isNaN(val)) {
      setDisplayValue(String(val / 100));
    }
  };

  const performCalculation = (op: string, prev: number, current: number): number => {
    switch (op) {
      case '+':
        return prev + current;
      case '-':
        return prev - current;
      case '×':
        return prev * current;
      case '÷':
        return current === 0 ? 0 : prev / current;
      default:
        return current;
    }
  };

  const handleOperator = (nextOp: string) => {
    triggerHaptic();
    updateBufferAndCheckSecret(nextOp);

    const inputValue = parseFloat(displayValue);

    if (previousValue === null) {
      setPreviousValue(inputValue);
      setExpressionPreview(`${inputValue} ${nextOp}`);
    } else if (operator) {
      const result = performCalculation(operator, previousValue, inputValue);
      setDisplayValue(String(result));
      setPreviousValue(result);
      setExpressionPreview(`${result} ${nextOp}`);
    }

    setWaitingForOperand(true);
    setOperator(nextOp);
  };

  const handleEqual = () => {
    triggerHaptic();
    const triggeredSecret = updateBufferAndCheckSecret('=');
    if (triggeredSecret) return;

    const inputValue = parseFloat(displayValue);

    if (operator && previousValue !== null) {
      setExpressionPreview(`${previousValue} ${operator} ${inputValue} =`);
      const result = performCalculation(operator, previousValue, inputValue);
      setDisplayValue(String(Number(result.toFixed(8))));
      setPreviousValue(null);
      setOperator(null);
      setWaitingForOperand(false);
    }
  };

  const buttons: { label: string; type: 'func' | 'op' | 'num'; onPress: () => void }[][] = [
    [
      { label: 'AC', type: 'func', onPress: handleClear },
      { label: '+/-', type: 'func', onPress: handleToggleSign },
      { label: '%', type: 'func', onPress: handlePercent },
      { label: '÷', type: 'op', onPress: () => handleOperator('÷') },
    ],
    [
      { label: '7', type: 'num', onPress: () => handleDigit('7') },
      { label: '8', type: 'num', onPress: () => handleDigit('8') },
      { label: '9', type: 'num', onPress: () => handleDigit('9') },
      { label: '×', type: 'op', onPress: () => handleOperator('×') },
    ],
    [
      { label: '4', type: 'num', onPress: () => handleDigit('4') },
      { label: '5', type: 'num', onPress: () => handleDigit('5') },
      { label: '6', type: 'num', onPress: () => handleDigit('6') },
      { label: '-', type: 'op', onPress: () => handleOperator('-') },
    ],
    [
      { label: '1', type: 'num', onPress: () => handleDigit('1') },
      { label: '2', type: 'num', onPress: () => handleDigit('2') },
      { label: '3', type: 'num', onPress: () => handleDigit('3') },
      { label: '+', type: 'op', onPress: () => handleOperator('+') },
    ],
    [
      { label: '0', type: 'num', onPress: () => handleDigit('0') },
      { label: '.', type: 'num', onPress: handleDecimal },
      { label: '=', type: 'op', onPress: handleEqual },
    ],
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Calculator Display */}
      <View style={styles.displayContainer}>
        {expressionPreview ? (
          <Text numberOfLines={1} style={styles.expressionText}>
            {expressionPreview}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.displayText}
        >
          {displayValue}
        </Text>
      </View>

      {/* Calculator Keypad */}
      <View style={styles.keypad}>
        {buttons.map((row, rIdx) => (
          <View key={rIdx} style={styles.row}>
            {row.map((btn) => {
              const isZero = btn.label === '0';
              return (
                <TouchableOpacity
                  key={btn.label}
                  activeOpacity={0.7}
                  style={[
                    styles.button,
                    isZero && styles.buttonZero,
                    btn.type === 'func' && styles.buttonFunc,
                    btn.type === 'op' && styles.buttonOp,
                    btn.type === 'num' && styles.buttonNum,
                  ]}
                  onPress={btn.onPress}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      btn.type === 'func' && styles.textFunc,
                      btn.type === 'op' && styles.textOp,
                    ]}
                  >
                    {btn.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'flex-end',
    paddingBottom: 24,
  },
  displayContainer: {
    paddingHorizontal: 28,
    paddingBottom: 24,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    minHeight: 132,
  },
  expressionText: {
    color: '#8E8E93',
    fontSize: 22,
    fontWeight: '400',
    marginBottom: 6,
    textAlign: 'right',
  },
  displayText: {
    color: '#FFFFFF',
    fontSize: 72,
    fontWeight: '300',
    textAlign: 'right',
  },
  keypad: {
    paddingHorizontal: 16,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  button: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonZero: {
    flex: 2,
    alignItems: 'flex-start',
    paddingLeft: 30,
    width: undefined,
  },
  buttonNum: {
    backgroundColor: '#333333',
  },
  buttonFunc: {
    backgroundColor: '#A5A5A5',
  },
  buttonOp: {
    backgroundColor: '#FF9F0A',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '400',
  },
  textFunc: {
    color: '#000000',
  },
  textOp: {
    color: '#FFFFFF',
  },
});

