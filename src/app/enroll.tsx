/**
 * Enroll screen
 *
 * State machine:
 *   name-input  → user enters a name and taps "Start"
 *   capturing   → 3 captures, gate must be green for each
 *   success     → all 3 done; show enrolled list + option to go again
 *
 * Embedding path:
 *   REAL mode  — CameraWithGate.triggerEmbedding() runs MobileFaceNet in the
 *                frame processor on the live camera frame. No photo is saved.
 *   STUB mode  — StubFaceEmbedder generates a deterministic vector from the
 *                person ID. Used when the real model is not available.
 *
 * Security invariant:
 *   No photo is ever written to disk. Only the Float32Array embedding is
 *   stored in the encrypted TemplateStore.
 */
import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CameraWithGate } from '@/components/CameraWithGate';
import type { CameraWithGateHandle, GateState } from '@/components/CameraWithGate';
import { StubFaceEmbedder } from '@/models/StubFaceEmbedder';
import { TemplateStore } from '@/services/TemplateStore';
import type { Person } from '@/services/TemplateStore';
import { ENROLL_SAMPLES } from '@/lib/config';

// ─── Constants ────────────────────────────────────────────────────────────────

const CAPTURE_PROMPTS = [
  'Look straight at the camera',
  'Turn slightly to the left',
  'Turn slightly to the right',
];

// ─── Types ────────────────────────────────────────────────────────────────────

type EnrollStep =
  | { tag: 'name-input' }
  | { tag: 'capturing'; person: Person; count: number }
  | { tag: 'success';   person: Person };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EnrollScreen() {
  const cameraRef   = useRef<CameraWithGateHandle>(null);

  const [step, setStep]           = useState<EnrollStep>({ tag: 'name-input' });
  const [nameInput, setNameInput] = useState('');
  const [gateGood, setGateGood]   = useState(false);
  const [busy, setBusy]           = useState(false);
  const [people, setPeople]       = useState<Person[]>([]);

  // ── Load enrolled people ───────────────────────────────────────────────────
  const refreshPeople = useCallback(async () => {
    const list = await TemplateStore.listPeople();
    setPeople(list);
  }, []);

  useEffect(() => { refreshPeople(); }, [refreshPeople]);

  // ── Gate callback from CameraWithGate ─────────────────────────────────────
  const handleGate = useCallback((state: GateState) => {
    setGateGood(state.status === 'good');
  }, []);

  // ── Start enrollment ───────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    const name = nameInput.trim();
    if (!name) { Alert.alert('Enter a name first'); return; }
    setBusy(true);
    try {
      const person = await TemplateStore.createPerson(name);
      setStep({ tag: 'capturing', person, count: 0 });
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setBusy(false);
    }
  }, [nameInput]);

  // ── Capture one sample ─────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (step.tag !== 'capturing') return;
    if (!gateGood) return;
    if (busy) return;

    setBusy(true);
    try {
      const { person, count } = step;

      // Try real embedding first (frame processor path), fall back to stub.
      let embedding: Float32Array | null = null;

      if (cameraRef.current?.hasRealEmbedder) {
        embedding = await cameraRef.current.triggerEmbedding();
      }

      if (!embedding) {
        // Stub fallback — generates a deterministic vector from person ID.
        embedding = await StubFaceEmbedder.embed({
          personId:     person.id,
          captureIndex: count,
        });
      }

      await TemplateStore.addEmbedding(person.id, embedding);

      const newCount = count + 1;
      if (newCount >= ENROLL_SAMPLES) {
        const updated = await TemplateStore.getPerson(person.id);
        setStep({ tag: 'success', person: updated ?? person });
        await refreshPeople();
      } else {
        setStep({ tag: 'capturing', person, count: newCount });
      }
    } catch (e) {
      Alert.alert('Capture failed', String(e));
    } finally {
      setBusy(false);
    }
  }, [step, gateGood, busy, refreshPeople]);

  // ── Delete a person ────────────────────────────────────────────────────────
  const handleDelete = useCallback((person: Person) => {
    Alert.alert(
      'Delete person',
      `Remove "${person.name}" and all their face samples?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await TemplateStore.deletePerson(person.id);
            await refreshPeople();
            // If we just deleted the currently enrolled person, reset.
            if (step.tag === 'success' && step.person.id === person.id) {
              setStep({ tag: 'name-input' });
            }
          },
        },
      ],
    );
  }, [step, refreshPeople]);

  // ── Reset to enroll another ────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setNameInput('');
    setStep({ tag: 'name-input' });
    setGateGood(false);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* ── Camera (full-screen background) ──────────────────────────────── */}
      <CameraWithGate ref={cameraRef} badge="📷 Enroll" onGate={handleGate} />

      {/* ── Enrollment panel (absolute overlay at the bottom) ────────────── */}
      <KeyboardAvoidingView
        style={styles.panelWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={styles.panel}>
          <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {step.tag === 'name-input' && (
              <NameInputPanel
                value={nameInput}
                onChangeText={setNameInput}
                onStart={handleStart}
                busy={busy}
                people={people}
                onDelete={handleDelete}
              />
            )}

            {step.tag === 'capturing' && (
              <CapturingPanel
                count={step.count}
                total={ENROLL_SAMPLES}
                prompt={CAPTURE_PROMPTS[step.count] ?? ''}
                gateGood={gateGood}
                busy={busy}
                onCapture={handleCapture}
              />
            )}

            {step.tag === 'success' && (
              <SuccessPanel
                person={step.person}
                people={people}
                onDelete={handleDelete}
                onEnrollAnother={handleReset}
              />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function NameInputPanel({
  value, onChangeText, onStart, busy, people, onDelete,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onStart: () => void;
  busy: boolean;
  people: Person[];
  onDelete: (p: Person) => void;
}) {
  return (
    <>
      <Text style={styles.panelTitle}>Enroll a person</Text>
      <TextInput
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor="#888"
        value={value}
        onChangeText={onChangeText}
        returnKeyType="done"
        autoCapitalize="words"
      />
      <TouchableOpacity
        style={[styles.primaryBtn, (!value.trim() || busy) && styles.btnDisabled]}
        onPress={onStart}
        disabled={!value.trim() || busy}
      >
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.primaryBtnText}>Start Enrollment →</Text>}
      </TouchableOpacity>

      {people.length > 0 && (
        <>
          <Text style={styles.listHeader}>Enrolled people</Text>
          <View style={styles.peopleList}>
            {people.map((item) => (
              <View key={item.id} style={styles.personRow}>
                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{item.name}</Text>
                  <Text style={styles.personMeta}>
                    {item.embeddings.length} sample{item.embeddings.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onDelete(item)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

function CapturingPanel({
  count, total, prompt, gateGood, busy, onCapture,
}: {
  count: number;
  total: number;
  prompt: string;
  gateGood: boolean;
  busy: boolean;
  onCapture: () => void;
}) {
  const canCapture = gateGood && !busy;
  return (
    <>
      {/* Progress dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < count && styles.dotFilled]}
          />
        ))}
        <Text style={styles.progressText}>{count}/{total}</Text>
      </View>

      <Text style={styles.prompt}>{prompt}</Text>
      <Text style={styles.gateHint}>
        {gateGood ? '✅ Face centred — ready to capture' : '⏳ Centre your face in the green box'}
      </Text>

      <TouchableOpacity
        style={[styles.captureBtn, !canCapture && styles.btnDisabled]}
        onPress={onCapture}
        disabled={!canCapture}
      >
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.captureBtnText}>📸  Capture {count + 1}/{total}</Text>}
      </TouchableOpacity>
    </>
  );
}

function SuccessPanel({
  person, people, onDelete, onEnrollAnother,
}: {
  person: Person;
  people: Person[];
  onDelete: (p: Person) => void;
  onEnrollAnother: () => void;
}) {
  return (
    <>
      <Text style={styles.successTitle}>✅ {person.name} enrolled!</Text>
      <Text style={styles.successSub}>
        {person.embeddings.length} face samples stored securely.
      </Text>

      {people.length > 0 && (
        <>
          <Text style={styles.listHeader}>All enrolled people</Text>
          <View style={styles.peopleList}>
            {people.map((item) => (
              <View key={item.id} style={styles.personRow}>
                <View style={styles.personInfo}>
                  <Text style={styles.personName}>{item.name}</Text>
                  <Text style={styles.personMeta}>
                    {item.embeddings.length} sample{item.embeddings.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onDelete(item)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.primaryBtn} onPress={onEnrollAnother}>
        <Text style={styles.primaryBtnText}>Enroll Another Person</Text>
      </TouchableOpacity>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(15,15,20,0.93)';

const styles = StyleSheet.create({
  root: { flex: 1 },

  panelWrap: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
  },
  panel: {
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12,
    maxHeight: '70%',
  },

  // ── Name input panel ──────────────────────────────────────────────────────
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: '#0A84FF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled:    { opacity: 0.38 },

  captureBtn: {
    backgroundColor: '#30D158',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  captureBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // ── Capturing panel ───────────────────────────────────────────────────────
  dotsRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:          { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotFilled:    { backgroundColor: '#30D158' },
  progressText: { color: '#aaa', fontSize: 13, marginLeft: 4 },

  prompt:   { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  gateHint: { color: '#aaa', fontSize: 13, textAlign: 'center' },

  // ── Success panel ─────────────────────────────────────────────────────────
  successTitle: { color: '#30D158', fontSize: 20, fontWeight: '700' },
  successSub:   { color: '#aaa', fontSize: 14 },

  // ── People list ───────────────────────────────────────────────────────────
  listHeader: { color: '#aaa', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  peopleList: { maxHeight: 140 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  personInfo: { flex: 1 },
  personName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  personMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  deleteBtn:  { paddingHorizontal: 12, paddingVertical: 6 },
  deleteBtnText: { color: '#FF453A', fontSize: 14, fontWeight: '600' },
});
