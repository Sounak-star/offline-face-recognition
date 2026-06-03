/**
 * Vector math helpers shared by embedding, matching and the stub embedder.
 */

/** L2-normalize a Float32Array in-place and return it. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm < 1e-10) return v; // avoid division by zero
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Cosine similarity of two L2-normalised vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[],
): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Element-wise mean of multiple embedding vectors.
 * The result is L2-normalised so it can be used directly for matching.
 */
export function averageEmbedding(embeddings: number[][]): Float32Array {
  if (embeddings.length === 0) throw new Error('Empty embedding list');
  const dim = embeddings[0].length;
  const mean = new Float32Array(dim);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) mean[i] += e[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= embeddings.length;
  return l2Normalize(mean);
}
