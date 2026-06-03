/**
 * REAL face embedder — MobileFaceNet / EdgeFace via react-native-fast-tflite.
 *
 * DORMANT in Phase 2: the placeholder face_embed.tflite is not a valid
 * flatbuffer, so useFaceEmbedder() returns tfModel=undefined and the stub
 * is used instead.
 *
 * Phase 3 activation checklist:
 *   1. Drop real face_embed.tflite into assets/models/
 *   2. Install expo-file-system (npx expo install expo-file-system)
 *   3. Rebuild (npx expo run:android)
 *   4. Implement readPixels() below using expo-image-manipulator
 *   5. The caller must delete photoUri immediately after embed() returns
 */
import { EMBED_INPUT_WIDTH, EMBED_INPUT_HEIGHT, EMBED_PIXEL_SCALE, EMBED_PIXEL_OFFSET, EMBEDDING_SIZE } from '@/lib/config';
import { expandFaceBox } from '@/lib/facePreprocessor';
import { l2Normalize } from '@/lib/similarity';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import type { EmbedInput, IFaceEmbedder } from './IFaceEmbedder';

export function createRealFaceEmbedder(model: TfliteModel): IFaceEmbedder {
  return {
    async embed({ photoUri, faceBox }: EmbedInput): Promise<Float32Array> {
      if (!photoUri) throw new Error('RealFaceEmbedder requires photoUri');

      // Phase 3 TODO: replace stub pixel array with real image pixels.
      // Steps:
      //   const crop = faceBox ? expandFaceBox(faceBox) : { x:0, y:0, width:1, height:1 };
      //   const pixels = await readPixels(photoUri, crop, EMBED_INPUT_WIDTH, EMBED_INPUT_HEIGHT);
      //   const input  = normalise(pixels);  // pixel/EMBED_PIXEL_SCALE - EMBED_PIXEL_OFFSET
      //   const [outBuf] = model.runSync([input.buffer as ArrayBuffer]);
      //   return l2Normalize(new Float32Array(outBuf));

      // Suppress unused-variable warnings for dormant Phase 3 references.
      void expandFaceBox;
      void EMBED_INPUT_WIDTH; void EMBED_INPUT_HEIGHT;
      void EMBED_PIXEL_SCALE; void EMBED_PIXEL_OFFSET;
      void l2Normalize; void model;

      throw new Error('RealFaceEmbedder: pixel reading not yet implemented (Phase 3)');
    },
  };
}
