/**
 * Pure gate evaluation — no camera or model dependencies.
 * Marked 'worklet' so it can be called directly from the frame processor.
 */
import type { FaceDetectionResult, GateResult } from './IFaceDetector';
import { GATE_CENTER_TOLERANCE, GATE_MIN_FACE_SIZE } from '@/lib/config';

export function evaluateGate(result: FaceDetectionResult | null): GateResult {
  'worklet';

  if (result === null) {
    return { status: 'no-face', hint: 'Position your face in the frame' };
  }

  const { box } = result;

  // Size check first — user needs to be closer.
  if (box.width < GATE_MIN_FACE_SIZE || box.height < GATE_MIN_FACE_SIZE) {
    return { status: 'too-small', hint: 'Move closer' };
  }

  // Centre check — horizontal and vertical offset from 0.5.
  const cx = box.x + box.width  / 2;
  const cy = box.y + box.height / 2;
  if (
    Math.abs(cx - 0.5) > GATE_CENTER_TOLERANCE ||
    Math.abs(cy - 0.5) > GATE_CENTER_TOLERANCE
  ) {
    return { status: 'off-center', hint: 'Center your face' };
  }

  return { status: 'good', hint: '' };
}
