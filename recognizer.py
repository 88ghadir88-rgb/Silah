"""
SignConnect - sign-language recognition service (runs on the cloud backend).

Pipeline (for one sign):
  browser webcam -> MediaPipe Holistic (in the browser) -> landmarks of lips, hands and arms
  for every frame -> sent here as JSON -> this file builds the model input -> the pre-trained
  ASL model (models/asl_islr/model.tflite) predicts probabilities for 250 ASL signs ->
  we keep only SignConnect's small VOCABULARY -> accept or reject using confidence thresholds.

Nothing here is hard-coded: the label always comes from the model's output.
"""

import json
import os
import threading
import time

import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models", "asl_islr")
MODEL_PATH = os.path.join(MODEL_DIR, "model.tflite")
LABELS_PATH = os.path.join(MODEL_DIR, "labels.json")

# ---------------------------------------------------------------------------
# SignConnect vocabulary: a subset of the model's 250 ASL signs.
# Chosen because they are useful in a phone call AND are mostly one-handed signs with a
# clear movement (the kind this model recognizes best).
# To change it: use names exactly as written in models/asl_islr/labels.json, and add the
# matching phrase in static/js/config.js.
# ---------------------------------------------------------------------------
VOCABULARY = [
    "yes", "no", "thankyou", "please", "hello",
    "bye", "callonphone", "tomorrow", "time", "later",
]

# Acceptance rules (make the demo reliable instead of guessing):
MIN_FRAMES = 8           # at least 8 frames with a visible hand
MIN_CONFIDENCE = 0.45    # probability among the vocabulary signs
MAX_GLOBAL_RANK = 15     # the sign must also be in the model's top 15 of all 250 signs

# Indices inside the 543-landmark layout the model was trained on.
FACE_START, LEFT_HAND_START, POSE_START, RIGHT_HAND_START = 0, 468, 489, 522
# 40 lip landmarks (MediaPipe face-mesh numbering) used by the model.
LIPS_INDICES = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    291, 146, 91, 181, 84, 17, 314, 405, 321, 375,
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
    95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
]
# Pose landmarks used by the model: 13-22 (elbows, wrists, and finger points of both arms).
POSE_INDICES = list(range(13, 23))

MAX_FRAMES = 240


class SignRecognizer:
    def __init__(self):
        self.ready = False
        self.error = None
        self.labels = []
        self.vocab_idx = []
        self._lock = threading.Lock()  # the TFLite interpreter must not run two requests at once
        self._runner = None
        try:
            from ai_edge_litert import interpreter as litert

            with open(LABELS_PATH, encoding="utf-8") as f:
                self.labels = json.load(f)
            missing = [s for s in VOCABULARY if s not in self.labels]
            if missing:
                raise ValueError("VOCABULARY contains signs the model does not know: %s" % missing)
            self.vocab_idx = [self.labels.index(s) for s in VOCABULARY]
            interpreter = litert.Interpreter(
                MODEL_PATH,
                # The default XNNPACK accelerator cannot handle this model's variable length input.
                experimental_op_resolver_type=litert.OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES,
            )
            self._runner = interpreter.get_signature_runner("serving_default")
            # Warm-up run so the first real request is fast.
            self._runner(inputs=np.full((10, 543, 3), np.nan, dtype=np.float32))
            self.ready = True
        except Exception as exc:  # keep the web app running even if the model cannot load
            self.error = "%s: %s" % (type(exc).__name__, exc)

    def info(self):
        return {
            "ready": self.ready,
            "error": self.error,
            "model": "Pre-trained ASL isolated-sign model (TFLite, 250 signs, Google ISLR data)",
            "vocabulary": VOCABULARY,
            "total_signs_in_model": len(self.labels),
            "thresholds": {
                "min_frames": MIN_FRAMES,
                "min_confidence": MIN_CONFIDENCE,
                "max_global_rank": MAX_GLOBAL_RANK,
            },
        }

    @staticmethod
    def build_input(frames):
        """frames: list of {"lips": [x,y]*40 | null, "left": [x,y]*21 | null,
        "right": [x,y]*21 | null, "pose": [x,y]*10 | null}  ->  float32 [T, 543, 3] with NaN."""
        frames = frames[:MAX_FRAMES]
        data = np.full((len(frames), 543, 3), np.nan, dtype=np.float32)
        hand_frames = 0

        def put(t, indices, values, count):
            if not isinstance(values, list) or len(values) != count * 2:
                return False
            xy = np.asarray(values, dtype=np.float32).reshape(count, 2)
            data[t, indices, 0:2] = xy
            data[t, indices, 2] = 0.0  # z is not used by the model
            return True

        for t, frame in enumerate(frames):
            if not isinstance(frame, dict):
                continue
            put(t, [FACE_START + i for i in LIPS_INDICES], frame.get("lips"), 40)
            left = put(t, list(range(LEFT_HAND_START, LEFT_HAND_START + 21)), frame.get("left"), 21)
            right = put(t, list(range(RIGHT_HAND_START, RIGHT_HAND_START + 21)), frame.get("right"), 21)
            put(t, [POSE_START + i for i in POSE_INDICES], frame.get("pose"), 10)
            if left or right:
                hand_frames += 1
        return data, hand_frames

    def recognize(self, frames):
        if not self.ready:
            raise RuntimeError("Sign model is not loaded: %s" % self.error)
        t0 = time.perf_counter()
        data, hand_frames = self.build_input(frames)
        if hand_frames < MIN_FRAMES:
            return {
                "accepted": False,
                "reason": "Not enough frames with a visible hand (%d, need %d)." % (hand_frames, MIN_FRAMES),
                "sign": None, "confidence": 0.0, "frames": len(frames), "hand_frames": hand_frames,
                "inference_ms": 0, "top_all": [], "top_vocabulary": [],
            }
        with self._lock:
            probs = np.asarray(self._runner(inputs=data)["outputs"], dtype=np.float64)
        inference_ms = round((time.perf_counter() - t0) * 1000, 1)

        order = np.argsort(-probs)
        rank_of = {int(idx): rank + 1 for rank, idx in enumerate(order)}
        vocab_probs = probs[self.vocab_idx]
        total = float(vocab_probs.sum()) or 1e-9
        vocab_ranked = sorted(
            ({"sign": VOCABULARY[i], "confidence": round(float(vocab_probs[i]) / total, 4),
              "model_probability": round(float(vocab_probs[i]), 4),
              "global_rank": rank_of[self.vocab_idx[i]]} for i in range(len(VOCABULARY))),
            key=lambda item: -item["confidence"],
        )
        best = vocab_ranked[0]
        accepted = best["confidence"] >= MIN_CONFIDENCE and best["global_rank"] <= MAX_GLOBAL_RANK
        if accepted:
            reason = "ok"
        elif best["global_rank"] > MAX_GLOBAL_RANK:
            reason = "The movement did not look like any SignConnect sign (closest: %s)." % best["sign"]
        else:
            reason = "Not confident enough (%d%%). Please sign again." % round(best["confidence"] * 100)
        return {
            "accepted": accepted,
            "reason": reason,
            "sign": best["sign"] if accepted else None,
            "closest": best["sign"],
            "confidence": best["confidence"],
            "frames": len(frames),
            "hand_frames": hand_frames,
            "inference_ms": inference_ms,
            "top_vocabulary": vocab_ranked[:5],
            "top_all": [{"sign": self.labels[int(i)], "probability": round(float(probs[int(i)]), 4)}
                        for i in order[:5]],
        }


recognizer = SignRecognizer()
