# Secure Offline Facial Recognition & Liveness Detection System

This repository contains a highly accurate, lightweight, and entirely offline facial recognition and liveness detection system built with React Native. It is designed specifically to integrate seamlessly into standard mobile devices (Android and iOS) to authenticate field personnel securely in zero-network zones.

## What We Are Doing
We are addressing the critical problem of authenticating field personnel in remote locations without internet connectivity. 
*   **Fully Offline:** All machine learning inference, liveness detection, and data storage happen securely on the device without relying on cloud APIs.
*   **Anti-Spoofing:** Implements rigorous passive (head yaw/eye state) and active (randomized blink/smile challenges) liveness detection to prevent authentication fraud via photos or screens.
*   **Sync & Purge:** securely queues verified attendance logs locally and automatically syncs them to the backend server (AWS) once internet connectivity is restored, instantly purging the local cache for data security.

## What Is Being Used & How They Are Used

*   **React Native & Expo SDK 56:** Framework for building the cross-platform application natively on Android and iOS.
*   **Vision Camera (`react-native-vision-camera`):** Provides high-performance camera access directly integrating with native C++ worklets.
*   **Worklets (`react-native-worklets-core`):** Allows us to bypass the JS bridge and execute ML inference synchronously on the native camera thread at 60 FPS.
*   **Fast TFLite (`react-native-fast-tflite`):** Loads and runs our `BlazeFace` and `MobileFaceNet` TensorFlow Lite models efficiently using the native C++ API.
*   **MMKV (`react-native-mmkv`):** An ultra-fast key-value store used to save the enrolled facial embeddings and the offline attendance logs.
*   **Secure Store (`expo-secure-store`):** Generates and securely stores the cryptographic keys used to encrypt the local MMKV database, ensuring sensitive biometric and attendance data cannot be compromised.
*   **NetInfo (`@react-native-community/netinfo`):** Listens to device connectivity state changes to trigger background syncing of the attendance queue when a network becomes available.

## File Structure

```text
offline-face-recognition/
├── src/
│   ├── app/                  # Expo Router Screens
│   │   ├── _layout.tsx       # Navigation & SyncService Initialization
│   │   ├── enroll.tsx        # Face enrollment screen
│   │   ├── verify.tsx        # Authentication & Active Liveness screen
│   │   ├── history.tsx       # Attendance Log UI & Sync Status
│   │   └── settings.tsx      # App configurations & threshold tuning
│   ├── components/
│   │   └── CameraWithGate.tsx # Camera + Face Gate + In-frame-processor embedding
│   ├── lib/
│   │   ├── config.ts         # Model paths, DB keys, and threshold constants
│   │   ├── liveness.ts       # Challenge pool, passive/active liveness checks
│   │   ├── facePreprocessor.ts # Image manipulation (crop/expand logic)
│   │   └── similarity.ts     # Cosine similarity & L2 normalization for 192-d vectors
│   ├── models/               # ML Integration Layer
│   │   ├── FaceGate.ts       # Evaluates detection quality (size, centre, presence)
│   │   ├── IFaceDetector.ts  # Interface for detector output types
│   │   ├── IFaceEmbedder.ts  # Interface for embedder input/output types
│   │   ├── RealFaceDetector.ts # BlazeFace tensor parsing → boxes + landmarks
│   │   ├── RealFaceEmbedder.ts # MobileFaceNet embedding (photo-based fallback)
│   │   ├── StubFaceDetector.ts # Stub detector (active when no real model loaded)
│   │   ├── StubFaceEmbedder.ts # Stub embedder (deterministic PRNG vectors)
│   │   ├── useFaceDetector.ts  # Hook: loads BlazeFace TFLite model
│   │   └── useFaceEmbedder.ts  # Hook: loads MobileFaceNet + stub fallback
│   └── services/             # Data & State Management
│       ├── TemplateStore.ts  # Encrypted MMKV store for enrolled face embeddings
│       ├── HistoryStore.ts   # Encrypted MMKV store for offline attendance logs
│       ├── SettingsStore.ts  # Persisted user settings (threshold, liveness toggle)
│       └── SyncService.ts    # Background uploader with retry & data purge
├── assets/
│   └── models/               # Real TFLite models (BlazeFace + MobileFaceNet)
├── ARCHITECTURE.md           # System architecture & integration guide
└── package.json              # Project dependencies
```

## How One Should Use It

### 1. Prerequisites & Model Setup
The repository ships with real, validated TFLite models in `assets/models/`:
*   **Detector**: `face_detect.tflite` — BlazeFace Short Range (~225 KB, MediaPipe)
*   **Embedder**: `face_embed.tflite` — MobileFaceNet (~5 MB, 192-d embeddings)

No additional model downloads are required. The app auto-detects valid models on startup.

### 2. Build the Native Application
Because this project utilizes custom C++ modules (Worklets and TFLite execution), you must build a native client on a physical device. Emulators are not supported for native camera pipelines.
1. Connect your Android device via USB (ensure USB Debugging is enabled).
2. Install JS dependencies: `npm install`
3. Compile and run the native app: `npx expo run:android`

### 3. Usage Flow
1. **Enrollment**: Open the app and navigate to the **Enroll** tab. Align your face with the bounding box, capture the photo, and enter your name to save your secure embedding to the encrypted local database.
2. **Verification (Offline)**: Disconnect from the internet (Airplane mode). Go to the **Verify** tab. The system will detect your face, prompt you to complete a randomized liveness challenge (e.g., "Turn your head right"), and instantly authenticate you against your enrolled profile.
3. **Queue & Sync**: A successful verification creates a timestamped log in the **History** tab marked as "Queued". Reconnect to the internet; the `SyncService` will detect the connection, automatically push the log to the server, and immediately purge the sensitive local cache.
