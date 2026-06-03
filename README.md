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
*   **Fast TFLite (`react-native-fast-tflite`):** Loads and runs our `BlazeFace`, `MobileFaceNet`, and `MiniFASNet` TensorFlow Lite models efficiently using the native C++ API.
*   **MMKV (`react-native-mmkv`):** An ultra-fast key-value store used to save the enrolled facial embeddings and the offline attendance logs.
*   **Secure Store (`expo-secure-store`):** Generates and securely stores the cryptographic keys used to encrypt the local MMKV database, ensuring sensitive biometric and attendance data cannot be compromised.
*   **NetInfo (`@react-native-community/netinfo`):** Listens to device connectivity state changes to trigger background syncing of the attendance queue when a network becomes available.

## File Structure

```text
offline-face-recognition/
├── src/
│   ├── app/                # Expo Router Screens
│   │   ├── _layout.tsx     # Navigation & SyncService Initialization
│   │   ├── enroll.tsx      # Face enrollment screen
│   │   ├── verify.tsx      # Authentication & Active Liveness screen
│   │   ├── history.tsx     # Attendance Log UI & Sync Status
│   │   └── settings.tsx    # App configurations & threshold tuning
│   ├── components/
│   │   └── CameraWithGate.tsx # Core Camera View with Real-time ML Worklet pipeline
│   ├── lib/
│   │   ├── config.ts       # TFLite Model paths, DB Keys, and threshold constants
│   │   ├── facePreprocessor.ts # Image manipulation (crop/expand logic)
│   │   └── similarity.ts   # Cosine similarity logic for comparing 192-d vectors
│   ├── models/             # ML Integration Layer
│   │   ├── FaceGate.ts     # Evaluates detection and liveness logic continuously
│   │   ├── IFaceDetector.ts# Interface for detector output
│   │   ├── RealFaceDetector.ts # Parses BlazeFace tensors to bounding boxes and landmarks
│   │   ├── RealFaceEmbedder.ts # Prepares pixels and runs MobileFaceNet
│   │   └── useFaceDetector.ts  # React Hook for loading TFLite Models dynamically
│   └── services/           # Data & State Management
│       ├── EmbeddingStore.ts # MMKV interface for enrolled faces
│       ├── HistoryStore.ts   # MMKV interface for queued offline attendance logs
│       └── SyncService.ts    # Background uploader & data purge logic
├── assets/
│   └── models/             # Place real `.tflite` model files here!
├── ARCHITECTURE.md         # Detailed Hackathon system architectural overview
└── package.json            # Project dependencies
```

## How One Should Use It

### 1. Prerequisites & Model Setup
Before running the application, you must provide the real pre-trained machine learning models:
1. Download or acquire your TFLite models:
    *   **Detector**: `face_detect.tflite` (e.g., BlazeFace Short Range)
    *   **Embedder**: `face_embed.tflite` (e.g., MobileFaceNet)
    *   **Liveness**: `fas.tflite` (e.g., MiniFASNet)
2. Place these three `.tflite` files directly into the `assets/models/` directory in the root of the project.

### 2. Build the Native Application
Because this project utilizes custom C++ modules (Worklets and TFLite execution), you must build a native client on a physical device. Emulators are not supported for native camera pipelines.
1. Connect your Android device via USB (ensure USB Debugging is enabled).
2. Install JS dependencies: `npm install`
3. Compile and run the native app: `npx expo run:android`

### 3. Usage Flow
1. **Enrollment**: Open the app and navigate to the **Enroll** tab. Align your face with the bounding box, capture the photo, and enter your name to save your secure embedding to the encrypted local database.
2. **Verification (Offline)**: Disconnect from the internet (Airplane mode). Go to the **Verify** tab. The system will detect your face, prompt you to complete a randomized liveness challenge (e.g., "Turn your head right"), and instantly authenticate you against your enrolled profile.
3. **Queue & Sync**: A successful verification creates a timestamped log in the **History** tab marked as "Queued". Reconnect to the internet; the `SyncService` will detect the connection, automatically push the log to the server, and immediately purge the sensitive local cache.
