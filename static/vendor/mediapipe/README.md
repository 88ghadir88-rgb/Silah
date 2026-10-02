# Vendored MediaPipe files (do not edit)

- `vision_bundle.mjs`, `wasm/*`: npm package `@mediapipe/tasks-vision` version 1.0.1 (Google), Apache License 2.0.
- `holistic_landmarker.task`: MediaPipe Holistic Landmarker model (float16, latest), downloaded from
  https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task
  (Google), Apache License 2.0. It finds the face, body and both hands in every webcam frame.
  Docs: https://ai.google.dev/edge/mediapipe/solutions/vision/holistic_landmarker

They are stored here so the app works without downloading anything from a CDN at demo time.
See LICENSE for the license text.
