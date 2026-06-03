import type { Frame } from 'react-native-vision-camera';

/**
 * Bounding box in NORMALIZED coordinates (0-1) relative to the display view.
 * x, y = top-left corner; width, height = extent.
 * Screens multiply these by screen width/height to get pixel positions.
 *
 * Phase 1 note: real detectors return frame-pixel coords which must be
 * transformed to display coords (accounting for rotation, crop, scale).
 * Keeping this normalized from the start means screens never change.
 */
export interface FaceDetectionResult {
  box: {
    x:      number; // 0-1
    y:      number; // 0-1
    width:  number; // 0-1
    height: number; // 0-1
  };
  landmarks?: unknown;
  eyesOpen?:  boolean;
  headYaw?:   number;
  smiling?:   boolean;
}

export interface FaceDetector {
  detectFace(frame: Frame): FaceDetectionResult | null;
}

/**
 * Stub: always returns a centered box covering 50% of the view.
 * Used for Phase 0 wiring verification; replaced by real TFLite detector
 * in Phase 1.
 */
export const FaceDetectorStub: FaceDetector = {
  detectFace: (_frame: Frame): FaceDetectionResult => {
    'worklet';
    return {
      box: {
        x:      0.25, // 25% from left
        y:      0.25, // 25% from top
        width:  0.50,
        height: 0.50,
      },
      eyesOpen: true,
      headYaw:  0,
      smiling:  false,
    };
  },
};
