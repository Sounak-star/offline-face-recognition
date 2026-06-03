/**
 * Loads the face-detection TFLite model and exposes it for use in frame
 * processors.
 *
 * Automatic REAL / STUB selection:
 *   • Placeholder file present (not a valid flatbuffer) → fast-tflite fails
 *     silently → state 'error' → tfModel is undefined → caller uses STUB.
 *   • Real BlazeFace file replaces the placeholder + rebuild → fast-tflite
 *     loads successfully → tfModel is the live model → caller uses REAL.
 *     No code changes required.
 */
import { useTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FACE_DETECT_ASSET = require('../../assets/models/face_detect.tflite');

export interface FaceDetectorState {
  /** The loaded TFLite model, or undefined while loading / on error (→ stub). */
  tfModel:    TfliteModel | undefined;
  modelState: 'loading' | 'loaded' | 'error';
}

export function useFaceDetector(): FaceDetectorState {
  // Pass empty delegates array → CPU delegate (default).
  const result = useTensorflowModel(FACE_DETECT_ASSET, []);
  return {
    tfModel:    result.state === 'loaded' ? result.model : undefined,
    modelState: result.state,
  };
}
