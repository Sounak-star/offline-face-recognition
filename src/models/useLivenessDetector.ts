import { useEffect, useState } from 'react';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import { StubLivenessDetector } from './StubLivenessDetector';
import { createRealLivenessDetector } from './RealLivenessDetector';
import type { ILivenessDetector } from './ILivenessDetector';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FAS_ASSET = require('../../assets/models/fas.tflite');

let _fasPromise: Promise<ILivenessDetector> | null = null;

function loadFasOnce(): Promise<ILivenessDetector> {
  if (!_fasPromise) {
    _fasPromise = (async () => {
      try {
        const model = await loadTensorflowModel(FAS_ASSET, []);
        console.log('[LivenessDetector] Real MiniFASNet loaded.');
        return createRealLivenessDetector(model as unknown as TfliteModel);
      } catch {
        console.log('[LivenessDetector] fas.tflite absent or invalid — STUB active.');
        return StubLivenessDetector;
      }
    })();
  }
  return _fasPromise;
}

export function useLivenessDetector(): ILivenessDetector {
  const [detector, setDetector] = useState<ILivenessDetector>(StubLivenessDetector);

  useEffect(() => {
    let cancelled = false;
    loadFasOnce().then(d => { if (!cancelled) setDetector(d); });
    return () => { cancelled = true; };
  }, []);

  return detector;
}
