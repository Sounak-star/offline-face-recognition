/**
 * CameraWithGate
 *
 * Architecture (revised to fix Nitro HybridObject cross-runtime crash):
 *
 *   Frame processor (worklets-core runtime) — NO native models here
 *     → stubDetectFace (pure JS, worklet-safe)
 *     → evaluateGate
 *     → useRunOnJS ──► JS thread (~20 fps throttle)
 *                          → update Reanimated shared values → 60 fps overlay
 *
 *   Embedding (on-demand):
 *     JS sets shouldEmbed = true
 *     → next frame: resize 112×112 in worklet (Frame-only API)
 *     → useRunOnJS sends raw pixel buffer to JS thread
 *     → JS thread: normalize + embedModel.runSync() + L2-norm
 *     → resolve Promise<Float32Array>
 *
 * Why models are NOT in the frame processor:
 *   react-native-fast-tflite v3 uses Nitro HybridObjects. The frame processor
 *   runs in the worklets-core JS runtime; Reanimated shared values live in
 *   Reanimated's separate runtime. HybridObjects cannot cross this boundary —
 *   the copy loses its C++ NativeState and every property access throws.
 *   Keeping model.runSync() on the main JS thread avoids the boundary entirely.
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
import { useEmbedModel } from '@/models/useFaceEmbedder';
import { stubDetectFace } from '@/models/StubFaceDetector';
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
  capturePhoto:    () => Promise<string | null>;
  triggerEmbedding:() => Promise<Float32Array | null>;
  hasRealEmbedder: boolean;
}

export interface CameraWithGateProps {
  badge:   string;
  onGate?: (state: GateState) => void;
}

// ─── JS-thread helpers ────────────────────────────────────────────────────────

function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm < 1e-10) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CameraWithGate = forwardRef<CameraWithGateHandle, CameraWithGateProps>(
function CameraWithGate({ badge, onGate }, ref) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const { width: W, height: H } = useWindowDimensions();

  const [position, setPosition] = useState<'front' | 'back'>('front');
  const frontDevice = useCameraDevice('front');
  const backDevice  = useCameraDevice('back');
  const device      = position === 'front' ? (frontDevice ?? backDevice) : (backDevice ?? frontDevice);
  const canFlip     = frontDevice != null && backDevice != null;

  // Embed model on JS thread — accessed only here, never passed to the worklet
  const { embedModel } = useEmbedModel();
  const embedModelRef  = useRef(embedModel);
  useEffect(() => { embedModelRef.current = embedModel; }, [embedModel]);

  const { resize } = useResizePlugin();
  const cameraRef   = useRef<Camera>(null);

  // ── Embedding trigger ──────────────────────────────────────────────────────
  const shouldEmbed     = useSharedValue(false);
  const embedResolveRef = useRef<((v: Float32Array | null) => void) | null>(null);

  useImperativeHandle(ref, () => ({
    capturePhoto: async () => {
      if (!cameraRef.current) return null;
      try {
        const photo = await cameraRef.current.takePhoto({ flash: 'off', enableShutterSound: false });
        return photo.path;
      } catch { return null; }
    },

    triggerEmbedding: () => {
      if (!embedModelRef.current) return Promise.resolve(null);
      return new Promise<Float32Array | null>((resolve) => {
        embedResolveRef.current = resolve;
        shouldEmbed.value = true;
        setTimeout(() => {
          if (embedResolveRef.current === resolve) {
            embedResolveRef.current = null;
            resolve(null);
          }
        }, 3000);
      });
    },

    get hasRealEmbedder() { return embedModelRef.current != null; },
  }));

  // ── Camera state ───────────────────────────────────────────────────────────
  const [isFocused, setIsFocused]     = useState(false);
  const [cameraKey, setCameraKey]     = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hint, setHint]               = useState('Position your face in the frame');

  // ── Reanimated shared values (gate overlay) ────────────────────────────────
  const gateProgress = useSharedValue(0);
  const boxL = useSharedValue(0.25);
  const boxT = useSharedValue(0.25);
  const boxW = useSharedValue(0.50);
  const boxH = useSharedValue(0.50);

  const lastUpdateMs = useRef(0);
  const onGateRef    = useRef(onGate);
  onGateRef.current  = onGate;

  useFocusEffect(
    useCallback(() => {
      if (!hasPermission) requestPermission();
      setIsFocused(true);
      setCameraError(null);
      return () => setIsFocused(false);
    }, [hasPermission, requestPermission]),
  );

  const flipCamera = useCallback(() => {
    setPosition(p => p === 'front' ? 'back' : 'front');
    setCameraKey(k => k + 1);
    setCameraError(null);
  }, []);

  const handleCameraError = useCallback((e: CameraRuntimeError) => {
    if (e.code === 'system/camera-is-restricted') {
      const id = setTimeout(() => { setCameraError(null); setCameraKey(k => k + 1); }, 1000);
      return () => clearTimeout(id);
    }
    setCameraError(e.message);
  }, []);

  // ── JS-thread embedding: receives raw pixels from worklet, runs model here ──
  const onRawPixels = useRunOnJS(
    (rawBuffer: ArrayBuffer) => {
      const model = embedModelRef.current;
      const cb    = embedResolveRef.current;
      embedResolveRef.current = null;

      if (!model || !cb) { cb?.(null); return; }

      try {
        const input = new Float32Array(rawBuffer);
        const normalized = new Float32Array(input.length);
        for (let i = 0; i < input.length; i++) {
          normalized[i] = (input[i] / 127.5) - 1.0;
        }
        const outputs = model.runSync([normalized.buffer as ArrayBuffer]);
        if (outputs.length > 0) {
          cb(l2Normalize(new Float32Array(outputs[0] as ArrayBuffer)));
        } else {
          cb(null);
        }
      } catch {
        cb(null);
      }
    },
    [],
  );

  // ── Gate update bridge: worklet → JS → Reanimated ─────────────────────────
  const updateFromWorklet = useRunOnJS(
    (
      status: string,
      x: number, y: number, w: number, h: number,
      hintMsg: string,
      eyesOpen: boolean, headYaw: number, smiling: boolean,
      isStub: boolean,
    ) => {
      const now = Date.now();
      if (now - lastUpdateMs.current < 50) return;
      lastUpdateMs.current = now;

      const isGood = status === 'good';
      gateProgress.value = withTiming(isGood ? 1 : 0, { duration: 200 });
      boxL.value = withSpring(x, { damping: 20, stiffness: 300 });
      boxT.value = withSpring(y, { damping: 20, stiffness: 300 });
      boxW.value = withSpring(w, { damping: 20, stiffness: 300 });
      boxH.value = withSpring(h, { damping: 20, stiffness: 300 });
      setHint(hintMsg);
      onGateRef.current?.({
        status: status as GateStatus, hint: hintMsg,
        eyesOpen, headYaw, smiling, isStub,
      });
    },
    [],
  );

  // ── Frame processor ────────────────────────────────────────────────────────
  // IMPORTANT: no native model (TfliteModel / HybridObject) is accessed here.
  // Detection uses the pure-JS stub. Embedding pixel extraction runs here
  // then is handed off to the JS thread via onRawPixels (useRunOnJS).
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Gate detection — stub only (no HybridObject in worklet runtime)
      const result = stubDetectFace(frame);
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
        false, // isStub=false → simulate buttons visible, no auto-complete
      );

      // Embedding: extract pixels here (Frame API), run model on JS thread
      if (shouldEmbed.value) {
        shouldEmbed.value = false;
        try {
          const raw = resize(frame, {
            scale:       { width: EMBED_INPUT_WIDTH, height: EMBED_INPUT_HEIGHT },
            pixelFormat: 'rgb',
            dataType:    'float32',
          });
          onRawPixels(raw.buffer as ArrayBuffer);
        } catch {
          // timeout resolves null
        }
      }
    },
    [resize, updateFromWorklet, shouldEmbed, onRawPixels],
  );

  // ── Overlay styles ─────────────────────────────────────────────────────────
  const overlayStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(gateProgress.value, [0, 1], ['#FF453A', '#30D158']);
    const bgColor     = interpolateColor(gateProgress.value, [0, 1], ['rgba(255,69,58,0.12)', 'rgba(48,209,88,0.12)']);
    return {
      borderColor, backgroundColor: bgColor,
      left: boxL.value * W, top: boxT.value * H,
      width: boxW.value * W, height: boxH.value * H,
    };
  });

  const hintTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(gateProgress.value, [0, 1], ['#FF453A', '#30D158']),
  }));

  // ── Permission / device guards ─────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>Camera permission required</ThemedText>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <ThemedText style={styles.btnText}>Grant Permission</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>No camera device found</ThemedText>
      </View>
    );
  }

  if (cameraError) {
    return (
      <View style={styles.centred}>
        <ThemedText type="subtitle" style={styles.centredText}>Camera error</ThemedText>
        <ThemedText style={[styles.centredText, styles.errorText]}>{cameraError}</ThemedText>
        <TouchableOpacity style={styles.btn} onPress={() => { setCameraError(null); setCameraKey(k => k + 1); }}>
          <ThemedText style={styles.btnText}>Retry</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
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

      <Animated.View style={[styles.boundingBox, overlayStyle]} pointerEvents="none" />

      <SafeAreaView style={styles.topOverlay} edges={['top']}>
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

      <SafeAreaView style={styles.bottomOverlay} edges={['bottom']} pointerEvents="none">
        {hint.length > 0 && (
          <View style={styles.hintBubble}>
            <Animated.Text style={[styles.hintText, hintTextStyle]}>{hint}</Animated.Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  centredText: { textAlign: 'center' },
  errorText:   { fontSize: 12, color: '#FF453A', marginTop: 4 },

  btn:     { backgroundColor: '#0A84FF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '600' },

  boundingBox: { position: 'absolute', borderWidth: 3, borderRadius: 12 },

  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8,
  },
  topSpacer: { width: 44 },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  flipBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  flipIcon: { fontSize: 22 },

  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingBottom: 16,
  },
  hintBubble: {
    backgroundColor: 'rgba(0,0,0,0.60)',
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
  },
  hintText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
