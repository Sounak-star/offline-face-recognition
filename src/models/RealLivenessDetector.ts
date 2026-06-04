/**
 * REAL liveness detector — MiniFASNet via react-native-fast-tflite.
 *
 * DORMANT: assets/models/fas.tflite is a placeholder. useLivenessDetector()
 * catches the load failure and returns StubLivenessDetector instead.
 *
 * Activation checklist:
 *   1. Drop MiniFASNet v2.7 weights (80×80 input, 3-class softmax) into
 *      assets/models/fas.tflite
 *   2. Verify label order matches LABELS below (model card → training script)
 *   3. Rebuild: npx expo run:android
 *   4. useLivenessDetector() auto-switches to real on successful load
 *
 * TODO: replace the zero-filled input with real JPEG→BGR pixel decoding once
 * a native pixel-reader (expo-image-manipulator raw output or a custom module)
 * is available. The dormant path means this TODO has no runtime impact yet.
 */
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ILivenessDetector, LivenessLabel, LivenessResult } from './ILivenessDetector';
import { FAS_INPUT_WIDTH, FAS_INPUT_HEIGHT } from '@/lib/config';

// Class order — verify against your model's training labels before shipping.
// MiniFASNet v2.7 default: index 0 = spoof(print), 1 = spoof(replay), 2 = live.
const LABELS: LivenessLabel[] = ['print', 'replay', 'live'];

export function createRealLivenessDetector(model: TfliteModel): ILivenessDetector {
  return {
    async score(photoUri: string): Promise<LivenessResult> {
      // 1. Resize face crop to model input size
      await ImageManipulator.manipulateAsync(
        photoUri,
        [{ resize: { width: FAS_INPUT_WIDTH, height: FAS_INPUT_HEIGHT } }],
        { format: ImageManipulator.SaveFormat.JPEG },
      );

      // 2. TODO: decode resized JPEG → BGR float32 pixels ÷ 255.0
      //    Using zeros until native pixel decoding is wired up.
      const input = new Float32Array(FAS_INPUT_WIDTH * FAS_INPUT_HEIGHT * 3);

      // 3. Inference
      const outputs = model.runSync([input.buffer as ArrayBuffer]);
      if (outputs.length === 0) return { label: 'live', confidence: 0 };

      // 4. Softmax argmax over 3 classes
      const logits = new Float32Array(outputs[0] as ArrayBuffer);
      const n = Math.min(3, logits.length);
      let maxVal = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < n; i++) {
        if (logits[i] > maxVal) { maxVal = logits[i]; maxIdx = i; }
      }
      const expVals = Array.from({ length: n }, (_, i) => Math.exp(logits[i] - maxVal));
      const sumExp = expVals.reduce((a, b) => a + b, 0);
      const confidence = expVals[maxIdx] / sumExp;

      return { label: LABELS[maxIdx] ?? 'live', confidence };
    },
  };
}
