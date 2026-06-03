/**
 * Face embedder interface.
 *
 * Returns a L2-normalised Float32Array of length EMBEDDING_SIZE.
 * The same physical face should produce vectors with high cosine similarity.
 */
import type { NormalizedBox } from './IFaceDetector';

export interface EmbedInput {
  /**
   * Person UUID — used by the stub as the deterministic seed.
   * Must always be present.
   */
  personId: string;

  /**
   * Index of this capture within the enrollment session (0-based).
   * Used by the stub to add per-capture noise so captures aren't identical.
   */
  captureIndex: number;

  /**
   * REAL path (Phase 3):
   * file:// URI of the captured photo. The embedder reads, processes, and
   * the caller MUST delete it immediately after embed() returns.
   */
  photoUri?: string;

  /** Detected face box for cropping (Phase 3). */
  faceBox?: NormalizedBox;
}

export interface IFaceEmbedder {
  embed(input: EmbedInput): Promise<Float32Array>;
}
