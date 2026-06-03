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
      dataType:    'float32', // standard for BlazeFace float16/float32
    });

    // Normalize (pixel / 127.5) - 1.0 (standard for MediaPipe models)
    const normalized = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      normalized[i] = (input[i] / 127.5) - 1.0;
    }

    // 2. TFLite expects ArrayBuffer
    const outputs = model.runSync([normalized.buffer as ArrayBuffer]);

    if (outputs.length < 2) return null;

    // BlazeFace outputs: usually [1, 896, 16] for boxes, [1, 896, 1] for scores
    // We assume the shorter array is scores, longer is boxes.
    const arr0 = new Float32Array(outputs[0] as ArrayBuffer);
    const arr1 = new Float32Array(outputs[1] as ArrayBuffer);
    
    const isArr0Scores = arr0.length < arr1.length;
    const scores = isArr0Scores ? arr0 : arr1;
    const boxes = isArr0Scores ? arr1 : arr0;

    if (scores.length === 0) return null;

    // Find the max score (naïve non-max suppression for simplicity, assuming 1 face)
    let maxScore = -1;
    let maxIndex = -1;
    for (let i = 0; i < scores.length; i++) {
      // In some formats, score is raw logit. Sigmoid it.
      const score = 1.0 / (1.0 + Math.exp(-scores[i]));
      if (score > maxScore) {
        maxScore = score;
        maxIndex = i;
      }
    }

    if (maxScore < FACE_DETECT_CONFIDENCE_THRESHOLD || maxIndex === -1) return null;

    // Each box has 16 values. (ymin, xmin, ymax, xmax, right_eye_x, right_eye_y, ...)
    const boxOffset = maxIndex * 16;
    
    // Convert from model coordinates to normalized [0, 1]
    const ymin = boxes[boxOffset + 0] / FACE_DETECT_INPUT_HEIGHT;
    const xmin = boxes[boxOffset + 1] / FACE_DETECT_INPUT_WIDTH;
    const ymax = boxes[boxOffset + 2] / FACE_DETECT_INPUT_HEIGHT;
    const xmax = boxes[boxOffset + 3] / FACE_DETECT_INPUT_WIDTH;

    // Landmarks (right eye, left eye, nose, mouth, right ear, left ear)
    const rightEyeX = boxes[boxOffset + 4] / FACE_DETECT_INPUT_WIDTH;
    const leftEyeX  = boxes[boxOffset + 6] / FACE_DETECT_INPUT_WIDTH;
    const noseX     = boxes[boxOffset + 8] / FACE_DETECT_INPUT_WIDTH;
    
    // Simple heuristic for head yaw: relative position of nose between eyes
    const eyeDist = Math.abs(leftEyeX - rightEyeX);
    let headYaw = 0;
    if (eyeDist > 0.01) {
      const midPoint = (leftEyeX + rightEyeX) / 2.0;
      // Map displacement to degrees (rough approximation)
      headYaw = ((noseX - midPoint) / eyeDist) * 90; 
    }

    return {
      box: {
        x:      xmin,
        y:      ymin,
        width:  xmax - xmin,
        height: ymax - ymin,
      },
      eyesOpen: true, // We don't have eyes open landmark from standard blazeface, assume true
      headYaw,
      smiling:  false, // Not available in standard blazeface
    };
  } catch (e) {
    // Any inference error → no face
    return null;
  }
}
