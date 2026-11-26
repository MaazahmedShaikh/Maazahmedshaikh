import React, { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface DecoyNote {
  id: string;
  title: string;
  body: string;
  date: string;
}

interface DecoyNotesScreenProps {
  onLock: () => void;
}

const INITIAL_NOTES: DecoyNote[] = [
  {
    id: '1',
    title: 'Grocery & Essentials',
    body: '• Oat milk & Greek yogurt\n• Free-range eggs (12pk)\n• Avocados & lemons\n• Sourdough bread\n• Coffee beans (medium roast)',
    date: 'Today, 11:20 AM',
  },
  {
    id: '2',
    title: 'Weekend Errands',
    body: '• Schedule car maintenance check\n• Drop dry cleaning\n• Pick up package from locker\n• Replace kitchen water filter',
    date: 'Yesterday',
  },
  {
    id: '3',
    title: 'Recipe Ideas',
    body: 'Garlic herb butter pasta with roasted cherry tomatoes and fresh basil.',
    date: 'Nov 18',
  },
];

export const DecoyNotesScreen: React.FC<DecoyNotesScreenProps> = ({ onLock }) => {
  const [notes, setNotes] = useState<DecoyNote[]>(INITIAL_NOTES);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddNote = () => {
    if (!newTitle.trim() && !newBody.trim()) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    const newNote: DecoyNote = {
      id: Date.now().toString(),
      title: newTitle.trim() || 'Quick Note',
      body: newBody.trim(),
      date: 'Just now',
    };

    setNotes([newNote, ...notes]);
    setNewTitle('');
    setNewBody('');
    setIsAdding(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="document-text-outline" size={24} color="#F5A623" />
          <Text style={styles.headerTitle}>Notes</Text>
        </View>
        <TouchableOpacity style={styles.lockButton} onPress={onLock}>
          <Ionicons name="lock-closed" size={22} color="#8E8E93" />
        </TouchableOpacity>
      </View>

      {/* Note Creation Form */}
      {isAdding ? (
        <View style={styles.addForm}>
          <TextInput
            style={styles.inputTitle}
            placeholder="Note Title"
            placeholderTextColor="#636366"
            value={newTitle}
            onChangeText={setNewTitle}
          />
          <TextInput
            style={styles.inputBody}
            placeholder="Write note..."
            placeholderTextColor="#636366"
            value={newBody}
            onChangeText={setNewBody}
            multiline
          />
          <View style={styles.formActionRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setIsAdding(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleAddNote}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Notes List */}
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.noteCard}>
            <View style={styles.noteHeader}>
              <Text style={styles.noteTitle}>{item.title}</Text>
              <Text style={styles.noteDate}>{item.date}</Text>
            </View>
            <Text style={styles.noteBody}>{item.body}</Text>
          </View>
        )}
      />

      {/* Floating Add Note Button */}
      {!isAdding ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setIsAdding(true)}
        >
          <Ionicons name="create-outline" size={26} color="#000000" />
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2C2C2E',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  lockButton: {
    padding: 6,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  noteCard: {
    backgroundColor: '#2C2C2E',
    borderRadius: 14,
    padding: 16,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  noteTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  noteDate: {
    color: '#8E8E93',
    fontSize: 12,
  },
  noteBody: {
    color: '#D1D1D6',
    fontSize: 14,
    lineHeight: 20,
  },
  addForm: {
    backgroundColor: '#2C2C2E',
    margin: 16,
    borderRadius: 14,
    padding: 14,
  },
  inputTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputBody: {
    color: '#D1D1D6',
    fontSize: 14,
    minHeight: 60,
  },
  formActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: '#8E8E93',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  saveBtnText: {
    color: '#000000',
    fontWeight: '600',
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F5A623',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
});

