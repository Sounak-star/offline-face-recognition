/**
 * REAL face detector — wraps a BlazeFace/MediaPipe .tflite model loaded via
 * react-native-fast-tflite.
 *
 * This path is DORMANT in Phase 1: the placeholder model file is not a valid
 * TFLite flatbuffer, so fast-tflite fails to load it and useFaceDetector()
 * returns tfModel=undefined, routing everything to the stub.
 *
 * When the real model is dropped into assets/models/ and the app is rebuilt,
 * useFaceDetector() returns the live model and this code executes.
 *
 * All functions are marked 'worklet' so they run inside the VisionCamera frame
 * processor (react-native-worklets-core runtime).
 */
import type { Frame } from 'react-native-vision-camera';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import type { FaceDetectionResult } from './IFaceDetector';
import {
  FACE_DETECT_INPUT_WIDTH,
  FACE_DETECT_INPUT_HEIGHT,
  FACE_DETECT_CONFIDENCE_THRESHOLD,
} from '@/lib/config';

/** Type of the `resize` function returned by `useResizePlugin()`. */
type ResizeFn = (
  frame: Frame,
  options: {
    scale:       { width: number; height: number };
    pixelFormat: 'rgb' | 'rgba' | 'bgra' | 'argb';
    dataType:    'uint8' | 'float32';
  }
) => Uint8Array | Float32Array;

/**
 * Run one inference and return the best detected face, or null.
 *
 * @param frame   Raw camera frame from VisionCamera.
 * @param model   Loaded TFLite model (TfliteModel.runSync is worklet-safe).
 * @param resize  Worklet resize function from useResizePlugin().
 */
export function realDetectFace(
  frame: Frame,
  model: TfliteModel,
  resize: ResizeFn,
): FaceDetectionResult | null {
  'worklet';
  try {
    // 1. Resize to model input size; resize() is a 'worklet' in the plugin.
    const input = resize(frame, {
      scale:       { width: FACE_DETECT_INPUT_WIDTH, height: FACE_DETECT_INPUT_HEIGHT },
      pixelFormat: 'rgb',
      dataType:    'uint8',
    });

    // 2. TFLite expects ArrayBuffer — cast to satisfy strict ArrayBufferLike.
    const outputs: ArrayBuffer[] = model.runSync([input.buffer as ArrayBuffer]);

    // 3. Parse BlazeFace-style output.
    //    outputs[0] — boxes  (float32, layout: [ymin, xmin, ymax, xmax, ...])
    //    outputs[1] — scores (float32)
    //    Exact tensor layout depends on the model variant; update in Phase 2
    //    once the real model file and its output description are available.
    if (outputs.length < 2) return null;

    const scores = new Float32Array(outputs[1]);
    const boxes  = new Float32Array(outputs[0]);

    if (scores.length === 0) return null;

    const confidence = scores[0];
    if (confidence < FACE_DETECT_CONFIDENCE_THRESHOLD) return null;

    // Normalized [ymin, xmin, ymax, xmax] — standard TFLite detection format.
    const ymin = boxes[0], xmin = boxes[1], ymax = boxes[2], xmax = boxes[3];

    return {
      box: {
        x:      xmin,
        y:      ymin,
        width:  xmax - xmin,
        height: ymax - ymin,
      },
      eyesOpen: true,
      headYaw:  0,
      smiling:  false,
    };
  } catch {
    // Any inference error → no face (never crash the camera thread).
    return null;
  }
}
