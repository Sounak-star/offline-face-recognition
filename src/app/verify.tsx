/**
 * Verify screen — Phase 3
 *
 * Flow:
 *   1. pick-person  → user selects WHO they claim to be
 *   2. scanning     → live camera + centered-face gate; waiting for gate "good"
 *   3. verifying    → gate fired "good", embedding + cosine match in progress
 *   4. result       → PASS / FAIL badge with score + threshold
 *
 * The verification only triggers ONCE when the gate transitions to "good".
 * A "Try Again" button resets back to the scanning step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraWithGate } from '@/components/CameraWithGate';
import type { GateState } from '@/components/CameraWithGate';
import { useFaceEmbedder } from '@/models/useFaceEmbedder';
import { TemplateStore } from '@/services/TemplateStore';
import type { Person } from '@/services/TemplateStore';
import { SettingsStore } from '@/services/SettingsStore';
import { MATCH_COSINE_THRESHOLD } from '@/lib/config';
import { cosineSimilarity } from '@/lib/similarity';

// ─── Types ────────────────────────────────────────────────────────────────────

type VerifyStep =
  | { tag: 'pick-person' }
  | { tag: 'scanning'; person: Person }
  | { tag: 'verifying'; person: Person }
  | { tag: 'result'; person: Person; pass: boolean; score: number; threshold: number };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VerifyScreen() {
  const [step, setStep] = useState<VerifyStep>({ tag: 'pick-person' });
  const [people, setPeople] = useState<Person[]>([]);
  const [gateGood, setGateGood] = useState(false);
  const busyRef = useRef(false);

  const embedder = useFaceEmbedder();

  // Load enrolled people on mount
  useEffect(() => {
    (async () => {
      const list = await TemplateStore.listPeople();
      setPeople(list);
    })();
  }, []);

  // Gate callback — only update the boolean flag
  const handleGate = useCallback((state: GateState) => {
    setGateGood(state.status === 'good');
  }, []);

  // When gate becomes "good" during scanning step → run verification once
  useEffect(() => {
    if (step.tag !== 'scanning') return;
    if (!gateGood) return;
    if (busyRef.current) return;

    busyRef.current = true;
    const person = step.person;
    setStep({ tag: 'verifying', person });

    (async () => {
      try {
        // Embed the live face
        const embedding = await embedder.embed({
          personId: person.id,
          captureIndex: 0,
        });

        // Cosine similarity against each stored embedding → take best
        const scores = person.embeddings.map((vec) =>
          cosineSimilarity(embedding, vec),
        );
        const best = scores.length ? Math.max(...scores) : 0;

        // Read persisted threshold
        const threshold = await SettingsStore.getThreshold(
          MATCH_COSINE_THRESHOLD,
        );

        setStep({
          tag: 'result',
          person,
          pass: best >= threshold,
          score: best,
          threshold,
        });
      } catch (e) {
        console.warn('[Verify] error', e);
        // Go back to scanning so the user can try again
        setStep({ tag: 'scanning', person });
      } finally {
        busyRef.current = false;
      }
    })();
  }, [step.tag, gateGood, embedder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelectPerson = useCallback((person: Person) => {
    setGateGood(false);
    busyRef.current = false;
    setStep({ tag: 'scanning', person });
  }, []);

  const handleTryAgain = useCallback(() => {
    if (step.tag === 'result') {
      setGateGood(false);
      busyRef.current = false;
      setStep({ tag: 'scanning', person: step.person });
    }
  }, [step]);

  const handleChangePerson = useCallback(() => {
    setGateGood(false);
    busyRef.current = false;
    setStep({ tag: 'pick-person' });
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Camera background — always visible */}
      <CameraWithGate badge="✅ Verify" onGate={handleGate} />

      {/* Overlay */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {step.tag === 'pick-person' && (
          <PickerPanel people={people} onSelect={handleSelectPerson} />
        )}

        {step.tag === 'scanning' && (
          <ScanningPanel
            personName={step.person.name}
            gateGood={gateGood}
            onChangePerson={handleChangePerson}
          />
        )}

        {step.tag === 'verifying' && (
          <View style={styles.centeredCard}>
            <ActivityIndicator size="large" color="#0A84FF" />
            <Text style={styles.processingText}>
              Verifying {step.person.name}…
            </Text>
          </View>
        )}

        {step.tag === 'result' && (
          <ResultPanel
            pass={step.pass}
            score={step.score}
            threshold={step.threshold}
            personName={step.person.name}
            onTryAgain={handleTryAgain}
            onChangePerson={handleChangePerson}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function PickerPanel({
  people,
  onSelect,
}: {
  people: Person[];
  onSelect: (p: Person) => void;
}) {
  if (people.length === 0) {
    return (
      <View style={styles.centeredCard}>
        <Text style={styles.emptyTitle}>No enrolled people</Text>
        <Text style={styles.emptySubtitle}>
          Go to the Enroll tab to add someone first.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pickerRoot}>
      <Text style={styles.pickerTitle}>Who are you?</Text>
      <Text style={styles.pickerSubtitle}>
        Select your name to start face verification
      </Text>
      <ScrollView style={styles.peopleList} showsVerticalScrollIndicator={false}>
        {people.map((person) => (
          <TouchableOpacity
            key={person.id}
            style={styles.personRow}
            onPress={() => onSelect(person)}
          >
            <View style={styles.personAvatar}>
              <Text style={styles.personAvatarText}>
                {person.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.personInfo}>
              <Text style={styles.personName}>{person.name}</Text>
              <Text style={styles.personMeta}>
                {person.embeddings.length} sample
                {person.embeddings.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function ScanningPanel({
  personName,
  gateGood,
  onChangePerson,
}: {
  personName: string;
  gateGood: boolean;
  onChangePerson: () => void;
}) {
  return (
    <View style={styles.bottomCard}>
      <Text style={styles.scanTitle}>Verifying: {personName}</Text>
      <Text style={styles.scanHint}>
        {gateGood
          ? '✅ Face detected — capturing…'
          : '👤 Centre your face in the green box'}
      </Text>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onChangePerson}>
        <Text style={styles.secondaryBtnText}>← Change Person</Text>
      </TouchableOpacity>
    </View>
  );
}

function ResultPanel({
  pass,
  score,
  threshold,
  personName,
  onTryAgain,
  onChangePerson,
}: {
  pass: boolean;
  score: number;
  threshold: number;
  personName: string;
  onTryAgain: () => void;
  onChangePerson: () => void;
}) {
  return (
    <View style={styles.resultRoot}>
      {/* Big icon */}
      <View
        style={[
          styles.resultIconCircle,
          { backgroundColor: pass ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)' },
        ]}
      >
        <Text style={styles.resultIconText}>{pass ? '✓' : '✕'}</Text>
      </View>

      {/* Status */}
      <Text style={[styles.resultStatus, { color: pass ? '#30D158' : '#FF453A' }]}>
        {pass ? 'VERIFIED' : 'NOT MATCHED'}
      </Text>

      <Text style={styles.resultName}>{personName}</Text>

      {/* Scores */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel}>Similarity</Text>
          <Text style={[styles.scoreValue, { color: pass ? '#30D158' : '#FF453A' }]}>
            {score.toFixed(3)}
          </Text>
        </View>
        <View style={styles.scoreDivider} />
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel}>Threshold</Text>
          <Text style={styles.scoreValue}>{threshold.toFixed(3)}</Text>
        </View>
      </View>

      {/* Actions */}
      <TouchableOpacity style={styles.primaryBtn} onPress={onTryAgain}>
        <Text style={styles.primaryBtnText}>Try Again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onChangePerson}>
        <Text style={styles.secondaryBtnText}>← Change Person</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(15,15,20,0.93)';

const styles = StyleSheet.create({
  root: { flex: 1 },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'transparent',
  },

  // ── Picker ──────────────────────────────────────────────────────────────────
  pickerRoot: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 20,
    width: '92%',
    maxHeight: '70%',
  },
  pickerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  pickerSubtitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 16,
  },
  peopleList: { maxHeight: 300 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  personAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  personAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  personInfo: { flex: 1 },
  personName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  personMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  chevron: { color: '#555', fontSize: 22, fontWeight: '300' },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { color: '#888', fontSize: 14, textAlign: 'center' },

  // ── Scanning ────────────────────────────────────────────────────────────────
  bottomCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  scanTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scanHint: { color: '#aaa', fontSize: 14, textAlign: 'center' },

  // ── Processing ──────────────────────────────────────────────────────────────
  centeredCard: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    width: '80%',
  },
  processingText: { color: '#fff', fontSize: 16, marginTop: 12 },

  // ── Result ──────────────────────────────────────────────────────────────────
  resultRoot: {
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    width: '88%',
    gap: 8,
  },
  resultIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  resultIconText: {
    fontSize: 44,
    fontWeight: '700',
    color: '#fff',
  },
  resultStatus: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  resultName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
    marginBottom: 8,
  },
  scoreItem: { flex: 1, alignItems: 'center' },
  scoreDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  scoreLabel: { color: '#888', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreValue: { color: '#fff', fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },

  // ── Buttons ─────────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: '#0A84FF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: { color: '#888', fontSize: 14, fontWeight: '600' },
});
