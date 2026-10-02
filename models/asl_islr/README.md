# Pre-trained ASL sign-language model (do not edit)

| | |
|---|---|
| File | `model.tflite` (TensorFlow Lite, 7.6 MB, runs on CPU) |
| What it does | Classifies an isolated **American Sign Language (ASL)** sign into one of **250 signs** (`labels.json`, alphabetical order = model output order) |
| Input | A sequence of MediaPipe Holistic landmarks, shape `[frames, 543, 3]` (468 face, 21 left hand, 33 pose, 21 right hand), `NaN` where a part is not visible. All preprocessing (dominant-hand detection, normalization, resampling to 64 frames) is **inside** the model. |
| Output | 250 probabilities (softmax) |
| Training data | Google *Isolated Sign Language Recognition* corpus (Kaggle competition `asl-signs`, PopSign): ~94k landmark sequences of isolated signs performed by 21 Deaf signers |
| Architecture | Transformer encoder over lips + dominant hand + arm landmarks |
| Reported validation accuracy | 73.6% top-1 over all 250 signs (author's notebook, `main.ipynb`) |
| Author / source | pradhyumn, https://github.com/pradhyumn/Isolated-sign-language-recognition (commit b2a1072) |
| License | **GNU GPL v3** (see `LICENSE` in this folder) |

## Licence note

The model file is distributed under the GPL-3.0. Using it in this hackathon prototype is fine.
If SignConnect is ever distributed as a product, the GPL's conditions apply to the parts that
include this model. The production roadmap should replace it with a model you train yourselves
(on licensed data, ideally Saudi Sign Language).

## How SignConnect uses it

`recognizer.py` builds the `[frames, 543, 3]` array from the landmarks the browser sends, runs
the model, and then looks only at the signs in SignConnect's small vocabulary
(`VOCABULARY` in `recognizer.py`). A result is accepted only if the model is confident enough
(see the thresholds in `recognizer.py`). Otherwise the app says "not recognized, please sign again".
