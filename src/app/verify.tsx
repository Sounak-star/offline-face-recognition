/**
 * Verify screen - Phase 4
 *
 * Flow:
 *   1. pick-person     -> user selects WHO they claim to be
 *   2. scanning        -> live camera + face gate + passive liveness
 *   3. liveness        -> randomized active challenges
 *   4. verifying       -> embedding + cosine match in progress
 *   5. result          -> PASS / FAIL badge with score + threshold
 *
 * Verification starts after the selected person passes liveness.
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
import { useFocusEffect } from 'expo-router';

import { CameraWithGate } from '@/components/CameraWithGate';
import type { GateState } from '@/components/CameraWithGate';
import { useFaceEmbedder } from '@/models/useFaceEmbedder';
import { TemplateStore } from '@/services/TemplateStore';
import type { Person } from '@/services/TemplateStore';
import { SettingsStore } from '@/services/SettingsStore';
import { HistoryStore } from '@/services/HistoryStore';
import {
  LIVENESS_CHALLENGE_COUNT,
  LIVENESS_STUB_AUTO_PASS_MS,
  MATCH_COSINE_THRESHOLD,
} from '@/lib/config';
import { cosineSimilarity } from '@/lib/similarity';
import {
  areEyesClosed,
  generateChallenges,
  isChallengeComplete,
  passiveCheck,
} from '@/lib/liveness';
import type { FaceMetrics, LivenessChallenge } from '@/lib/liveness';

// ─── Types ────────────────────────────────────────────────────────────────────

type VerifyStep =
  | { tag: 'pick-person' }
  | { tag: 'scanning'; person: Person }
  | { tag: 'liveness'; person: Person; challenges: LivenessChallenge[]; currentIndex: number }
  | { tag: 'liveness-failed'; person: Person; reason: string }
  | { tag: 'verifying'; person: Person }
  | { tag: 'result'; person: Person; pass: boolean; score: number; threshold: number };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VerifyScreen() {
  const [step, setStep] = useState<VerifyStep>({ tag: 'pick-person' });
  const [people, setPeople] = useState<Person[]>([]);
  const [gateGood, setGateGood] = useState(false);
  const [faceMetrics, setFaceMetrics] = useState<FaceMetrics>({});
  const [isStubDetector, setIsStubDetector] = useState(true);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const busyRef = useRef(false);
  const stepRef = useRef(step);
  const livenessEnabledRef = useRef(livenessEnabled);
  const gateTransitionRef = useRef(false);

  const embedder = useFaceEmbedder();

  useEffect(() => {
    stepRef.current = step;
    if (step.tag === 'scanning') gateTransitionRef.current = false;
  }, [step]);

  useEffect(() => {
    livenessEnabledRef.current = livenessEnabled;
  }, [livenessEnabled]);

  // Load enrolled people on mount
  useEffect(() => {
    (async () => {
      const list = await TemplateStore.listPeople();
      setPeople(list);
    })();
  }, []);

  // Refresh liveness setting whenever the tab is focused.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const enabled = await SettingsStore.getLivenessEnabled(true);
        if (!cancelled) setLivenessEnabled(enabled);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const startVerification = useCallback((person: Person) => {
    if (busyRef.current) return;

    busyRef.current = true;
    setStep({ tag: 'verifying', person });

    (async () => {
      try {
        // Embed the live face
        const embedding = await embedder.embed({
          personId: person.id,
          captureIndex: 0,
        });

        // Cosine similarity against each stored embedding -> take best
        const scores = person.embeddings.map((vec) =>
          cosineSimilarity(embedding, vec),
        );
        const best = scores.length ? Math.max(...scores) : 0;

        // Read persisted threshold
        const threshold = await SettingsStore.getThreshold(
          MATCH_COSINE_THRESHOLD,
        );

        const pass = best >= threshold;
        
        // Log attendance offline
        await HistoryStore.addLog({
          personId: person.id,
          personName: person.name,
          timestamp: Date.now(),
          matchScore: best,
          livenessPassed: livenessEnabledRef.current, // If they reached here, liveness passed (or was disabled)
        });

        setStep({
          tag: 'result',
          person,
          pass,
          score: best,
          threshold,
        });
      } catch (e) {
        console.warn('[Verify] error', e);
        setGateGood(false);
        setStep({ tag: 'scanning', person });
      } finally {
        busyRef.current = false;
      }
    })();
  }, [embedder]);

  const handleGate = useCallback((state: GateState) => {
    const isGood = state.status === 'good';
    const metrics: FaceMetrics = {
      eyesOpen: state.eyesOpen,
      headYaw: state.headYaw,
      smiling: state.smiling,
    };

    setGateGood(isGood);
    setFaceMetrics(metrics);
    setIsStubDetector(state.isStub ?? true);

    const currentStep = stepRef.current;
    if (currentStep.tag !== 'scanning') return;

    if (!isGood) {
      gateTransitionRef.current = false;
      return;
    }

    if (busyRef.current || gateTransitionRef.current) return;

    const person = currentStep.person;
    if (!livenessEnabledRef.current) {
      gateTransitionRef.current = true;
      startVerification(person);
      return;
    }

    if (passiveCheck(metrics) !== null) return;

    gateTransitionRef.current = true;
    setStep({
      tag: 'liveness',
      person,
      challenges: generateChallenges(LIVENESS_CHALLENGE_COUNT),
      currentIndex: 0,
    });
  }, [startVerification]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelectPerson = useCallback((person: Person) => {
    setGateGood(false);
    gateTransitionRef.current = false;
    busyRef.current = false;
    setStep({ tag: 'scanning', person });
  }, []);

  const handleTryAgain = useCallback(() => {
    if (step.tag === 'result' || step.tag === 'liveness-failed') {
      setGateGood(false);
      gateTransitionRef.current = false;
      busyRef.current = false;
      setStep({ tag: 'scanning', person: step.person });
    }
  }, [step]);

  const handleChangePerson = useCallback(() => {
    setGateGood(false);
    gateTransitionRef.current = false;
    busyRef.current = false;
    setStep({ tag: 'pick-person' });
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const scanningPassiveHint =
    livenessEnabled && gateGood ? passiveCheck(faceMetrics) : null;

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
            passiveHint={scanningPassiveHint}
            livenessEnabled={livenessEnabled}
            onChangePerson={handleChangePerson}
          />
        )}

        {step.tag === 'liveness' && (
          <LivenessPanel
            personName={step.person.name}
            challenges={step.challenges}
            currentIndex={step.currentIndex}
            faceMetrics={faceMetrics}
            isStubMode={isStubDetector}
            onChallengeComplete={() => {
              const nextIndex = step.currentIndex + 1;
              if (nextIndex >= step.challenges.length) {
                startVerification(step.person);
                return;
              }
              setStep({ ...step, currentIndex: nextIndex });
            }}
            onFail={(reason) => {
              setGateGood(false);
              setStep({ tag: 'liveness-failed', person: step.person, reason });
            }}
            onChangePerson={handleChangePerson}
          />
        )}

        {step.tag === 'liveness-failed' && (
          <LivenessFailedPanel
            personName={step.person.name}
            reason={step.reason}
            onTryAgain={handleTryAgain}
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
  passiveHint,
  livenessEnabled,
  onChangePerson,
}: {
  personName: string;
  gateGood: boolean;
  passiveHint: string | null;
  livenessEnabled: boolean;
  onChangePerson: () => void;
}) {
  const hint = !gateGood
    ? '👤 Centre your face in the green box'
    : passiveHint ?? (livenessEnabled ? 'Face ready - starting liveness...' : '✅ Face detected - capturing...');

  return (
    <View style={styles.bottomCard}>
      <Text style={styles.scanTitle}>Verifying: {personName}</Text>
      <Text style={styles.scanHint}>{hint}</Text>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onChangePerson}>
        <Text style={styles.secondaryBtnText}>← Change Person</Text>
      </TouchableOpacity>
    </View>
  );
}

function LivenessPanel({
  personName,
  challenges,
  currentIndex,
  faceMetrics,
  isStubMode,
  onChallengeComplete,
  onFail,
  onChangePerson,
}: {
  personName: string;
  challenges: LivenessChallenge[];
  currentIndex: number;
  faceMetrics: FaceMetrics;
  isStubMode: boolean;
  onChallengeComplete: () => void;
  onFail: (reason: string) => void;
  onChangePerson: () => void;
}) {
  const challenge = challenges[currentIndex];
  const durationMs = isStubMode
    ? LIVENESS_STUB_AUTO_PASS_MS
    : challenge.timeoutMs;
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const eyesWereClosedRef = useRef(false);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onChallengeComplete);
  const onFailRef = useRef(onFail);

  useEffect(() => {
    onCompleteRef.current = onChallengeComplete;
  }, [onChallengeComplete]);

  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  const completeOnce = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  const failOnce = useCallback((reason: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onFailRef.current(reason);
  }, []);

  useEffect(() => {
    completedRef.current = false;
    eyesWereClosedRef.current = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
      setRemainingMs(remaining);
      if (remaining > 0) return;

      clearInterval(timer);
      if (isStubMode) {
        completeOnce();
      } else {
        failOnce(`Timed out: ${challenge.instruction}`);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [challenge, completeOnce, durationMs, failOnce, isStubMode]);

  useEffect(() => {
    if (isStubMode) return;

    const sawEyesClosed = eyesWereClosedRef.current || areEyesClosed(faceMetrics);
    if (areEyesClosed(faceMetrics)) eyesWereClosedRef.current = true;

    if (isChallengeComplete(challenge, faceMetrics, sawEyesClosed)) {
      completeOnce();
    }
  }, [challenge, completeOnce, faceMetrics, isStubMode]);

  const remainingRatio = Math.max(0, Math.min(1, remainingMs / durationMs));

  return (
    <View style={styles.livenessRoot}>
      <Text style={styles.livenessEyebrow}>
        Challenge {currentIndex + 1} of {challenges.length}
      </Text>
      <Text style={styles.livenessPerson}>{personName}</Text>
      <Text style={styles.livenessIcon}>{challenge.icon}</Text>
      <Text style={styles.livenessInstruction}>{challenge.instruction}</Text>

      <View style={styles.timerTrack}>
        <View style={[styles.timerFill, { width: `${remainingRatio * 100}%` }]} />
      </View>

      <View style={styles.challengeDots}>
        {challenges.map((item, index) => (
          <View
            key={`${item.type}-${index}`}
            style={[
              styles.challengeDot,
              index < currentIndex && styles.challengeDotDone,
              index === currentIndex && styles.challengeDotCurrent,
            ]}
          />
        ))}
      </View>

      <TouchableOpacity style={styles.secondaryBtn} onPress={onChangePerson}>
        <Text style={styles.secondaryBtnText}>← Change Person</Text>
      </TouchableOpacity>
    </View>
  );
}

function LivenessFailedPanel({
  personName,
  reason,
  onTryAgain,
  onChangePerson,
}: {
  personName: string;
  reason: string;
  onTryAgain: () => void;
  onChangePerson: () => void;
}) {
  return (
    <View style={styles.resultRoot}>
      <View style={[styles.resultIconCircle, { backgroundColor: 'rgba(255,69,58,0.15)' }]}>
        <Text style={styles.resultIconText}>✕</Text>
      </View>
      <Text style={[styles.resultStatus, { color: '#FF453A' }]}>
        LIVENESS FAILED
      </Text>
      <Text style={styles.resultName}>{personName}</Text>
      <Text style={styles.failureReason}>{reason}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onTryAgain}>
        <Text style={styles.primaryBtnText}>Try Again</Text>
      </TouchableOpacity>
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

  // Liveness
  livenessRoot: {
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
  livenessEyebrow: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  livenessPerson: { color: '#fff', fontSize: 15, fontWeight: '600' },
  livenessIcon: { fontSize: 44, lineHeight: 52 },
  livenessInstruction: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  timerTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 4,
  },
  timerFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#0A84FF',
  },
  challengeDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  challengeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  challengeDotCurrent: { backgroundColor: '#0A84FF' },
  challengeDotDone: { backgroundColor: '#30D158' },

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
  failureReason: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
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
