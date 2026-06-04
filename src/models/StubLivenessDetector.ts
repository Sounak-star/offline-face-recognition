import type { ILivenessDetector, LivenessResult } from './ILivenessDetector';

/** Always returns 'live' so the full flow runs without a real MiniFASNet model. */
export const StubLivenessDetector: ILivenessDetector = {
  async score(_photoUri: string): Promise<LivenessResult> {
    return { label: 'live', confidence: 1.0 };
  },
};
