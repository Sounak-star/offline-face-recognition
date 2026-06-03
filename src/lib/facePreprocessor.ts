/**
 * Face crop + preprocessing helpers.
 *
 * Phase 2 (stub): only the box-expansion math is used.
 *
 * Phase 3 (real model): TODO
 *   1. Take photo via camera.takePhoto()
 *   2. Crop to expandedBox using expo-image-manipulator
 *   3. Apply histogram equalisation for illumination normalisation
 *   4. Resize to EMBED_INPUT_WIDTH × EMBED_INPUT_HEIGHT
 *   5. Read pixels, normalise to [-1, 1] (pixel/127.5 - 1.0)
 *   6. Pass Float32Array to RealFaceEmbedder
 *   7. IMMEDIATELY delete the photo file (expo-file-system)
 */
import type { NormalizedBox } from '@/models/IFaceDetector';
import { FACE_CROP_MARGIN } from '@/lib/config';

export interface ExpandedBox {
  /** All values clamped to [0, 1]. */
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

/**
 * Expand a detected face box by FACE_CROP_MARGIN on each side,
 * clamped so it never exceeds the normalised [0,1] frame boundary.
 */
export function expandFaceBox(
  box: NormalizedBox,
  margin: number = FACE_CROP_MARGIN,
): ExpandedBox {
  const mw = box.width  * margin;
  const mh = box.height * margin;
  const x = Math.max(0, box.x - mw);
  const y = Math.max(0, box.y - mh);
  const x2 = Math.min(1, box.x + box.width  + mw);
  const y2 = Math.min(1, box.y + box.height + mh);
  return { x, y, width: x2 - x, height: y2 - y };
}
