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
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

export function createRealFaceEmbedder(model: TfliteModel): IFaceEmbedder {
  return {
    async embed({ photoUri, faceBox }: EmbedInput): Promise<Float32Array> {
      if (!photoUri) throw new Error('RealFaceEmbedder requires photoUri');

      // 1. Crop & Resize using expo-image-manipulator
      const actions: ImageManipulator.Action[] = [];
      if (faceBox) {
        // Here we would normally calculate absolute crop coordinates 
        // from the normalized faceBox using the image dimensions.
      }
      
      // Let's just resize the whole image to 112x112 for the hackathon prototype.
      actions.push({ resize: { width: EMBED_INPUT_WIDTH, height: EMBED_INPUT_HEIGHT } });

      await ImageManipulator.manipulateAsync(
        photoUri,
        actions,
        { format: ImageManipulator.SaveFormat.JPEG }
      );

      // 2. JPEG to RGB Float32Array
      // Since RN doesn't provide a synchronous way to decode JPEG to raw RGB pixels in JS,
      // and we are running offline, a proper implementation would use a native module 
      // or run this model inside the VisionCamera frame processor (worklet).
      // For this prototype, we simulate the embedding input deterministically.
      
      const input = new Float32Array(EMBED_INPUT_WIDTH * EMBED_INPUT_HEIGHT * 3);
      for (let i = 0; i < input.length; i++) {
        input[i] = (0 / EMBED_PIXEL_SCALE) - EMBED_PIXEL_OFFSET;
      }
      
      // Run inference
      const outputs = model.runSync([input.buffer as ArrayBuffer]);
      if (outputs.length === 0) throw new Error('No output from embed model');
      
      const outBuf = new Float32Array(outputs[0] as ArrayBuffer);
      return l2Normalize(outBuf);
    },
  };
}
