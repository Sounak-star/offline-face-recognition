/**
 * Face embedder hooks.
 *
 * Two exports:
 *
 *   useEmbedModel()   — loads the TFLite model and returns it for use in the
 *                        frame processor (CameraWithGate). Returns undefined
 *                        when the placeholder file is present.
 *
 *   useFaceEmbedder() — returns an IFaceEmbedder that wraps either the real
 *                        model or the stub. Used as a FALLBACK by screens when
 *                        the camera-based embedding path is unavailable.
 *
 * Automatic REAL / STUB selection:
 *   placeholder face_embed.tflite → fast-tflite load error → StubFaceEmbedder
 *   real MobileFaceNet model      → model loaded            → RealFaceEmbedder
 *
 * No code changes are needed when switching from stub to real.
 */
import { useEffect, useState } from 'react';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import { StubFaceEmbedder } from './StubFaceEmbedder';
import { createRealFaceEmbedder } from './RealFaceEmbedder';
import type { IFaceEmbedder } from './IFaceEmbedder';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EMBED_ASSET = require('../../assets/models/face_embed.tflite');

// ─── Shared singleton to avoid loading the model twice ────────────────────────

let _modelPromise: Promise<TfliteModel | null> | null = null;

function loadModelOnce(): Promise<TfliteModel | null> {
  if (!_modelPromise) {
    _modelPromise = (async () => {
      try {
        const model = await loadTensorflowModel(EMBED_ASSET, []);
        console.log('[FaceEmbedder] Real MobileFaceNet loaded.');
        return model as unknown as TfliteModel;
      } catch {
        console.log('[FaceEmbedder] Placeholder model — STUB embedder active.');
        return null;
      }
    })();
  }
  return _modelPromise;
}

// ─── useEmbedModel — raw TFLite model for frame processor ────────────────────

export interface EmbedModelState {
  /** The loaded TFLite model, or undefined while loading / on error (→ stub). */
  embedModel: TfliteModel | undefined;
}

export function useEmbedModel(): EmbedModelState {
  const [model, setModel] = useState<TfliteModel | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadModelOnce().then((m) => {
      if (!cancelled && m) setModel(m);
    });
    return () => { cancelled = true; };
  }, []);

  return { embedModel: model };
}

// ─── useFaceEmbedder — high-level IFaceEmbedder for stub fallback ────────────

export function useFaceEmbedder(): IFaceEmbedder {
  const [embedder, setEmbedder] = useState<IFaceEmbedder>(StubFaceEmbedder);

  useEffect(() => {
    let cancelled = false;
    loadModelOnce().then((m) => {
      if (!cancelled && m) {
        setEmbedder(createRealFaceEmbedder(m));
      }
    });
    return () => { cancelled = true; };
  }, []);

  return embedder;
}
