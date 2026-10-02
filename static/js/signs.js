// SignConnect - sign recognition, running 100% inside the browser.
//
// Step 1  Google MediaPipe Hand Landmarker (PRE-TRAINED model, Apache-2.0 license) finds the
//         hand in each webcam frame and returns 21 points (landmarks) on the hand.
//         Files are stored locally in static/vendor/mediapipe so it works on bad Wi-Fi.
// Step 2  We turn the 21 points into 63 numbers that describe the HANDSHAPE
//         (position-independent and size-independent).
// Step 3  A k-Nearest-Neighbours classifier compares those numbers with example samples that
//         your team recorded on the Train screen, and votes for the closest sign.
// Step 4  A stabilizer only accepts a sign after it was held steadily for ~0.7 seconds.
//
// The video never leaves the laptop. No GPU is required (it runs on the CPU if needed).

import { FilesetResolver, HandLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";
import { RECOGNITION } from "./config.js";

const VENDOR = new URL("../vendor/mediapipe/", import.meta.url).href;
const MODEL_STORAGE_KEY = "signconnect.signModel.v1";
const FEATURE_VERSION = "mediapipe-hand-21x3-wrist-scaled-v1";

// Pairs of landmark numbers to draw lines between (thumb, fingers, palm).
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// ---------------------------------------------------------------------------
// HandTracker: webcam + MediaPipe
// ---------------------------------------------------------------------------
export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.running = false;
    this.listeners = new Set();
    this.inferenceMs = 0;   // moving average of the time the model needs per frame
    this.fps = 0;
    this.delegate = "";
    this.lastVideoTime = -1;
  }

  async loadModel() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(VENDOR + "wasm");
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: VENDOR + "hand_landmarker.task", delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    // Default = CPU: predictable on every laptop, no GPU needed.
    // Add ?gpu=1 to the page address to try the graphics chip (can be faster, sometimes buggy).
    const tryGpu = new URLSearchParams(location.search).get("gpu") === "1";
    if (tryGpu) {
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
        this.delegate = "GPU (WebGL)";
        return;
      } catch (error) {
        console.warn("GPU delegate failed, using CPU instead", error);
      }
    }
    this.landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
    this.delegate = "CPU";
  }

  // Starts the webcam and the detection loop. video/canvas are HTML elements on the page.
  async start(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    await this.loadModel();
    if (!this.stream) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access the camera. Use Chrome, and open the page via http://localhost or https://");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    }
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    if (!this.running) {
      this.running = true;
      this.loop();
    }
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.clearCanvas();
  }

  onFrame(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loop() {
    if (!this.running) return;
    const video = this.video;
    if (video && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const t0 = performance.now();
      const result = this.landmarker.detectForVideo(video, t0);
      const t1 = performance.now();
      this.inferenceMs = this.inferenceMs ? this.inferenceMs * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
      if (this.lastFrameAt) {
        const fps = 1000 / (t1 - this.lastFrameAt);
        this.fps = this.fps ? this.fps * 0.9 + fps * 0.1 : fps;
      }
      this.lastFrameAt = t1;

      const landmarks = result.landmarks?.[0] || null;
      const handedness = result.handedness?.[0]?.[0]?.categoryName || "Right";
      this.draw(landmarks);
      const frame = {
        time: t1,
        landmarks,
        handedness,
        features: landmarks ? toFeatures(landmarks) : null,
      };
      for (const listener of this.listeners) listener(frame);
    }
    requestAnimationFrame(() => this.loop());
  }

  clearCanvas() {
    if (!this.canvas) return;
    this.canvas.getContext("2d").clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(landmarks) {
    const canvas = this.canvas;
    if (!canvas) return;
    const width = this.video.videoWidth || 640;
    const height = this.video.videoHeight || 480;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
      ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
      ctx.stroke();
    }
    ctx.fillStyle = "#14b8a6";
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 21 landmarks -> 63 numbers. Wrist = origin, divided by the palm size, so the numbers describe
// the SHAPE of the hand, not where it is or how close it is to the camera.
// (We deliberately do not mirror left hands: MediaPipe's left/right guess can flicker, which
// would make the numbers jump. A left-handed signer simply records their own samples.)
export function toFeatures(landmarks) {
  const wrist = landmarks[0];
  const middleBase = landmarks[9];
  const scale = Math.hypot(middleBase.x - wrist.x, middleBase.y - wrist.y, middleBase.z - wrist.z) || 1;
  const features = [];
  for (const point of landmarks) {
    features.push((point.x - wrist.x) / scale);
    features.push((point.y - wrist.y) / scale);
    features.push((point.z - wrist.z) / scale);
  }
  return features;
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// SignClassifier: k-Nearest-Neighbours on handshape features
// ---------------------------------------------------------------------------
export class SignClassifier {
  constructor() {
    this.samples = {};       // signId -> array of feature arrays
    this.rejectDistance = Infinity;
    this.source = "empty";   // where the model came from: "browser", "bundled file", "imported file"
  }

  count(signId) {
    return this.samples[signId]?.length || 0;
  }

  totalSamples() {
    return Object.values(this.samples).reduce((sum, list) => sum + list.length, 0);
  }

  trainedSigns() {
    return Object.keys(this.samples).filter((id) => this.samples[id].length > 0);
  }

  isReady() {
    return this.trainedSigns().length >= 2;
  }

  addSample(signId, features) {
    (this.samples[signId] ||= []).push(features.map((v) => Math.round(v * 10000) / 10000));
  }

  clear(signId) {
    if (signId) delete this.samples[signId];
    else this.samples = {};
    this.prepare();
  }

  // Works out how far away a hand may be from all samples before we say "not a known sign".
  prepare() {
    const all = [];
    for (const [label, list] of Object.entries(this.samples)) for (const f of list) all.push({ label, f });
    const nearest = [];
    for (let i = 0; i < all.length; i++) {
      let best = Infinity;
      for (let j = 0; j < all.length; j++) {
        if (i !== j && all[i].label === all[j].label) best = Math.min(best, distance(all[i].f, all[j].f));
      }
      if (best < Infinity) nearest.push(best);
    }
    if (nearest.length < 5) {
      this.rejectDistance = Infinity;
      return;
    }
    nearest.sort((a, b) => a - b);
    const p95 = nearest[Math.floor(nearest.length * 0.95)];
    this.rejectDistance = Math.max(p95 * RECOGNITION.rejectFactor, 0.15);
  }

  // Returns { label, confidence, distance } or null when no sign is recognized.
  predict(features) {
    if (!features || !this.isReady()) return null;
    const neighbours = [];
    for (const [label, list] of Object.entries(this.samples)) {
      for (const f of list) neighbours.push({ label, d: distance(features, f) });
    }
    neighbours.sort((a, b) => a.d - b.d);
    const top = neighbours.slice(0, RECOGNITION.k);
    const votes = {};
    for (const n of top) votes[n.label] = (votes[n.label] || 0) + 1;
    const [label, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    const closest = top.find((n) => n.label === label).d;
    const confidence = count / top.length;
    if (closest > this.rejectDistance) return { label: null, confidence: 0, distance: closest };
    return { label, confidence, distance: closest };
  }

  toJSON() {
    return {
      format: "signconnect-sign-model",
      feature: FEATURE_VERSION,
      created_at: new Date().toISOString(),
      samples: this.samples,
    };
  }

  load(data, source) {
    if (!data || data.format !== "signconnect-sign-model" || typeof data.samples !== "object") {
      throw new Error("This file is not a SignConnect sign model.");
    }
    if (data.feature !== FEATURE_VERSION) throw new Error("This sign model was made with a different app version.");
    this.samples = {};
    for (const [label, list] of Object.entries(data.samples)) {
      if (Array.isArray(list)) this.samples[label] = list.filter((f) => Array.isArray(f) && f.length === 63);
    }
    this.source = source;
    this.prepare();
  }

  saveToBrowser() {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(this.toJSON()));
      this.source = "this browser";
    } catch (e) {
      console.warn("Could not save the sign model in this browser", e);
    }
  }

  // Load order: 1) samples saved in this browser, 2) static/models/sign_model.json in the repo.
  async loadBest() {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved) {
        this.load(JSON.parse(saved), "this browser");
        if (this.totalSamples() > 0) return;
      }
    } catch (e) {
      console.warn("Saved sign model is broken, ignoring it", e);
    }
    await this.loadBundled();
  }

  async loadBundled() {
    try {
      const response = await fetch("/static/models/sign_model.json", { cache: "no-store" });
      this.load(await response.json(), "bundled file (static/models/sign_model.json)");
    } catch (e) {
      console.warn("No bundled sign model", e);
      this.samples = {};
      this.source = "empty";
      this.prepare();
    }
  }

  forgetBrowserCopy() {
    try { localStorage.removeItem(MODEL_STORAGE_KEY); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// SignStabilizer: turns noisy frame-by-frame guesses into clean, single sign events.
// ---------------------------------------------------------------------------
export class SignStabilizer {
  constructor(onSign) {
    this.onSign = onSign;
    this.reset();
  }

  reset() {
    this.candidate = null;
    this.since = 0;
    this.locked = null;      // the sign we just emitted; must be released before it can repeat
    this.releasedAt = 0;
    this.progress = 0;
  }

  // prediction = result of SignClassifier.predict (or null), time = performance.now()
  feed(prediction, time) {
    const label = prediction && prediction.label && prediction.confidence >= RECOGNITION.minConfidence
      ? prediction.label : null;

    if (this.locked) {
      // Wait until the hand changes shape (or disappears) for 300 ms before accepting a new sign.
      if (label !== this.locked) {
        if (!this.releasedAt) this.releasedAt = time;
        if (time - this.releasedAt > 300) { this.locked = null; this.releasedAt = 0; }
      } else {
        this.releasedAt = 0;
      }
      this.progress = 0;
      return { label, progress: 0, locked: this.locked };
    }

    if (label !== this.candidate) {
      this.candidate = label;
      this.since = time;
    }
    if (!label) {
      this.progress = 0;
      return { label: null, progress: 0 };
    }
    const held = time - this.since;
    this.progress = Math.min(1, held / RECOGNITION.holdMs);
    if (held >= RECOGNITION.holdMs) {
      this.locked = label;
      this.candidate = null;
      this.onSign({ label, confidence: prediction.confidence, holdMs: Math.round(held) });
      return { label, progress: 1, emitted: true };
    }
    return { label, progress: this.progress };
  }
}
