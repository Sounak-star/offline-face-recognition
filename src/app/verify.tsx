/**
 * Verify screen — Phase 4
 *
 * Flow:
 *   1. pick-person  → user selects who they claim to be
 *   2. scanning     → live gate + passive eye/head check
 *   3. liveness     → randomized active challenges (blink / turn / smile)
 *   4. verifying    → passive MiniFAS check + embedding + cosine match
 *   5. result       → PASS / FAIL with per-check breakdown
 *
 * DEBUG_CHALLENGES=true in config.ts shows on-screen simulate buttons so the
 * full liveness sequence can be walked without a real face-detector model.
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
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';

import { CameraWithGate } from '@/components/CameraWithGate';
import type { CameraWithGateHandle, GateState } from '@/components/CameraWithGate';
import { StubFaceEmbedder } from '@/models/StubFaceEmbedder';
import { useLivenessDetector } from '@/models/useLivenessDetector';
import type { ILivenessDetector } from '@/models/ILivenessDetector';
import type { LivenessLabel } from '@/models/ILivenessDetector';
import { TemplateStore } from '@/services/TemplateStore';
import type { Person } from '@/services/TemplateStore';
import { SettingsStore } from '@/services/SettingsStore';
import { HistoryStore } from '@/services/HistoryStore';
import {
  DEBUG_CHALLENGES,
  LIVENESS_CHALLENGE_COUNT,
  LIVENESS_STUB_AUTO_PASS_MS,
  LIVENESS_YAW_MAX_DEG,
  MATCH_COSINE_THRESHOLD,
} from '@/lib/config';
import { cosineSimilarity } from '@/lib/similarity';
import {
  areEyesClosed,
  generateChallenges,
  isChallengeComplete,
  passiveCheck,
} from '@/lib/liveness';
import type { ChallengeType, FaceMetrics, LivenessChallenge } from '@/lib/liveness';

// ─── Types ────────────────────────────────────────────────────────────────────

type VerifyTiming = {
  fasMs: number;
  embedMs: number;
  matchMs: number;
  totalMs: number;
};

type VerifyStep =
  | { tag: 'pick-person' }
  | { tag: 'scanning';      person: Person }
  | { tag: 'liveness';      person: Person; challenges: LivenessChallenge[]; currentIndex: number }
  | { tag: 'liveness-failed'; person: Person; reason: string }
  | { tag: 'verifying';     person: Person }
  | {
      tag: 'result';
      person: Person;
      pass: boolean;
      score: number;
      threshold: number;
      livenessLabel: LivenessLabel;
      livenessEnabled: boolean;
      activeChallengesPassed: boolean;
      timing: VerifyTiming;
      isStubEmbed: boolean;  // true = personId-seeded stub, not real pixels
    };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VerifyScreen() {
  const cameraRef = useRef<CameraWithGateHandle>(null);
  const [step, setStep]                   = useState<VerifyStep>({ tag: 'pick-person' });
  const [people, setPeople]               = useState<Person[]>([]);
  const [gateGood, setGateGood]           = useState(false);
  const [faceMetrics, setFaceMetrics]     = useState<FaceMetrics>({});
  const [isStubDetector, setIsStubDetector] = useState(true);
  const [livenessEnabled, setLivenessEnabled] = useState(true);

  const busyRef             = useRef(false);
  const stepRef             = useRef(step);
  const livenessEnabledRef  = useRef(livenessEnabled);
  const gateTransitionRef   = useRef(false);
  // Mirrors gateGood state but readable inside callbacks without stale closure
  const gateGoodRef         = useRef(false);

  // Liveness detector (stub until real MiniFASNet model is present)
  const livenessDetector    = useLivenessDetector();
  const livenessDetectorRef = useRef<ILivenessDetector>(livenessDetector);

  useEffect(() => { livenessDetectorRef.current = livenessDetector; }, [livenessDetector]);
  useEffect(() => { stepRef.current = step; if (step.tag === 'scanning') gateTransitionRef.current = false; }, [step]);
  useEffect(() => { livenessEnabledRef.current = livenessEnabled; }, [livenessEnabled]);

  useEffect(() => {
    (async () => { setPeople(await TemplateStore.listPeople()); })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const enabled = await SettingsStore.getLivenessEnabled(true);
        if (!cancelled) setLivenessEnabled(enabled);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  // ── Verification (called after all liveness gates pass) ──────────────────────

  const startVerification = useCallback((
    person: Person,
    activeChallengesPassed: boolean,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStep({ tag: 'verifying', person });

    (async () => {
      try {
        const tStart = Date.now();
        const usingRealEmbedder = cameraRef.current?.hasRealEmbedder ?? false;

        console.log(
          `[Verify] ── starting verification for "${person.name}" ──` +
          `\n  embedder : ${usingRealEmbedder ? 'REAL MobileFaceNet' : 'STUB (personId-seeded, ignores camera)'}` +
          `\n  detector : STUB (BlazeFace disabled — worklet boundary fix)` +
          `\n  gateGood : ${gateGoodRef.current}`,
        );

        // ── HARD no-face block ────────────────────────────────────────────
        // Gate must be good at the moment embedding runs. With real BlazeFace
        // this catches empty frames. With stub detector gate is always good
        // (stub always reports a centred face), so this guard is a no-op on
        // stubs but will work correctly once the real model is loaded.
        if (!gateGoodRef.current) {
          console.warn('[Verify] BLOCKED — gate not good at embed time (no face detected)');
          setStep({ tag: 'liveness-failed', person, reason: 'No face detected — centre your face and try again' });
          busyRef.current = false;
          return;
        }

        // ── Passive MiniFAS check ─────────────────────────────────────────
        let livenessLabel: LivenessLabel = 'live';

        if (livenessEnabledRef.current) {
          const photoUri = await cameraRef.current?.capturePhoto() ?? null;
          if (photoUri) {
            try {
              const fasResult = await livenessDetectorRef.current.score(photoUri);
              livenessLabel = fasResult.label;
            } finally {
              FileSystem.deleteAsync(photoUri, { idempotent: true }).catch(() => {});
            }
          }
        }

        const tAfterFas = Date.now();

        if (livenessEnabledRef.current && livenessLabel !== 'live') {
          const threshold = await SettingsStore.getThreshold(MATCH_COSINE_THRESHOLD);
          const deviceId = Device.modelName ?? Device.deviceName ?? 'UNKNOWN_DEVICE';
          const timing: VerifyTiming = { fasMs: tAfterFas - tStart, embedMs: 0, matchMs: 0, totalMs: tAfterFas - tStart };
          console.log(`[Benchmark] Spoof detected (${livenessLabel}). FAS: ${timing.fasMs}ms`);
          await HistoryStore.addLog({ personId: person.id, personName: person.name, timestamp: Date.now(), matchScore: 0, livenessPassed: false, deviceId });
          setStep({ tag: 'result', person, pass: false, score: 0, threshold, livenessLabel, livenessEnabled: true, activeChallengesPassed, timing, isStubEmbed: !usingRealEmbedder });
          busyRef.current = false;
          return;
        }

        // ── Face embedding ────────────────────────────────────────────────
        let embedding: Float32Array | null = null;
        if (usingRealEmbedder) {
          embedding = await cameraRef.current!.triggerEmbedding();
        }
        if (!embedding) {
          // ⚠ STUB PATH — embedding derived from personId, NOT from camera pixels.
          // This means ANY frame (blank, wall, wrong person) will produce the same
          // vector as the enrolled template → cosine ≈ 0.997 → ALWAYS PASSES.
          // This is expected stub behaviour; it cannot be fixed without real models.
          embedding = await StubFaceEmbedder.embed({ personId: person.id, captureIndex: 0 });
        }

        const tAfterEmbed = Date.now();

        // Diagnostic: log first 5 embedding values so we can confirm they change
        // between inputs (they will with real model; they won't with stub).
        console.log(
          `[Embed diagnostic] first 5 values: [${Array.from(embedding.slice(0, 5)).map(v => v.toFixed(4)).join(', ')}]` +
          ` | source: ${usingRealEmbedder ? 'REAL pixels' : 'STUB — same every call for this personId'}`,
        );

        // ── Cosine match ──────────────────────────────────────────────────
        const scores = person.embeddings.map(vec => cosineSimilarity(embedding!, vec));
        const best = scores.length ? Math.max(...scores) : 0;
        const threshold = await SettingsStore.getThreshold(MATCH_COSINE_THRESHOLD);
        const pass = best >= threshold;

        const tAfterMatch = Date.now();
        const timing: VerifyTiming = {
          fasMs:   tAfterFas   - tStart,
          embedMs: tAfterEmbed - tAfterFas,
          matchMs: tAfterMatch - tAfterEmbed,
          totalMs: tAfterMatch - tStart,
        };

        console.log(
          `[Benchmark] Verify: ${timing.totalMs}ms total` +
          ` | FAS: ${timing.fasMs}ms | Embed: ${timing.embedMs}ms | Match: ${timing.matchMs}ms` +
          `\n  Score: ${best.toFixed(4)} vs threshold ${threshold.toFixed(2)} → ${pass ? 'PASS' : 'FAIL'}` +
          (usingRealEmbedder ? '' : '\n  ⚠ STUB EMBED — score is meaningless, see above'),
        );

        // ── Log attendance ────────────────────────────────────────────────
        const deviceId = Device.modelName ?? Device.deviceName ?? 'UNKNOWN_DEVICE';
        await HistoryStore.addLog({
          personId: person.id, personName: person.name, timestamp: Date.now(),
          matchScore: best,
          livenessPassed: !livenessEnabledRef.current || (livenessLabel === 'live' && activeChallengesPassed),
          deviceId,
        });

        setStep({ tag: 'result', person, pass, score: best, threshold, livenessLabel, livenessEnabled: livenessEnabledRef.current, activeChallengesPassed, timing, isStubEmbed: !usingRealEmbedder });
      } catch (e) {
        console.warn('[Verify] error', e);
        setGateGood(false);
        setStep({ tag: 'scanning', person });
      } finally {
        busyRef.current = false;
      }
    })();
  }, []);

  // ── Gate callback (called from CameraWithGate frame processor) ───────────────

  const handleGate = useCallback((state: GateState) => {
    const isGood = state.status === 'good';
    const metrics: FaceMetrics = {
      eyesOpen: state.eyesOpen,
      headYaw:  state.headYaw,
      smiling:  state.smiling,
    };

    setGateGood(isGood);
    gateGoodRef.current = isGood;
    setFaceMetrics(metrics);
    setIsStubDetector(state.isStub ?? true);

    const currentStep = stepRef.current;
    if (currentStep.tag !== 'scanning') return;
    if (!isGood) { gateTransitionRef.current = false; return; }
    if (busyRef.current || gateTransitionRef.current) return;

    const person = currentStep.person;

    if (!livenessEnabledRef.current) {
      gateTransitionRef.current = true;
      startVerification(person, false);
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

  // ── Navigation handlers ───────────────────────────────────────────────────────

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

  // ─── Render ──────────────────────────────────────────────────────────────────

  const scanningPassiveHint =
    livenessEnabled && gateGood ? passiveCheck(faceMetrics) : null;

  return (
    <View style={styles.root}>
      <CameraWithGate ref={cameraRef} badge="✅ Verify" onGate={handleGate} />

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
                startVerification(step.person, true);
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
            <Text style={styles.processingText}>Verifying {step.person.name}…</Text>
          </View>
        )}

        {step.tag === 'result' && (
          <ResultPanel
            pass={step.pass}
            score={step.score}
            threshold={step.threshold}
            personName={step.person.name}
            livenessLabel={step.livenessLabel}
            livenessEnabled={step.livenessEnabled}
            activeChallengesPassed={step.activeChallengesPassed}
            timing={step.timing}
            isStubEmbed={step.isStubEmbed}
            onTryAgain={handleTryAgain}
            onChangePerson={handleChangePerson}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function PickerPanel({ people, onSelect }: { people: Person[]; onSelect: (p: Person) => void }) {
  if (people.length === 0) {
    return (
      <View style={styles.centeredCard}>
        <Text style={styles.emptyTitle}>No enrolled people</Text>
        <Text style={styles.emptySubtitle}>Go to the Enroll tab to add someone first.</Text>
      </View>
    );
  }
  return (
    <View style={styles.pickerRoot}>
      <Text style={styles.pickerTitle}>Who are you?</Text>
      <Text style={styles.pickerSubtitle}>Select your name to start face verification</Text>
      <ScrollView style={styles.peopleList} showsVerticalScrollIndicator={false}>
        {people.map((person) => (
          <TouchableOpacity key={person.id} style={styles.personRow} onPress={() => onSelect(person)}>
            <View style={styles.personAvatar}>
              <Text style={styles.personAvatarText}>{person.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.personInfo}>
              <Text style={styles.personName}>{person.name}</Text>
              <Text style={styles.personMeta}>{person.embeddings.length} sample{person.embeddings.length !== 1 ? 's' : ''}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function ScanningPanel({
  personName, gateGood, passiveHint, livenessEnabled, onChangePerson,
}: {
  personName: string; gateGood: boolean; passiveHint: string | null;
  livenessEnabled: boolean; onChangePerson: () => void;
}) {
  const hint = !gateGood
    ? '👤 Centre your face in the green box'
    : passiveHint ?? (livenessEnabled ? 'Face ready — starting liveness…' : '✅ Face detected — capturing…');
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
  personName, challenges, currentIndex, faceMetrics, isStubMode,
  onChallengeComplete, onFail, onChangePerson,
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
  const durationMs = isStubMode ? LIVENESS_STUB_AUTO_PASS_MS : challenge.timeoutMs;
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const [simAction, setSimAction]     = useState<ChallengeType | null>(null);

  const eyesWereClosedRef = useRef(false);
  const completedRef      = useRef(false);
  const onCompleteRef     = useRef(onChallengeComplete);
  const onFailRef         = useRef(onFail);

  useEffect(() => { onCompleteRef.current = onChallengeComplete; }, [onChallengeComplete]);
  useEffect(() => { onFailRef.current = onFail; }, [onFail]);

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

  // Reset state when challenge changes
  useEffect(() => {
    completedRef.current      = false;
    eyesWereClosedRef.current = false;
    setSimAction(null);

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
      setRemainingMs(remaining);
      if (remaining > 0) return;
      clearInterval(timer);
      if (isStubMode) { completeOnce(); } else { failOnce(`Timed out: ${challenge.instruction}`); }
    }, 50);

    return () => clearInterval(timer);
  }, [challenge, completeOnce, durationMs, failOnce, isStubMode]);

  // Check real face signals
  useEffect(() => {
    if (isStubMode) return;
    if (areEyesClosed(faceMetrics)) eyesWereClosedRef.current = true;
    if (isChallengeComplete(challenge, faceMetrics, eyesWereClosedRef.current)) completeOnce();
  }, [challenge, completeOnce, faceMetrics, isStubMode]);

  // Handle debug simulate actions
  useEffect(() => {
    if (!simAction) return;
    setSimAction(null);

    if (simAction === 'blink') eyesWereClosedRef.current = true;

    const fake: FaceMetrics = {
      eyesOpen: simAction === 'blink' ? true : true,
      headYaw:  simAction === 'turn-left'  ? -(LIVENESS_YAW_MAX_DEG + 5)
               : simAction === 'turn-right' ?  (LIVENESS_YAW_MAX_DEG + 5)
               : 0,
      smiling: simAction === 'smile',
    };

    if (isChallengeComplete(challenge, fake, eyesWereClosedRef.current)) completeOnce();
  }, [simAction, challenge, completeOnce]);

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
              index < currentIndex  && styles.challengeDotDone,
              index === currentIndex && styles.challengeDotCurrent,
            ]}
          />
        ))}
      </View>

      {/* DEV-ONLY simulate buttons — hidden in production (DEBUG_CHALLENGES=false) */}
      {DEBUG_CHALLENGES && !isStubMode && (
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Simulate:</Text>
          {(['blink', 'turn-left', 'turn-right', 'smile'] as ChallengeType[]).map(action => (
            <TouchableOpacity
              key={action}
              style={[styles.debugBtn, action === challenge.type && styles.debugBtnActive]}
              onPress={() => setSimAction(action)}
            >
              <Text style={styles.debugBtnText}>
                {action === 'blink'       ? '👁 Blink'
                : action === 'turn-left'  ? '👈 Left'
                : action === 'turn-right' ? '👉 Right'
                :                          '😊 Smile'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.secondaryBtn} onPress={onChangePerson}>
        <Text style={styles.secondaryBtnText}>← Change Person</Text>
      </TouchableOpacity>
    </View>
  );
}

function LivenessFailedPanel({
  personName, reason, onTryAgain, onChangePerson,
}: {
  personName: string; reason: string;
  onTryAgain: () => void; onChangePerson: () => void;
}) {
  return (
    <View style={styles.resultRoot}>
      <View style={[styles.resultIconCircle, { backgroundColor: 'rgba(255,69,58,0.15)' }]}>
        <Text style={styles.resultIconText}>✕</Text>
      </View>
      <Text style={[styles.resultStatus, { color: '#FF453A' }]}>LIVENESS FAILED</Text>
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
  pass, score, threshold, personName,
  livenessLabel, livenessEnabled, activeChallengesPassed, timing, isStubEmbed,
  onTryAgain, onChangePerson,
}: {
  pass: boolean;
  score: number;
  threshold: number;
  personName: string;
  livenessLabel: LivenessLabel;
  livenessEnabled: boolean;
  activeChallengesPassed: boolean;
  timing: VerifyTiming;
  isStubEmbed: boolean;
  onTryAgain: () => void;
  onChangePerson: () => void;
}) {
  const fasOk      = livenessLabel === 'live';
  const matchOk    = score >= threshold;

  const rows: { label: string; ok: boolean | null; detail: string }[] = [
    livenessEnabled
      ? {
          label:  'Passive (MiniFAS)',
          ok:     fasOk,
          detail: fasOk ? 'Live' : `Spoof: ${livenessLabel}`,
        }
      : { label: 'Passive (MiniFAS)', ok: null, detail: 'Disabled' },
    livenessEnabled
      ? {
          label:  'Active challenge',
          ok:     activeChallengesPassed,
          detail: activeChallengesPassed ? 'Passed' : 'Failed',
        }
      : { label: 'Active challenge', ok: null, detail: 'Disabled' },
    {
      label:  'Face match',
      ok:     matchOk,
      detail: `${score.toFixed(3)} ${matchOk ? '≥' : '<'} ${threshold.toFixed(3)}`,
    },
  ];

  return (
    <View style={styles.resultRoot}>
      {/* ⚠ Stub mode warning — shown whenever real MobileFaceNet is not running */}
      {isStubEmbed && (
        <View style={styles.stubBanner}>
          <Text style={styles.stubBannerText}>
            ⚠ STUB MODE — score is meaningless{'\n'}
            Real models not loaded. Any frame matches.
          </Text>
        </View>
      )}

      <View style={[styles.resultIconCircle, { backgroundColor: pass ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)' }]}>
        <Text style={styles.resultIconText}>{pass ? '✓' : '✕'}</Text>
      </View>

      <Text style={[styles.resultStatus, { color: pass ? '#30D158' : '#FF453A' }]}>
        {pass ? 'VERIFIED' : livenessLabel !== 'live' ? 'SPOOF DETECTED' : 'NOT MATCHED'}
      </Text>
      <Text style={styles.resultName}>{personName}</Text>

      {/* Per-check breakdown */}
      <View style={styles.checksBox}>
        {rows.map(row => (
          <View key={row.label} style={styles.checkRow}>
            <Text style={styles.checkIcon}>
              {row.ok === null ? '—' : row.ok ? '✓' : '✗'}
            </Text>
            <View style={styles.checkText}>
              <Text style={styles.checkLabel}>{row.label}</Text>
              <Text style={[styles.checkDetail, {
                color: row.ok === null ? '#555'
                     : row.ok         ? '#30D158'
                     :                  '#FF453A',
              }]}>{row.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Latency readout */}
      <View style={styles.timingBox}>
        <Text style={styles.timingTotal}>{timing.totalMs} ms</Text>
        <Text style={styles.timingBreakdown}>
          FAS {timing.fasMs}ms · Embed {timing.embedMs}ms · Match {timing.matchMs}ms
        </Text>
      </View>

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
  root:    { flex: 1 },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    padding: 20, backgroundColor: 'transparent',
  },

  // ── Picker ─────────────────────────────────────────────────────────────────
  pickerRoot:    { backgroundColor: PANEL_BG, borderRadius: 20, padding: 20, width: '92%', maxHeight: '70%' },
  pickerTitle:   { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  pickerSubtitle:{ color: '#888', fontSize: 13, marginBottom: 16 },
  peopleList:    { maxHeight: 300 },
  personRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  personAvatar:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0A84FF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  personAvatarText:{ color: '#fff', fontSize: 18, fontWeight: '700' },
  personInfo:      { flex: 1 },
  personName:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  personMeta:      { color: '#888', fontSize: 12, marginTop: 2 },
  chevron:         { color: '#555', fontSize: 22, fontWeight: '300' },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyTitle:   { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySubtitle:{ color: '#888', fontSize: 14, textAlign: 'center' },

  // ── Scanning ───────────────────────────────────────────────────────────────
  bottomCard: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    backgroundColor: PANEL_BG, borderRadius: 20, padding: 20,
    alignItems: 'center', gap: 10,
  },
  scanTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scanHint:  { color: '#aaa', fontSize: 14, textAlign: 'center' },

  // ── Liveness ───────────────────────────────────────────────────────────────
  livenessRoot: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    backgroundColor: PANEL_BG, borderRadius: 20, padding: 20,
    alignItems: 'center', gap: 10,
  },
  livenessEyebrow:    { color: '#8E8E93', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  livenessPerson:     { color: '#fff', fontSize: 15, fontWeight: '600' },
  livenessIcon:       { fontSize: 44, lineHeight: 52 },
  livenessInstruction:{ color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },

  timerTrack: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 4 },
  timerFill:  { height: '100%', borderRadius: 4, backgroundColor: '#0A84FF' },

  challengeDots:      { flexDirection: 'row', gap: 8, marginTop: 4 },
  challengeDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  challengeDotCurrent:{ backgroundColor: '#0A84FF' },
  challengeDotDone:   { backgroundColor: '#30D158' },

  // Debug simulate row
  debugRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' },
  debugLabel:    { color: '#FF9F0A', fontSize: 11, fontWeight: '700' },
  debugBtn:      { backgroundColor: 'rgba(255,159,10,0.12)', borderWidth: 1, borderColor: 'rgba(255,159,10,0.3)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  debugBtnActive:{ backgroundColor: 'rgba(255,159,10,0.30)', borderColor: '#FF9F0A' },
  debugBtnText:  { color: '#FF9F0A', fontSize: 12, fontWeight: '600' },

  // ── Processing ─────────────────────────────────────────────────────────────
  centeredCard:   { backgroundColor: PANEL_BG, borderRadius: 20, padding: 30, alignItems: 'center', width: '80%' },
  processingText: { color: '#fff', fontSize: 16, marginTop: 12 },

  // ── Result ─────────────────────────────────────────────────────────────────
  resultRoot: { backgroundColor: PANEL_BG, borderRadius: 24, padding: 28, alignItems: 'center', width: '88%', gap: 8 },
  resultIconCircle:{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  resultIconText:  { fontSize: 44, fontWeight: '700', color: '#fff' },
  resultStatus:    { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  resultName:      { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  failureReason:   { color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 8 },

  // Per-check breakdown
  checksBox: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14,
    marginBottom: 4, gap: 6,
  },
  checkRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkIcon:  { width: 18, fontSize: 14, fontWeight: '700', color: '#fff', textAlign: 'center' },
  checkText:  { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkLabel: { color: '#888', fontSize: 13 },
  checkDetail:{ fontSize: 13, fontWeight: '600' },

  // Stub mode warning
  stubBanner: {
    width: '100%', backgroundColor: 'rgba(255,159,10,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,159,10,0.5)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  stubBannerText: { color: '#FF9F0A', fontSize: 12, fontWeight: '700', textAlign: 'center' },

  // Latency readout
  timingBox: {
    width: '100%', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14,
  },
  timingTotal:     { color: '#fff', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timingBreakdown: { color: '#555', fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },

  // ── Buttons ────────────────────────────────────────────────────────────────
  primaryBtn:     { backgroundColor: '#0A84FF', borderRadius: 14, paddingVertical: 14, alignItems: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn:    { paddingVertical: 8, alignItems: 'center', width: '100%' },
  secondaryBtnText:{ color: '#888', fontSize: 14, fontWeight: '600' },
});
