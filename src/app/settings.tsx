// Settings screen – Phase 3 threshold slider (pure-JS, no native slider dependency)
import {
  LayoutChangeEvent,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemedText } from '@/components/themed-text';
import { SettingsStore } from '@/services/SettingsStore';
import {
  MATCH_COSINE_THRESHOLD,
  MODEL_SIZE_DETECT_KB,
  MODEL_SIZE_EMBED_KB,
  MODEL_SIZE_FAS_KB,
} from '@/lib/config';

// ─── Pure-JS Slider ──────────────────────────────────────────────────────────

const MIN = 0.0;
const MAX = 1.0;
const STEP = 0.01;
const THUMB_SIZE = 28;

function CustomSlider({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (v: number) => void;
}) {
  const trackRef = useRef<View>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [trackX, setTrackX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    // Measure absolute X position on screen
    trackRef.current?.measureInWindow((x) => {
      setTrackX(x);
    });
  }, []);

  const clampAndSnap = useCallback(
    (raw: number) => {
      const clamped = Math.max(MIN, Math.min(MAX, raw));
      return Math.round(clamped / STEP) * STEP;
    },
    [],
  );

  const positionToValue = useCallback(
    (pageX: number) => {
      const usable = trackWidth - THUMB_SIZE;
      if (usable <= 0) return value;
      const offset = pageX - trackX - THUMB_SIZE / 2;
      const ratio = offset / usable;
      return clampAndSnap(MIN + ratio * (MAX - MIN));
    },
    [trackWidth, trackX, value, clampAndSnap],
  );

  const fraction = (value - MIN) / (MAX - MIN);
  const thumbLeft = (trackWidth - THUMB_SIZE) * fraction;

  return (
    <View
      ref={trackRef}
      style={sliderStyles.track}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        setDragging(true);
        onValueChange(positionToValue(e.nativeEvent.pageX));
      }}
      onResponderMove={(e) => {
        if (dragging) onValueChange(positionToValue(e.nativeEvent.pageX));
      }}
      onResponderRelease={() => setDragging(false)}
      onResponderTerminate={() => setDragging(false)}
    >
      {/* Filled portion */}
      <View style={[sliderStyles.filled, { width: thumbLeft + THUMB_SIZE / 2 }]} />
      {/* Thumb */}
      <View style={[sliderStyles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  track: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    borderRadius: 6,
  },
  filled: {
    position: 'absolute',
    left: 0,
    top: 16,
    height: 8,
    backgroundColor: '#0A84FF',
    borderRadius: 4,
  },
  thumb: {
    position: 'absolute',
    top: (40 - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#0A84FF',
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [threshold, setThreshold] = useState<number>(MATCH_COSINE_THRESHOLD);
  const [livenessEnabled, setLivenessEnabled] = useState(true);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      const [saved, savedLiveness] = await Promise.all([
        SettingsStore.getThreshold(MATCH_COSINE_THRESHOLD),
        SettingsStore.getLivenessEnabled(true),
      ]);
      setThreshold(saved);
      setLivenessEnabled(savedLiveness);
    })();
  }, []);

  // Update store whenever threshold changes
  const onValueChange = useCallback((raw: number) => {
    const snapped = Math.round(raw * 100) / 100;
    setThreshold(snapped);
    SettingsStore.setThreshold(snapped);
  }, []);

  const onLivenessChange = useCallback((value: boolean) => {
    setLivenessEnabled(value);
    SettingsStore.setLivenessEnabled(value);
  }, []);

  const totalKB = MODEL_SIZE_DETECT_KB + MODEL_SIZE_EMBED_KB + MODEL_SIZE_FAS_KB;
  const fmtKB = (kb: number) => kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Settings</ThemedText>
        <ScrollView showsVerticalScrollIndicator={false}>

        <View style={styles.card}>
          <Text style={styles.label}>Similarity Threshold</Text>
          <Text style={styles.description}>
            Faces scoring above this value will PASS verification.
          </Text>

          <View style={styles.sliderRow}>
            <Text style={styles.minMax}>0.00</Text>
            <View style={styles.sliderWrap}>
              <CustomSlider value={threshold} onValueChange={onValueChange} />
            </View>
            <Text style={styles.minMax}>1.00</Text>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>Current:</Text>
            <Text style={styles.valueNumber}>{threshold.toFixed(2)}</Text>
          </View>

          {/* Quick-set buttons */}
          <View style={styles.presetsRow}>
            {[0.50, 0.60, 0.65, 0.75, 0.85].map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.presetBtn,
                  Math.abs(threshold - preset) < 0.005 && styles.presetBtnActive,
                ]}
                onPress={() => onValueChange(preset)}
              >
                <Text
                  style={[
                    styles.presetBtnText,
                    Math.abs(threshold - preset) < 0.005 && styles.presetBtnTextActive,
                  ]}
                >
                  {preset.toFixed(2)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.settingDivider} />

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.label}>Liveness Check</Text>
              <Text style={styles.description}>
                Require passive face checks and random challenges before matching.
              </Text>
            </View>
            <Switch
              value={livenessEnabled}
              onValueChange={onLivenessChange}
              trackColor={{
                false: 'rgba(255,255,255,0.18)',
                true: 'rgba(10,132,255,0.55)',
              }}
              thumbColor={livenessEnabled ? '#0A84FF' : '#F2F2F7'}
            />
          </View>
        </View>

        {/* Benchmark card */}
        <View style={[styles.card, { marginTop: 16 }]}>
          <Text style={styles.label}>Model Sizes</Text>
          <Text style={styles.description}>
            On-device storage used by TFLite models.
          </Text>
          {[
            { name: 'Face Detector',  sub: 'BlazeFace short-range',  kb: MODEL_SIZE_DETECT_KB },
            { name: 'Face Embedder',  sub: 'MobileFaceNet 192-d',    kb: MODEL_SIZE_EMBED_KB  },
            { name: 'Liveness (FAS)', sub: 'MiniFASNet v2.7 (pending)', kb: MODEL_SIZE_FAS_KB },
          ].map(row => (
            <View key={row.name} style={styles.benchRow}>
              <View style={styles.benchLeft}>
                <Text style={styles.benchName}>{row.name}</Text>
                <Text style={styles.benchSub}>{row.sub}</Text>
              </View>
              <Text style={styles.benchValue}>
                {row.kb === 0 ? '—' : fmtKB(row.kb)}
              </Text>
            </View>
          ))}
          <View style={styles.settingDivider} />
          <View style={styles.benchRow}>
            <Text style={[styles.benchName, { color: '#fff' }]}>Total</Text>
            <Text style={[styles.benchValue, { color: '#0A84FF', fontSize: 16 }]}>
              {fmtKB(totalKB)}
            </Text>
          </View>
          <Text style={[styles.description, { marginTop: 12, marginBottom: 0 }]}>
            Verification latency is shown on the result screen after each attempt and logged to the console as [Benchmark].
          </Text>
        </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safeArea: { flex: 1, padding: 24 },

  card: {
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  label: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  description: { color: '#888', fontSize: 13, marginBottom: 16 },

  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderWrap: { flex: 1 },
  minMax: { color: '#666', fontSize: 11, fontVariant: ['tabular-nums'] },

  valueRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginTop: 12,
    gap: 8,
  },
  valueLabel: { color: '#aaa', fontSize: 14 },
  valueNumber: { color: '#0A84FF', fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },

  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  presetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  presetBtnActive: { backgroundColor: '#0A84FF' },
  presetBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  presetBtnTextActive: { color: '#fff' },

  settingDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  switchCopy: { flex: 1 },

  benchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  benchLeft:  { flex: 1 },
  benchName:  { color: '#aaa', fontSize: 14, fontWeight: '600' },
  benchSub:   { color: '#555', fontSize: 12, marginTop: 1 },
  benchValue: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
