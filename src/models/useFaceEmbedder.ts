/**
 * Selects the correct face embedder:
 *   • placeholder face_embed.tflite → fast-tflite load error → StubFaceEmbedder
 *   • real MobileFaceNet model      → model loaded            → RealFaceEmbedder
 *
 * No code changes are needed when switching from stub to real.
 */
import { useEffect, useState } from 'react';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { StubFaceEmbedder } from './StubFaceEmbedder';
import { createRealFaceEmbedder } from './RealFaceEmbedder';
import type { IFaceEmbedder } from './IFaceEmbedder';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EMBED_ASSET = require('../../assets/models/face_embed.tflite');

export function useFaceEmbedder(): IFaceEmbedder {
  const [embedder, setEmbedder] = useState<IFaceEmbedder>(StubFaceEmbedder);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const model = await loadTensorflowModel(EMBED_ASSET, []);
        if (!cancelled) {
          setEmbedder(createRealFaceEmbedder(model as never));
          console.log('[FaceEmbedder] Real MobileFaceNet loaded.');
        }
      } catch {
        if (!cancelled) {
          console.log('[FaceEmbedder] Placeholder model — STUB embedder active.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return embedder;
}
