// SignConnect - webcam capture for sign recognition (runs in the browser).
//
// Step 1  Google MediaPipe Holistic Landmarker (pre-trained, Apache-2.0) finds the face, body
//         and both hands in each webcam frame. Files are in static/vendor/mediapipe (offline).
// Step 2  "Segmentation": a sign starts when a hand appears and ends when the hands go down
//         (no hand visible for 0.5 s) or after 4 seconds.
// Step 3  The landmarks of that sign (lips, both hands, arms - only numbers, no video) are sent
//         to the backend, where the PRE-TRAINED ASL MODEL classifies the sign (recognizer.py).
//
// IMPORTANT: drawing the hand on screen is only DETECTION. The sign label always comes from
// the ASL model's answer at POST /api/recognize - never from this file.

import { FilesetResolver, HolisticLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";

const VENDOR = new URL("../vendor/mediapipe/", import.meta.url).href;

// The 40 lip points the ASL model uses (MediaPipe face-mesh numbering).
const LIPS = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
];
const POSE = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22]; // elbows, wrists, finger points
const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const SEGMENT = {
  prerollFrames: 6,      // keep a few frames from just before the hand appeared
  endAfterNoHandMs: 500, // hands down for 0.5 s = sign finished
  maxMs: 4000,           // never record longer than 4 s
  minHandFrames: 8,      // shorter recordings are ignored
};

const round = (v) => Math.round(v * 10000) / 10000;
const xy = (points, indices) => (indices ? indices.map((i) => points[i]) : points).flatMap((p) => [round(p.x), round(p.y)]);

export class SignCapture {
  // handlers: onSequence({frames, captureMs, handFrames}), onState(state), onFrame(info)
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.landmarker = null;
    this.stream = null;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.proc = document.createElement("canvas"); // portrait crop that the model sees
    this.display = null;
    this.running = false;
    this.paused = false;       // true while a sign is being recognized / sent
    this.landmarkMs = 0;       // moving average: time MediaPipe needs per frame
    this.fps = 0;
    this.delegate = "";
    this.reset();
  }

  reset() {
    this.preroll = [];
    this.recording = null;   // {frames, startedAt, lastHandAt, handFrames}
    this.needRelease = false; // after a 4 s cut-off, wait until the hands go down
  }

  async load() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(VENDOR + "wasm");
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: VENDOR + "holistic_landmarker.task", delegate },
      runningMode: "VIDEO",
    });
    // Default = CPU (works on every laptop). Add ?gpu=1 to the address to try the graphics chip.
    if (new URLSearchParams(location.search).get("gpu") === "1") {
      try {
        this.landmarker = await HolisticLandmarker.createFromOptions(fileset, options("GPU"));
        this.delegate = "GPU";
        return;
      } catch (error) {
        console.warn("GPU failed, using CPU", error);
      }
    }
    this.landmarker = await HolisticLandmarker.createFromOptions(fileset, options("CPU"));
    this.delegate = "CPU";
  }

  async start(displayCanvas) {
    this.display = displayCanvas;
    await this.load();
    if (!this.stream) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot use the camera. Use Chrome on http://localhost or https://");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    }
    this.reset();
    this.paused = false;
    if (!this.running) {
      this.running = true;
      this.lastVideoTime = -1;
      this.loop();
    }
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.reset();
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.reset();
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.processFrame();
    }
    requestAnimationFrame(() => this.loop());
  }

  processFrame() {
    // The ASL model was trained on phone videos (portrait). Crop the middle of the webcam
    // image to portrait 3:4 so the person's position looks similar to the training data.
    const v = this.video;
    const h = v.videoHeight;
    const w = Math.min(v.videoWidth, Math.round((h * 3) / 4));
    const sx = Math.round((v.videoWidth - w) / 2);
    if (this.proc.width !== w) { this.proc.width = w; this.proc.height = h; }
    this.proc.getContext("2d").drawImage(v, sx, 0, w, h, 0, 0, w, h);

    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(this.proc, t0);
    const t1 = performance.now();
    this.landmarkMs = this.landmarkMs ? this.landmarkMs * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    if (this.lastFrameAt) this.fps = this.fps ? this.fps * 0.9 + (1000 / (t1 - this.lastFrameAt)) * 0.1 : 1000 / (t1 - this.lastFrameAt);
    this.lastFrameAt = t1;

    const left = result.leftHandLandmarks?.[0] || null;
    const right = result.rightHandLandmarks?.[0] || null;
    const face = result.faceLandmarks?.[0] || null;
    const pose = result.poseLandmarks?.[0] || null;
    const hasHand = Boolean(left || right);
    const frame = {
      lips: face ? xy(face, LIPS) : null,
      left: left ? xy(left) : null,
      right: right ? xy(right) : null,
      pose: pose ? xy(pose, POSE) : null,
    };

    this.draw([left, right].filter(Boolean));
    this.segment(frame, hasHand, t1);
    this.handlers.onFrame?.({ hasHand, recording: Boolean(this.recording), fps: this.fps, landmarkMs: this.landmarkMs });
  }

  segment(frame, hasHand, now) {
    if (this.paused) return;
    if (this.needRelease) {
      if (!hasHand) this.needRelease = false;
      return;
    }
    if (!this.recording) {
      this.preroll.push(frame);
      if (this.preroll.length > SEGMENT.prerollFrames) this.preroll.shift();
      if (hasHand) {
        this.recording = { frames: [...this.preroll], startedAt: now, lastHandAt: now, handFrames: 1 };
        this.preroll = [];
        this.handlers.onState?.("recording");
      }
      return;
    }
    const rec = this.recording;
    rec.frames.push(frame);
    if (hasHand) { rec.lastHandAt = now; rec.handFrames++; }
    const handsDown = now - rec.lastHandAt > SEGMENT.endAfterNoHandMs;
    const tooLong = now - rec.startedAt > SEGMENT.maxMs;
    if (handsDown || tooLong) {
      this.recording = null;
      if (tooLong && hasHand) this.needRelease = true;
      if (rec.handFrames >= SEGMENT.minHandFrames) {
        this.handlers.onSequence?.({ frames: rec.frames, captureMs: Math.round(now - rec.startedAt), handFrames: rec.handFrames });
      } else {
        this.handlers.onState?.("too-short");
      }
    }
  }

  // Draws the camera picture (mirrored like a selfie) + the detected hands onto the display canvas,
  // cropped to the canvas shape ("cover").
  draw(hands) {
    const canvas = this.display;
    if (!canvas) return;
    const cw = canvas.clientWidth || 320;
    const ch = canvas.clientHeight || 240;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const pw = this.proc.width;
    const ph = this.proc.height;
    const scale = Math.max(cw / pw, ch / ph);
    const ox = (cw - pw * scale) / 2;
    const oy = (ch - ph * scale) / 2;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.proc, ox, oy, pw * scale, ph * scale);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = this.recording ? "rgba(255,90,80,.95)" : "rgba(255,255,255,.85)";
    ctx.fillStyle = this.recording ? "#ff5a50" : "#5eead4";
    for (const hand of hands) {
      const px = (p) => ox + p.x * pw * scale;
      const py = (p) => oy + p.y * ph * scale;
      for (const [a, b] of HAND_LINKS) {
        ctx.beginPath();
        ctx.moveTo(px(hand[a]), py(hand[a]));
        ctx.lineTo(px(hand[b]), py(hand[b]));
        ctx.stroke();
      }
      for (const p of hand) {
        ctx.beginPath();
        ctx.arc(px(p), py(p), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
