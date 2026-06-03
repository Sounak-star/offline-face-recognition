// Single source of truth for all ML model parameters, thresholds, and storage keys.
// Edit here only — never hardcode these values in screen or service files.

// ─── Camera ──────────────────────────────────────────────────────────────────

export const CAMERA_PIXEL_FORMAT = 'yuv' as const;

// ─── Face Detection model (TFLite) ───────────────────────────────────────────

/** Input tensor shape expected by the face-detection .tflite model. */
export const FACE_DETECT_INPUT_WIDTH = 128;
export const FACE_DETECT_INPUT_HEIGHT = 128;

/** Minimum confidence to treat a detection as a face. */
export const FACE_DETECT_CONFIDENCE_THRESHOLD = 0.7;

/** Resize plugin target size fed into the face detector. */
export const FACE_DETECT_RESIZE: { width: number; height: number } = {
  width: FACE_DETECT_INPUT_WIDTH,
  height: FACE_DETECT_INPUT_HEIGHT,
};

// ─── Face Embedding model (TFLite — e.g. MobileFaceNet) ──────────────────────

/** Input tensor shape expected by the face-embedding .tflite model. */
export const EMBED_INPUT_WIDTH = 112;
export const EMBED_INPUT_HEIGHT = 112;

/** Pixel normalisation: (pixel / 127.5) - 1.0  →  range [-1, 1]. */
export const EMBED_PIXEL_SCALE = 127.5;
export const EMBED_PIXEL_OFFSET = 1.0;

/** Length of the L2-normalised embedding vector produced by the model. */
export const EMBEDDING_SIZE = 192;

// ─── Matching thresholds ──────────────────────────────────────────────────────

/** Cosine similarity above this → same person. Tune on-device before shipping. */
export const MATCH_COSINE_THRESHOLD = 0.65;

/** Euclidean (L2) distance below this → same person (alternative metric). */
export const MATCH_L2_THRESHOLD = 0.9;

// ─── Liveness ────────────────────────────────────────────────────────────────

/** Head-yaw range (degrees) considered "looking straight". */
export const LIVENESS_YAW_MAX_DEG = 15;

/** Minimum eye-openness score (0–1) to pass liveness. */
export const LIVENESS_EYE_OPEN_MIN = 0.4;

/** Number of active challenges picked at random per verification attempt. */
export const LIVENESS_CHALLENGE_COUNT = 2;

/** Time limit (ms) for each active challenge before it's marked as failed. */
export const LIVENESS_CHALLENGE_TIMEOUT_MS = 5000;

/** In stub mode, auto-pass each challenge after this delay (ms). */
export const LIVENESS_STUB_AUTO_PASS_MS = 1500;

/** Storage key for liveness-enabled setting. */
export const STORAGE_KEY_LIVENESS_ENABLED = 'liveness_enabled';

// ─── Phase 1: Face-present gate ──────────────────────────────────────────────

/**
 * Maximum distance (normalized 0-1) that the face centre may be from the
 * screen centre and still be considered "centred".
 */
export const GATE_CENTER_TOLERANCE = 0.20;

/**
 * Minimum face bounding-box dimension (normalized 0-1) for "close enough".
 * Below this the hint is "Move closer".
 */
export const GATE_MIN_FACE_SIZE = 0.25;

/**
 * Run the frame processor on every Nth camera frame.
 * At 30 fps this gives ~10 detection updates/s — enough for a smooth gate.
 */
export const FRAME_SKIP = 3;

// ─── Phase 2: Enrollment ─────────────────────────────────────────────────────

/** Number of capture samples collected per enrollment session. */
export const ENROLL_SAMPLES = 3;

/**
 * Fractional margin added around the detected face box before passing
 * the crop to the embedder. 0.15 = 15 % expansion on each side.
 */
export const FACE_CROP_MARGIN = 0.15;

/**
 * Gaussian noise scale added to the stub embedding base vector so that
 * consecutive captures of the same person differ slightly (realistic).
 * Cosine similarity between two captures ≈ 1 - STUB_NOISE_SCALE²/2.
 */
export const STUB_NOISE_SCALE = 0.05;

// ─── Model asset paths (relative to project root, copied to assets/models/) ──

export const MODEL_FACE_DETECT = 'assets/models/face_detect.tflite';
export const MODEL_FACE_EMBED  = 'assets/models/face_embed.tflite';

// ─── Storage keys (react-native-mmkv) ────────────────────────────────────────

export const STORAGE_KEY_EMBEDDINGS = 'face_embeddings_v1';
export const STORAGE_KEY_HISTORY    = 'attendance_history_v1';

// ─── Secure store key (expo-secure-store, holds MMKV encryption key) ─────────

export const SECURE_KEY_MMKV = 'mmkv_encryption_key';
