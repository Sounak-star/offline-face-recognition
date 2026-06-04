# Drop TFLite models here

See the README for required filenames, input sizes, and recommended sources.

Expected files:
- `face_detect.tflite`   — face detection (BlazeFace Short Range), input 128×128 RGB float32
- `face_embed.tflite`    — face embedding (MobileFaceNet), input 112×112 RGB float32, output 192-d vector
- `fas.tflite`           — anti-spoofing (MiniFASNet v2.7), input 80×80 RGB float32, output 3-class softmax [print, replay, live]
