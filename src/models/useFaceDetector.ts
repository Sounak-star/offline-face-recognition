/**
 * Loads the face-detection TFLite model and exposes it for use in frame
 * processors.
 *
 * Automatic REAL / STUB selection:
 *   • Placeholder file (not a valid flatbuffer) → load fails → tfModel is
 *     undefined → caller uses StubFaceDetector. Failure is logged at WARN
 *     level only, so the LogBox error overlay never appears.
 *   • Real BlazeFace file replaces the placeholder + rebuild → model loads
 *     → tfModel is the live model → caller uses RealFaceDetector.
 *     No code changes required.
 */
import { useEffect, useState } from 'react';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FACE_DETECT_ASSET = require('../../assets/models/face_detect.tflite');

export type ModelState = 'loading' | 'loaded' | 'error';

export interface FaceDetectorState {
  /** The loaded TFLite model, or undefined while loading / on error (→ stub). */
  tfModel:    TfliteModel | undefined;
  modelState: ModelState;
}

export function useFaceDetector(): FaceDetectorState {
  const [state, setState] = useState<FaceDetectorState>({
    tfModel:    undefined,
    modelState: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const model = await loadTensorflowModel(FACE_DETECT_ASSET, []);
        if (!cancelled) {
          setState({ tfModel: model as unknown as TfliteModel, modelState: 'loaded' });
          console.log('[FaceDetector] Real TFLite model loaded — using REAL detector.');
        }
      } catch {
        if (!cancelled) {
          // Expected when the placeholder file is present instead of a real model.
          // Use console.warn (not console.error) so the LogBox overlay never fires.
          console.warn(
            '[FaceDetector] Could not load face_detect.tflite — using STUB detector. ' +
            'Drop a real BlazeFace model into assets/models/ and rebuild to activate.'
          );
          setState({ tfModel: undefined, modelState: 'error' });
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return state;
}
