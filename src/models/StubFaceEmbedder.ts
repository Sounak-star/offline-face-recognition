/**
 * STUB face embedder.
 *
 * Generates a DETERMINISTIC, L2-normalised vector from a seeded LCG PRNG:
 *   base vector  = LCG(hash(personId))               — same for every capture
 *   noise vector = LCG(hash(personId + captureIndex)) — per-capture variation
 *   result = L2_normalise(base + noise * STUB_NOISE_SCALE)
 *
 * Properties:
 *   • Same person, different captures → cosine similarity ≈ 0.997
 *   • Different people                → cosine similarity ≈ 0.0–0.1
 *     (random unit vectors in R^192 are nearly orthogonal)
 *
 * No pixel data or camera access is required — safe for tests when the
 * real MobileFaceNet model is absent.
 */
import { EMBEDDING_SIZE, STUB_NOISE_SCALE } from '@/lib/config';
import { l2Normalize } from '@/lib/similarity';
import type { EmbedInput, IFaceEmbedder } from './IFaceEmbedder';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** djb2 hash → unsigned 32-bit integer. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** LCG random number generator seeded with a 32-bit integer. */
function makeLcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000; // [0, 1)
  };
}

/** Fill a Float32Array with values in [-1, 1] using the given PRNG. */
function fillRandom(vec: Float32Array, rng: () => number): void {
  for (let i = 0; i < vec.length; i++) vec[i] = rng() * 2 - 1;
}

// ── Implementation ────────────────────────────────────────────────────────────

export const StubFaceEmbedder: IFaceEmbedder = {
  async embed({ personId, captureIndex }: EmbedInput): Promise<Float32Array> {
    const dim = EMBEDDING_SIZE;

    // Base vector — identical for every capture of this person.
    const base = new Float32Array(dim);
    fillRandom(base, makeLcg(hashStr(personId)));

    // Per-capture noise — small variation simulating real camera frames.
    const noise = new Float32Array(dim);
    fillRandom(noise, makeLcg(hashStr(`${personId}:${captureIndex}`)));

    const result = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      result[i] = base[i] + noise[i] * STUB_NOISE_SCALE;
    }

    return l2Normalize(result);
  },
};
