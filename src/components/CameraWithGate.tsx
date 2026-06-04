/**
 * CameraWithGate
 *
 * Full-screen camera preview with a live face-presence gate overlay.
 *
 * Architecture:
 *   Frame processor (worklets-core runtime)
 *     → stubDetectFace | realDetectFace
 *     → evaluateGate
 *     → useRunOnJS ──► JS thread (throttled to ~20 fps)
 *                          → update Reanimated shared values
 *                          → Reanimated runtime renders smooth overlay at 60 fps
 *
 *   Embedding (on-demand, triggered from JS):
 *     → shouldEmbed shared value set to true
 *     → next frame: resize to 112×112, normalize, run MobileFaceNet
 *     → L2-normalize output vector
 *     → send back via useRunOnJS → resolve JS promise
 *
 * The GREEN / RED bounding box and hint text update smoothly via Reanimated
 * spring/timing animations even though detection runs at a lower rate.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Camera,
  CameraRuntimeError,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS } from 'react-native-worklets-core';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import { useFaceDetector } from '@/models/useFaceDetector';
import { useEmbedModel } from '@/models/useFaceEmbedder';
import { stubDetectFace } from '@/models/StubFaceDetector';
import { realDetectFace } from '@/models/RealFaceDetector';
import { evaluateGate } from '@/models/FaceGate';
import type { GateResult, GateStatus } from '@/models/IFaceDetector';
import {
  EMBED_INPUT_WIDTH,
  EMBED_INPUT_HEIGHT,
} from '@/lib/config';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GateState {
  status: GateStatus;
  hint:   string;
  eyesOpen?: boolean;
  headYaw?:  number;
  smiling?:  boolean;
  isStub?:   boolean;
}

export interface CameraWithGateHandle {
  /**
   * Take a photo and return its file:// path.
   * Phase 3: caller must delete the file immediately after embedding.
   * Phase 2 stub: call is not required — stub does not use pixel data.
   */
  capturePhoto: () => Promise<string | null>;

  /**
   * Trigger face embedding on the next camera frame.
   *
   * When the embed model is loaded, the frame processor will:
   *   1. Resize the frame to 112×112 RGB
   *   2. Normalize pixels to [-1, 1]
   *   3. Run MobileFaceNet
   *   4. L2-normalize the output
   *
   * Returns the embedding Float32Array, or null if no embed model is loaded
   * (caller should fall back to the stub embedder).
   */
  triggerEmbedding: () => Promise<Float32Array | null>;

  /** Whether the real embed model is loaded (vs stub fallback). */
  hasRealEmbedder: boolean;
}

export interface CameraWithGateProps {
  /** Badge text shown in the top pill (e.g. "📷 Enroll"). */
  badge: string;
  /** Called on the JS thread every time the gate status changes. */
  onGate?: (state: GateState) => void;
}

// ─── Worklet helpers ──────────────────────────────────────────────────────────

/** L2-normalize a Float32Array. Must be called in worklet context. */
function l2NormalizeWorklet(v: Float32Array): Float32Array {
  'worklet';
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm < 1e-10) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CameraWithGate = forwardRef<CameraWithGateHandle, CameraWithGateProps>(
function CameraWithGate({ badge, onGate }, ref) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const { width: W, height: H } = useWindowDimensions();

  // ── Camera position (front default — most natural for face recognition) ──────
  const [position, setPosition] = useState<'front' | 'back'>('front');
  const frontDevice = useCameraDevice('front');
  const backDevice  = useCameraDevice('back');
  const device      = position === 'front' ? (frontDevice ?? backDevice) : (backDevice ?? frontDevice);
  const canFlip     = frontDevice != null && backDevice != null;

  // Model — undefined while loading or when placeholder file fails to parse
  const { tfModel } = useFaceDetector();

  // Embed model — undefined when placeholder is present
  const { embedModel } = useEmbedModel();

  // Hold the HybridObject references in Reanimated shared values so the
  // worklet runtime can access them without copying (copying breaks NativeState).
  const tfModelRef    = useSharedValue<TfliteModel | undefined>(undefined);
  const embedModelRef = useSharedValue<TfliteModel | undefined>(undefined);
  useEffect(() => { tfModelRef.value    = tfModel;    }, [tfModel]);
  useEffect(() => { embedModelRef.value = embedModel; }, [embedModel]);

  // Resize plugin — worklet-safe function for resizing frames
  const { resize } = useResizePlugin();

  // ── Camera ref (for capturePhoto handle exposed to parent) ───────────────────
  const cameraRef = useRef<Camera>(null);

  // ── Embedding trigger mechanism ─────────────────────────────────────────────
  const shouldEmbed = useSharedValue(false);
  const embedResolveRef = useRef<((v: Float32Array | null) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    capturePhoto: async () => {
      if (!cameraRef.current) return null;
      try {
        const photo = await cameraRef.current.takePhoto({
          flash: 'off',
          enableShutterSound: false,
        });
        return photo.path;
      } catch {
        return null;
      }
    },

    triggerEmbedding: () => {
      if (!embedModel) return Promise.resolve(null);
      return new Promise<Float32Array | null>((resolve) => {
        embedResolveRef.current = resolve;
        shouldEmbed.value = true;
        // Safety timeout: if no frame arrives within 3s, resolve null
        setTimeout(() => {
          if (embedResolveRef.current === resolve) {
            embedResolveRef.current = null;
            resolve(null);
          }
        }, 3000);
      });
    },

    get hasRealEmbedder() {
      return embedModel != null;
    },
  }));

  // ── Local state ─────────────────────────────────────────────────────────────
  const [isFocused, setIsFocused]     = useState(false);
  const [cameraKey, setCameraKey]     = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hint, setHint]               = useState('Position your face in the frame');

  // ── Reanimated shared values (updated from the JS thread after the bridge) ──
  const gateProgress = useSharedValue(0); // 0 = bad (red)  1 = good (green)
  const boxL = useSharedValue(0.25);      // normalised 0-1
  const boxT = useSharedValue(0.25);
  const boxW = useSharedValue(0.50);
  const boxH = useSharedValue(0.50);

  // ── JS-thread throttle (keep Reanimated updates at ~20 fps) ─────────────────
  const lastUpdateMs = useRef(0);

  // Latest onGate ref — always calls the current prop even if closure is stale
  const onGateRef = useRef(onGate);
  onGateRef.current = onGate;

  // ── Focus ────────────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (!hasPermission) requestPermission();
      setIsFocused(true);
      setCameraError(null);
      return () => setIsFocused(false);
    }, [hasPermission, requestPermission]),
  );

  // ── Camera flip ───────────────────────────────────────────────────────────────
  const flipCamera = useCallback(() => {
    setPosition((p) => (p === 'front' ? 'back' : 'front'));
    setCameraKey((k) => k + 1); // remount camera cleanly
    setCameraError(null);
  }, []);

  // ── Camera error handling ─────────────────────────────────────────────────────
  const handleCameraError = useCallback((e: CameraRuntimeError) => {
    if (e.code === 'system/camera-is-restricted') {
      const id = setTimeout(() => {
        setCameraError(null);
        setCameraKey((k) => k + 1);
      }, 1000);
      return () => clearTimeout(id);
    }
    setCameraError(e.message);
  }, []);

  // ── Bridge: embedding result from worklet → JS thread ───────────────────────
  const onEmbeddingResult = useRunOnJS(
    (buffer: ArrayBuffer) => {
      const embedding = new Float32Array(buffer);
      const cb = embedResolveRef.current;
      embedResolveRef.current = null;
      cb?.(embedding);
    },
    [],
  );

  // ── Bridge: worklets-core → JS thread → Reanimated ──────────────────────────
  const updateFromWorklet = useRunOnJS(
    (
      status: string,
      x: number, y: number,
      w: number, h: number,
      hintMsg: string,
      eyesOpen: boolean,
      headYaw: number,
      smiling: boolean,
      isStub: boolean,
    ) => {
      const now = Date.now();
      if (now - lastUpdateMs.current < 50) return; // ~20 fps cap
      lastUpdateMs.current = now;

      const isGood = status === 'good';
      gateProgress.value = withTiming(isGood ? 1 : 0, { duration: 200 });
      boxL.value = withSpring(x, { damping: 20, stiffness: 300 });
      boxT.value = withSpring(y, { damping: 20, stiffness: 300 });
      boxW.value = withSpring(w, { damping: 20, stiffness: 300 });
      boxH.value = withSpring(h, { damping: 20, stiffness: 300 });
      setHint(hintMsg);
      onGateRef.current?.({
        status: status as GateStatus,
        hint: hintMsg,
        eyesOpen,
        headYaw,
        smiling,
        isStub,
      });
    },
    [],
  );

  // ── Frame processor (runs in worklets-core runtime) ──────────────────────────
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const model      = tfModelRef.value;
      const embedModel = embedModelRef.value;

      const result =
        model != null
          ? realDetectFace(frame, model, resize)
          : stubDetectFace(frame);

      const gate: GateResult = evaluateGate(result);
      const b = result?.box;

      updateFromWorklet(
        gate.status,
        b?.x      ?? 0.25,
        b?.y      ?? 0.25,
        b?.width  ?? 0.50,
        b?.height ?? 0.50,
        gate.hint,
        result?.eyesOpen ?? true,
        result?.headYaw  ?? 0,
        result?.smiling  ?? false,
        model == null,
      );

      // ── On-demand embedding ─────────────────────────────────────────────
      if (shouldEmbed.value && embedModel != null) {
        shouldEmbed.value = false;

        try {
          const input = resize(frame, {
            scale: { width: EMBED_INPUT_WIDTH, height: EMBED_INPUT_HEIGHT },
            pixelFormat: 'rgb',
            dataType: 'float32',
          });

          const normalized = new Float32Array(input.length);
          for (let i = 0; i < input.length; i++) {
            normalized[i] = (input[i] / 127.5) - 1.0;
          }

          const outputs = embedModel.runSync([normalized.buffer as ArrayBuffer]);
          if (outputs.length > 0) {
            const raw = new Float32Array(outputs[0] as ArrayBuffer);
            const embedding = l2NormalizeWorklet(raw);
            onEmbeddingResult(embedding.buffer as ArrayBuffer);
          }
        } catch {
          // Embedding failed — shouldEmbed is already false, JS timeout will resolve null
        }
      }
    },
    [tfModelRef, embedModelRef, resize, updateFromWorklet, shouldEmbed, onEmbeddingResult],
  );

  // ── Animated overlay styles ───────────────────────────────────────────────────
  const overlayStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      gateProgress.value, [0, 1], ['#FF453A', '#30D158'],
    );
    const bgColor = interpolateColor(
      gateProgress.value, [0, 1],
      ['rgba(255,69,58,0.12)', 'rgba(48,209,88,0.12)'],
    );
    return {
      borderColor, backgroundColor: bgColor,
      left: boxL.value * W, top: boxT.value * H,
      width: boxW.value * W, height: boxH.value * H,
    };
  });

  const hintTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(gateProgress.value, [0, 1], ['#FF453A', '#30D158']),
  }));

  // ── Permission gate ───────────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>
          Camera permission required
        </ThemedText>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <ThemedText style={styles.btnText}>Grant Permission</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>
          No camera device found
        </ThemedText>
      </View>
    );
  }

  if (cameraError) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>Camera error</ThemedText>
        <ThemedText style={[styles.centredText, styles.errorText]}>{cameraError}</ThemedText>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => { setCameraError(null); setCameraKey((k) => k + 1); }}>
          <ThemedText style={styles.btnText}>Retry</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Camera */}
      {isFocused && (
        <Camera
          ref={cameraRef}
          key={cameraKey}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused && hasPermission}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
          onError={handleCameraError}
        />
      )}

      {/* Animated gate bounding box */}
      <Animated.View style={[styles.boundingBox, overlayStyle]} pointerEvents="none" />

      {/* Top row: badge (centre) + flip button (right) */}
      <SafeAreaView style={styles.topOverlay} edges={['top']}>
        {/* spacer left so badge stays centred */}
        <View style={styles.topSpacer} />
        <View style={styles.badge}>
          <ThemedText style={styles.badgeText}>{badge}</ThemedText>
        </View>
        {canFlip ? (
          <TouchableOpacity style={styles.flipBtn} onPress={flipCamera} activeOpacity={0.7}>
            <Text style={styles.flipIcon}>🔄</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </SafeAreaView>

      {/* Bottom hint */}
      <SafeAreaView style={styles.bottomOverlay} edges={['bottom']} pointerEvents="none">
        {hint.length > 0 && (
          <View style={styles.hintBubble}>
            <Animated.Text style={[styles.hintText, hintTextStyle]}>
              {hint}
            </Animated.Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}); // end forwardRef

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  centredText: { textAlign: 'center' },
  errorText:   { fontSize: 12, color: '#FF453A', marginTop: 4 },

  btn:     { backgroundColor: '#0A84FF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '600' },

  boundingBox: {
    position: 'absolute', borderWidth: 3, borderRadius: 12,
  },

  // Top overlay: three-column row so badge stays centred
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topSpacer: { width: 44 }, // same width as flipBtn to balance the row
  badge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  flipBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIcon: { fontSize: 22 },

  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingBottom: 16,
  },
  hintBubble: {
    backgroundColor: 'rgba(0,0,0,0.60)',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20,
  },
  hintText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
