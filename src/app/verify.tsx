// Verify screen – Phase 3 implementation
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, SafeAreaView, FlatList } from 'react-native';
import { CameraWithGate } from '@/components/CameraWithGate';
import type { GateState } from '@/components/CameraWithGate';
import { useFaceEmbedder } from '@/models/useFaceEmbedder';
import { TemplateStore } from '@/services/TemplateStore';
import type { Person } from '@/services/TemplateStore';
import { SettingsStore } from '@/services/SettingsStore';
import { MATCH_COSINE_THRESHOLD } from '@/lib/config';
import { cosineSimilarity } from '@/lib/similarity';

export default function VerifyScreen() {
  // UI state
  const [gate, setGate] = useState<GateState>({ status: 'no-face', hint: '' });
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | {
    pass: boolean;
    score: number;
    threshold: number;
    personName: string;
  }>(null);

  const embedder = useFaceEmbedder();

  // Load enrolled people on mount
  useEffect(() => {
    (async () => {
      const list = await TemplateStore.listPeople();
      setPeople(list);
    })();
  }, []);

  // Gate callback
  const handleGate = useCallback((state: GateState) => {
    setGate(state);
  }, []);

  // When gate is good and a person is selected, capture and verify
  useEffect(() => {
    if (!selected) return;
    if (gate.status !== 'good') return;
    if (busy) return;

    const runVerification = async () => {
      setBusy(true);
      try {
        // Embed current face (captureIndex is irrelevant here)
        const embedding = await embedder.embed({ personId: selected.id, captureIndex: 0 });
        // Compute best cosine similarity against stored embeddings
        const stored = selected.embeddings;
        const scores = stored.map(vec => cosineSimilarity(embedding, vec));
        const best = scores.length ? Math.max(...scores) : 0;
        const threshold = await SettingsStore.getThreshold(MATCH_COSINE_THRESHOLD);
        setResult({
          pass: best >= threshold,
          score: best,
          threshold,
          personName: selected.name,
        });
      } catch (e) {
        console.warn('Verification error', e);
      } finally {
        setBusy(false);
      }
    };
    runVerification();
  }, [gate, selected, busy, embedder]);

  // Render list picker when no person selected
  const renderPicker = () => (
    <View style={styles.pickerRoot}>
      <Text style={styles.title}>Select Person to Verify</Text>
      <FlatList
        data={people}
        keyExtractor={p => p.id}
        style={styles.peopleList}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setSelected(item)} style={styles.personRow}>
            <Text style={styles.personName}>{item.name}</Text>
            <Text style={styles.personMeta}>{item.embeddings.length} sample{item.embeddings.length !== 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );

  // Result badge component
  const ResultBadge = ({ pass, score, threshold, personName }: { pass: boolean; score: number; threshold: number; personName: string }) => (
    <View style={styles.resultRoot}>
      <Text style={[styles.resultIcon, { color: pass ? '#30D158' : '#FF453A' }]}>{pass ? '✅' : '❌'}</Text>
      <Text style={styles.resultText}> {personName}</Text>
      <Text style={styles.resultDetail}>Similarity: {score.toFixed(3)}</Text>
      <Text style={styles.resultDetail}>Threshold: {threshold.toFixed(3)}</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* Camera background */}
      <CameraWithGate badge="✅ Verify" onGate={handleGate} />

      {/* Overlay UI */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {result ? (
          <ResultBadge {...result} />
        ) : selected ? (
          <View style={styles.waiting}> 
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.waitingText}>Processing…</Text>
          </View>
        ) : (
          renderPicker()
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Styles with premium glassmorphism look ───────────────────────────────────────
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
    padding: 24,
    backgroundColor: 'transparent',
  },
  pickerRoot: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '70%',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  peopleList: { maxHeight: 200 },
  personRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  personName: { color: '#fff', fontSize: 16 },
  personMeta: { color: '#aaa', fontSize: 12 },
  resultRoot: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    width: '80%',
  },
  resultIcon: { fontSize: 48, marginBottom: 12 },
  resultText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  resultDetail: { color: '#aaa', fontSize: 14, marginTop: 4 },
  waiting: { alignItems: 'center' },
  waitingText: { color: '#fff', marginTop: 8 },
});
