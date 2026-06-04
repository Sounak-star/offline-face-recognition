export type LivenessLabel = 'live' | 'print' | 'replay';

export interface LivenessResult {
  label: LivenessLabel;
  confidence: number;
}

export interface ILivenessDetector {
  /** Run passive anti-spoofing on a captured face image URI. */
  score(photoUri: string): Promise<LivenessResult>;
}
