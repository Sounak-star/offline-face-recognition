/**
 * All coordinates are NORMALISED (0–1) relative to the display view.
 * Screens multiply by screen W/H to get pixel positions.
 *
 * Phase 1 note: real detectors return raw frame-pixel coords which must be
 * transformed to display coords (rotation + scale). The normalised contract
 * here means screens never need to change when the real model lands.
 */

export interface NormalizedBox {
  x:      number; // left edge  0-1
  y:      number; // top edge   0-1
  width:  number; // 0-1
  height: number; // 0-1
}

export interface FaceDetectionResult {
  box:        NormalizedBox;
  landmarks?: unknown;
  eyesOpen?:  boolean;
  headYaw?:   number;  // degrees, 0 = looking straight
  smiling?:   boolean;
}

export type GateStatus = 'good' | 'no-face' | 'off-center' | 'too-small';

export interface GateResult {
  status: GateStatus;
  hint:   string; // short user-facing message; '' when status === 'good'
}
