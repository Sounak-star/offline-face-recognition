/**
 * STUB face detector — used when no real .tflite model is loaded.
 *
 * Returns a plausible centre-box so every UI screen can be built and tested
 * without a real model present. Runs as a worklet inside the VisionCamera
 * frame processor (react-native-worklets-core runtime).
 */
import type { Frame } from 'react-native-vision-camera';
import type { FaceDetectionResult } from './IFaceDetector';

export function stubDetectFace(_frame: Frame): FaceDetectionResult {
  'worklet';
  // Simulate a face occupying the central 50 % of the display.
  return {
    box: { x: 0.25, y: 0.25, width: 0.50, height: 0.50 },
    eyesOpen: true,
    headYaw:  0,
    smiling:  false,
  };
}
