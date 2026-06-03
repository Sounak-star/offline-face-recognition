import urllib.request
import os

MODELS = {
    "assets/models/face_detect.tflite": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    "assets/models/face_embed.tflite": "https://raw.githubusercontent.com/ml-gde/Face-recognition-with-TFLite/master/models/mobile_face_net.tflite",
}

for path, url in MODELS.items():
    print(f"Downloading {url} to {path}...")
    try:
        urllib.request.urlretrieve(url, path)
        print(f"Downloaded {os.path.getsize(path)} bytes.")
    except Exception as e:
        print(f"Failed: {e}")
