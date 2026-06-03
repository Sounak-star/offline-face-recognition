/**
 * Liveness — Phase 4
 *
 * Pure functions (no React) for:
 *   • Defining the challenge pool
 *   • Picking a random subset of challenges
 *   • Checking whether a challenge is satisfied by face metrics
 *   • Running passive checks (eyes open, head forward)
 */

import {
  LIVENESS_CHALLENGE_COUNT,
  LIVENESS_CHALLENGE_TIMEOUT_MS,
  LIVENESS_YAW_MAX_DEG,
} from '@/lib/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChallengeType = 'blink' | 'turn-left' | 'turn-right' | 'smile';

export interface LivenessChallenge {
  type: ChallengeType;
  instruction: string;
  icon: string;
  timeoutMs: number;
}

/** Face metrics received from the gate callback. */
export interface FaceMetrics {
  eyesOpen?: boolean;
  headYaw?: number;   // degrees, 0 = straight
  smiling?: boolean;
}

// ─── Challenge pool ───────────────────────────────────────────────────────────

const CHALLENGE_POOL: LivenessChallenge[] = [
  {
    type: 'blink',
    instruction: 'Blink your eyes',
    icon: '👁️',
    timeoutMs: LIVENESS_CHALLENGE_TIMEOUT_MS,
  },
  {
    type: 'turn-left',
    instruction: 'Turn your head left',
    icon: '👈',
    timeoutMs: LIVENESS_CHALLENGE_TIMEOUT_MS,
  },
  {
    type: 'turn-right',
    instruction: 'Turn your head right',
    icon: '👉',
    timeoutMs: LIVENESS_CHALLENGE_TIMEOUT_MS,
  },
  {
    type: 'smile',
    instruction: 'Smile!',
    icon: '😊',
    timeoutMs: LIVENESS_CHALLENGE_TIMEOUT_MS,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pick `count` random unique challenges from the pool.
 * Uses Fisher-Yates partial shuffle for unbiased selection.
 */
export function generateChallenges(
  count: number = LIVENESS_CHALLENGE_COUNT,
): LivenessChallenge[] {
  const pool = [...CHALLENGE_POOL];
  const n = Math.min(count, pool.length);
  for (let i = pool.length - 1; i > pool.length - 1 - n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(pool.length - n);
}

/**
 * Check whether a specific challenge is satisfied by the current face metrics.
 *
 * Blink detection uses transition: we need to see eyes closed at least once
 * (tracked externally via `eyesWereClosed`) and then eyes re-opened.
 *
 * @param challenge       The challenge to evaluate
 * @param current         Current frame's face metrics
 * @param eyesWereClosed  Whether we've already seen eyes closed in this challenge
 * @returns               Whether the challenge is now complete
 */
export function isChallengeComplete(
  challenge: LivenessChallenge,
  current: FaceMetrics,
  eyesWereClosed: boolean = false,
): boolean {
  switch (challenge.type) {
    case 'blink':
      // Blink = eyes were closed at some point AND are now open again
      return eyesWereClosed && (current.eyesOpen === true);

    case 'turn-left':
      // headYaw < -threshold means looking left
      return (current.headYaw ?? 0) < -LIVENESS_YAW_MAX_DEG;

    case 'turn-right':
      // headYaw > threshold means looking right
      return (current.headYaw ?? 0) > LIVENESS_YAW_MAX_DEG;

    case 'smile':
      return current.smiling === true;

    default:
      return false;
  }
}

/**
 * Detect if eyes are currently closed (used to track blink transitions).
 */
export function areEyesClosed(metrics: FaceMetrics): boolean {
  return metrics.eyesOpen === false;
}

/**
 * Passive liveness check — runs continuously.
 * Returns null if OK, or a hint string if something is wrong.
 */
export function isPassiveCheckOk(metrics: FaceMetrics): boolean {
  return passiveCheck(metrics) === null;
}

export function passiveCheck(metrics: FaceMetrics): string | null {
  if (metrics.eyesOpen === false) {
    return 'Open your eyes';
  }
  const yaw = Math.abs(metrics.headYaw ?? 0);
  if (yaw > LIVENESS_YAW_MAX_DEG) {
    return 'Face the camera';
  }
  return null;
}
