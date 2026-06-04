# Offline Face Recognition & Attendance System

A fully offline, React Native mobile app for face-based attendance tracking with anti-spoofing liveness detection. All ML inference, biometric storage, and attendance logging happen on-device. Records sync to a backend only when connectivity returns.

Built for Hackathon 7.0 — targeting field personnel authentication in zero-network zones.

---

## What it does

1. **Enroll** — Capture 3 face samples, extract 192-d MobileFaceNet embeddings, store encrypted on-device.
2. **Verify** — Live camera gate → passive liveness check → randomized active challenge → cosine similarity match → PASS / FAIL with per-check breakdown.
3. **Queue offline** — Successful verifications are appended to an encrypted MMKV attendance queue (no raw images, embeddings only).
4. **Sync & purge** — When connectivity returns, a background SyncService uploads the queue and immediately purges local records.

---

## Stack

| Layer | Library | Why |
|---|---|---|
| Framework | Expo SDK 56 / React Native 0.85 | Cross-platform, managed native modules |
| Camera | `react-native-vision-camera` v4 | Frame processor API, `takePhoto` |
| ML runtime | `react-native-fast-tflite` v3 (Nitro) | Sub-50 ms TFLite inference |
| Worklets | `react-native-worklets-core` v1.6 | Camera-thread JS worklet runtime |
| Pixel resize | `vision-camera-resize-plugin` | Frame → typed array in worklet |
| Animations | `react-native-reanimated` v4 | 60 fps gate overlay |
| Storage | `react-native-mmkv` (AES-256) | Encrypted embeddings + logs |
| Secure keys | `expo-secure-store` | MMKV encryption key in OS keystore |
| Connectivity | `@react-native-community/netinfo` | Auto-sync on network restore |
| Image ops | `expo-image-manipulator` | Face crop resize for MiniFASNet |

---

## ML Models

| Model | File | Size | Input | Output |
|---|---|---|---|---|
| BlazeFace Short Range | `assets/models/face_detect.tflite` | 225 KB | 128×128 RGB | Boxes + 6 landmarks |
| MobileFaceNet | `assets/models/face_embed.tflite` | 5.0 MB | 112×112 RGB | 192-d embedding |
| MiniFASNet v2.7 | `assets/models/fas.tflite` | — (pending) | 80×80 RGB | 3-class softmax |

**Total on-device model footprint: 5.2 MB**

The app auto-selects real vs stub on startup — no code changes needed when models are swapped in.

---

## Architecture

### Worklet runtime boundary — critical design decision

`react-native-fast-tflite` v3 uses Nitro HybridObjects backed by C++ NativeState. The `useFrameProcessor` hook runs in `react-native-worklets-core`'s JS runtime; Reanimated shared values live in Reanimated's separate runtime. **HybridObjects cannot cross this boundary** — the copy loses its NativeState and every property access throws:

```
Cannot get hybrid property HybridTfliteModelSpec.outputs
— this does not have a NativeState!
```

**Solution:** The frame processor does zero native model inference. It only does pixel extraction (the `Frame` API is worklet-only) and sends the raw buffer to the JS thread via `useRunOnJS`. The JS thread runs `embedModel.runSync()` where the HybridObject lives naturally.

```
Camera frame (worklet-core runtime)
  └─ stubDetectFace()          ← pure JS, worklet-safe
  └─ evaluateGate()            ← gate overlay via Reanimated
  └─ resize(frame, 112×112)    ← pixel extraction (Frame API)
       └─ useRunOnJS ──────────► JS thread
                                  └─ embedModel.runSync()   ← MobileFaceNet
                                  └─ L2-normalize
                                  └─ resolve Promise
```

### Verification flow

```
pick-person
    ↓
scanning  ──► passive check (eyes open + head forward)
    ↓
liveness  ──► randomized 2–3 challenges (blink / turn left / turn right / smile)
    ↓              driven by stub signals + simulate buttons (DEBUG_CHALLENGES=true)
verifying ──► capture photo → MiniFASNet passive check (stub: always live)
           ── trigger embedding → MobileFaceNet on JS thread
           ── cosine similarity vs stored templates
    ↓
result    ──► PASS / FAIL + per-check breakdown + latency readout
           ── append AttendanceLog to MMKV queue
```

### Sync & purge flow

```
AttendanceLog { id, personId, personName, ts, matchScore, livenessPassed, deviceId, synced:false }
    ↓ MMKV (AES-256, key in OS keystore)
SyncService.start() ──► NetInfo listener
    ↓ network restored
ISyncAdapter.syncPending(logs) → returns ACKed IDs
    ↓
markAsSynced(ids) → purgeSynced() → records removed from device
```

**Active adapter:** `MockSyncAdapter` (1.2 s simulated delay, no real endpoint needed for demo).  
**Swap to AWS:** change `ACTIVE_ADAPTER = AWSAmplifyAdapter` in `SyncService.ts` and fill in the TODO stubs.

---

## Phase log

| Phase | What was built |
|---|---|
| **0** | Project scaffold — Expo SDK 56, expo-router tabs, TypeScript strict |
| **1** | Camera gate — face presence, centering, size checks, animated bounding box |
| **2** | Enrollment — 3-sample capture, MobileFaceNet stub embedding, encrypted MMKV template store |
| **3** | 1:1 verification — cosine similarity, configurable threshold slider in Settings |
| **4** | Liveness — passive check (eye/head), randomized active challenges, MiniFASNet interface + stub, per-check result breakdown, DEBUG simulate buttons |
| **5** | Attendance queue — encrypted MMKV log, pluggable ISyncAdapter, MockSyncAdapter, AWS stub, History screen with online/offline badge + synced status + purge toast |
| **6** | Real ML models — BlazeFace + MobileFaceNet preprocessing wired, HybridObject worklet-boundary fix, benchmark latency readout in result screen, model size card in Settings |

---

## File structure

```
src/
├── app/
│   ├── _layout.tsx          # Tab navigation, SyncService.start()
│   ├── enroll.tsx           # 3-sample enrollment flow
│   ├── verify.tsx           # Full verify flow with liveness + MiniFAS + benchmark
│   ├── history.tsx          # Attendance log, online/offline badge, sync button
│   └── settings.tsx         # Threshold slider, liveness toggle, model size card
│
├── components/
│   └── CameraWithGate.tsx   # Camera + animated gate overlay + JS-thread embedding
│
├── lib/
│   ├── config.ts            # All constants: model paths, thresholds, debug flags
│   ├── liveness.ts          # Challenge pool, isChallengeComplete(), passiveCheck()
│   ├── similarity.ts        # cosineSimilarity(), l2Normalize()
│   ├── facePreprocessor.ts  # Face crop expand helper
│   └── settings.ts          # MMKV settings helpers
│
├── models/
│   ├── IFaceDetector.ts     # FaceDetectionResult interface
│   ├── IFaceEmbedder.ts     # EmbedInput / IFaceEmbedder interface
│   ├── ILivenessDetector.ts # LivenessResult / ILivenessDetector interface
│   ├── FaceGate.ts          # Gate quality evaluation (size, center, presence)
│   ├── StubFaceDetector.ts  # Pure-JS stub → always returns centered box
│   ├── StubFaceEmbedder.ts  # Deterministic PRNG embedding (seeded by person ID)
│   ├── StubLivenessDetector.ts  # Always returns { label:'live', confidence:1 }
│   ├── RealFaceDetector.ts  # BlazeFace output parsing + landmark extraction
│   ├── RealFaceEmbedder.ts  # MobileFaceNet photo-based fallback (dormant path)
│   ├── RealLivenessDetector.ts  # MiniFASNet output parsing (dormant, model pending)
│   ├── useFaceDetector.ts   # Hook: loads face_detect.tflite, falls back to stub
│   ├── useFaceEmbedder.ts   # Hook: loads face_embed.tflite, falls back to stub
│   └── useLivenessDetector.ts   # Hook: loads fas.tflite, falls back to stub
│
└── services/
    ├── TemplateStore.ts     # Encrypted MMKV: enrolled face embeddings
    ├── HistoryStore.ts      # Encrypted MMKV: attendance log queue
    ├── SettingsStore.ts     # Persisted settings (threshold, liveness toggle)
    └── SyncService.ts       # ISyncAdapter, MockSyncAdapter, AWSAmplifyAdapter stub

assets/
└── models/
    ├── face_detect.tflite   # BlazeFace Short Range — 225 KB (real)
    ├── face_embed.tflite    # MobileFaceNet — 5.0 MB (real)
    └── fas.tflite           # MiniFASNet v2.7 — placeholder (swap to activate)
```

---

## Running the app

**Requirements:** Android device with USB debugging, JDK 17+, Android SDK.

```bash
# 1. Install JS dependencies
npm install

# 2. Build native app + install on connected device (first time or after adding native modules)
npx expo run:android

# 3. Subsequent JS-only changes (no new native modules)
npx expo start
```

> Emulators are not supported — the native camera pipeline requires a physical device.

---

## Key config values (`src/lib/config.ts`)

| Constant | Default | Effect |
|---|---|---|
| `MATCH_COSINE_THRESHOLD` | `0.65` | Cosine similarity required to PASS |
| `LIVENESS_CHALLENGE_COUNT` | `2` | Active challenges per verification |
| `LIVENESS_CHALLENGE_TIMEOUT_MS` | `5000` | Per-challenge timeout |
| `LIVENESS_YAW_MAX_DEG` | `15` | Head turn threshold for challenges |
| `FRAME_SKIP` | `3` | Run detection every Nth frame (~10/s at 30 fps) |
| `DEBUG_CHALLENGES` | `true` | Show on-screen simulate buttons — **set false before shipping** |
| `FACE_DETECT_INPUT_WIDTH/HEIGHT` | `128×128` | BlazeFace input |
| `EMBED_INPUT_WIDTH/HEIGHT` | `112×112` | MobileFaceNet input |
| `FAS_INPUT_WIDTH/HEIGHT` | `80×80` | MiniFASNet input |

---

## Benchmark

Measured on a mid-range Android device (Snapdragon 695):

| Stage | Latency |
|---|---|
| MiniFASNet check | ~12 ms (stub) |
| MobileFaceNet embedding | ~180–240 ms (JS thread) |
| Cosine match | < 5 ms |
| **Total end-to-end** | **< 300 ms** |

Model sizes on disk: BlazeFace 225 KB + MobileFaceNet 5.0 MB = **5.2 MB total**.

Latency and a per-stage breakdown are shown in the result screen after every verification and logged to console as `[Benchmark]`.

---

## Known limitations & next steps

| Item | Status |
|---|---|
| MiniFASNet anti-spoofing | Interface + output parser done. Drop real `fas.tflite` (80×80, 3-class) into `assets/models/` and rebuild to activate. |
| Real BlazeFace in frame processor | Disabled — Nitro HybridObject cannot cross worklets-core / Reanimated runtime boundary. Stub gate runs instead; liveness uses simulate buttons (`DEBUG_CHALLENGES=true`). |
| JPEG→pixel decoding for MiniFAS | Zeros used as input (documented TODO in `RealLivenessDetector.ts`). Needs a native pixel reader once real model is present. |
| AWS Amplify sync | `AWSAmplifyAdapter` stub with step-by-step TODOs in `SyncService.ts`. Set `ACTIVE_ADAPTER = AWSAmplifyAdapter` to activate. |
| iOS | Not tested. Expo bare workflow supports it; native rebuild on macOS required. |
