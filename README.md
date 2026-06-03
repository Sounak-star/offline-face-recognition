# Offline Face Recognition — Attendance / Auth App

Fully offline facial-recognition attendance system built with Expo SDK 56 / React Native 0.85 (New Architecture). All ML inference runs on-device; no network required to enroll or verify.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 LTS or 20 LTS |
| npm | 10+ |
| Java (JDK) | 17 (required by Gradle) |
| Android SDK | API 26+ (Android 8+) |
| `adb` | in PATH — verify with `adb devices` |
| Physical Android device | USB debugging enabled, connected via USB |

> **No emulator.** Camera + native ML only work reliably on a physical device.

---

## First-time setup

```bash
# 1. Install JS dependencies
npm install

# 2. Build the native dev-build and install on the connected device
#    (required after any native module install/update)
npx expo run:android
```

The build takes 3–5 minutes on first run. Subsequent JS-only changes can be
reloaded with `r` in the Metro terminal — no rebuild needed.

---

## Day-to-day development

```bash
# Start Metro bundler (after the dev-build is already on the device)
npx expo start --dev-client
```

Press `a` to open on the connected Android device, or scan the QR code with the
Expo Dev Client app.

---

## Rebuilding the native layer

Run this any time you add / remove a native package:

```bash
npx expo run:android
```

---

## Project structure

```
src/
  app/          # Expo Router screens (enroll, verify, history, settings)
  components/   # Shared UI components
  lib/          # config.ts, storage helpers, crypto utils
  models/       # ML interfaces and TFLite implementations
  services/     # Embedding service, matching, sync
assets/
  models/       # ← DROP .tflite MODEL FILES HERE (see below)
  images/
```

---

## DROP MODELS HERE

Place the following `.tflite` model files in `assets/models/` before running
Phase 1 ML integration:

| File | Purpose | Max size |
|---|---|---|
| `face_detect.tflite` | Face detection (input 128×128) | 4 MB |
| `face_embed.tflite` | Face embedding / MobileFaceNet (input 112×112) | 16 MB |

**Total budget: < 20 MB combined.**

Recommended open-source models:
- Detection: [MediaPipe BlazeFace](https://developers.google.com/mediapipe/solutions/vision/face_detector) (short-range, ~1 MB)
- Embedding: [MobileFaceNet](https://github.com/sirius-ai/MobileFaceNet_TF) quantised INT8 (~5 MB)

The model paths and input sizes are configured in [`src/lib/config.ts`](src/lib/config.ts).

---

## Environment variables

None required for offline operation.

---

## Running on device checklist

- [ ] USB debugging enabled on the device (`Settings > Developer options`)
- [ ] Device appears in `adb devices`
- [ ] Camera permission granted when prompted on first launch
- [ ] `assets/models/` populated before Phase 1 ML work
