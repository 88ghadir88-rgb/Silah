// SignConnect Model Lab - try the pre-trained ASL model and measure its accuracy.
// Team tool only (not part of the SignConnect app or the call experience).

import { Api } from "./api.js";
import { SIGNS, signInfo } from "./config.js";
import { SignCapture } from "./signs.js";
import { $, sleep, escapeHtml } from "./ui.js";

const api = new Api("lab", "lab");
let waiting = null; // resolve function while the accuracy test waits for a sign
let testing = false;

const capture = new SignCapture({
  onFrame: ({ hasHand, recording, fps, landmarkMs }) => {
    $("aiBadge").classList.toggle("rec", recording);
    $("camStats").textContent = `${capture.delegate} · ${landmarkMs.toFixed(0)} ms · ${fps.toFixed(0)} fps${hasHand ? " · hand" : ""}`;
  },
  onState: (state) => {
    if (state === "recording") $("result").innerHTML = "<b>● Recording…</b>";
    if (state === "too-short") $("result").textContent = "Too short – try again.";
  },
  onSequence: async ({ frames, captureMs }) => {
    capture.setPaused(true);
    $("result").textContent = "Recognizing…";
    const t0 = performance.now();
    let result = null;
    try {
      result = await api.recognize(frames);
      result.roundTrip = Math.round(performance.now() - t0);
      showResult(result, captureMs);
    } catch (error) {
      $("result").textContent = "Error: " + error.message;
    }
    capture.setPaused(false);
    if (waiting) waiting({ predicted: result?.accepted ? result.sign : "", time_ms: result?.roundTrip ?? null, result });
  },
});

function bar(value) {
  return `<div class="bar" style="width:${Math.max(2, Math.round(value * 100))}%"></div>`;
}

function showResult(r, captureMs) {
  $("result").innerHTML = `
    <p style="font-size:1.5rem;margin:0">${r.accepted ? `✅ ${escapeHtml(signInfo(r.sign).gloss)}` : "❌ not accepted"}
      <span class="muted">${Math.round(r.confidence * 100)}% among SignConnect signs</span></p>
    <p class="muted">${escapeHtml(r.reason)} · ${r.hand_frames}/${r.frames} frames with a hand · signing ${(captureMs / 1000).toFixed(1)} s ·
      model ${r.inference_ms} ms · round trip ${r.roundTrip} ms</p>
    <h4>SignConnect vocabulary (what the app uses)</h4>
    <table>${r.top_vocabulary.map((v) => `<tr><td>${escapeHtml(signInfo(v.sign).gloss)}</td><td style="width:50%">${bar(v.confidence)}</td><td>${Math.round(v.confidence * 100)}%</td><td class="muted">rank ${v.global_rank}/250</td></tr>`).join("")}</table>
    <h4>Raw model output: top 5 of all 250 ASL signs</h4>
    <table>${r.top_all.map((v) => `<tr><td>${escapeHtml(v.sign)}</td><td style="width:50%">${bar(v.probability)}</td><td>${(v.probability * 100).toFixed(1)}%</td></tr>`).join("")}</table>`;
}

$("btnStart").addEventListener("click", async () => {
  $("camMsg").textContent = "Starting camera…";
  try {
    await capture.start($("camCanvas"));
    $("camMsg").classList.add("hidden");
  } catch (error) {
    $("camMsg").textContent = "Camera error: " + error.message;
  }
});

// ---------------------------------------------------------------------------
// Accuracy test
// ---------------------------------------------------------------------------
function waitForSign(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting = null; resolve({ predicted: "", time_ms: null }); }, timeoutMs);
    waiting = (r) => { clearTimeout(timer); waiting = null; resolve(r); };
  });
}

$("btnStop").addEventListener("click", () => { testing = false; waiting?.({ predicted: "", time_ms: null }); });

$("btnTest").addEventListener("click", async () => {
  if (testing) return;
  if (!capture.running) { $("prompt").textContent = "Start the camera first."; return; }
  const info = await api.model();
  const tries = Number($("tries").value);
  const queue = info.vocabulary.flatMap((id) => Array(tries).fill(id)).sort(() => Math.random() - 0.5);
  const trials = [];
  testing = true;
  $("testResults").innerHTML = "";
  for (let i = 0; i < queue.length && testing; i++) {
    const expected = queue[i];
    $("prompt").innerHTML = `<span class="muted">Hands down…</span> <small class="muted">${i + 1}/${queue.length}</small>`;
    await sleep(1500);
    if (!testing) break;
    $("prompt").innerHTML = `Sign: <b>${escapeHtml(signInfo(expected).gloss)}</b><br><small class="muted">${escapeHtml(signInfo(expected).how)}</small>`;
    const r = await waitForSign(10000);
    trials.push({ expected, predicted: r.predicted, time_ms: r.time_ms });
    $("prompt").innerHTML = r.predicted === expected ? `✅ ${escapeHtml(signInfo(expected).gloss)}`
      : `❌ expected ${escapeHtml(signInfo(expected).gloss)}, got ${r.predicted ? escapeHtml(signInfo(r.predicted).gloss) : "nothing"}`;
    await sleep(900);
  }
  testing = false;
  if (!trials.length) return;
  const correct = trials.filter((t) => t.predicted === t.expected).length;
  const per = {};
  for (const t of trials) {
    per[t.expected] ||= { total: 0, correct: 0 };
    per[t.expected].total++;
    if (t.predicted === t.expected) per[t.expected].correct++;
  }
  $("prompt").innerHTML = `Accuracy: <b>${Math.round((correct / trials.length) * 100)}%</b> (${correct}/${trials.length})`;
  $("testResults").innerHTML = `<table><tr><th>Sign</th><th>Correct</th><th>Accuracy</th></tr>${Object.entries(per).map(([id, r]) =>
    `<tr><td>${escapeHtml(signInfo(id).gloss)}</td><td>${r.correct}/${r.total}</td><td>${Math.round((r.correct / r.total) * 100)}%</td></tr>`).join("")}</table>
    <p class="muted">Saved to the server; the call summary shows the latest result. Report it exactly as measured.</p>`;
  try {
    await api.saveEvaluation({ tester: $("tester").value.trim(), trials, avg_inference_ms: Math.round(capture.landmarkMs), fps: Math.round(capture.fps) });
  } catch (error) {
    $("testResults").insertAdjacentHTML("beforeend", `<p>Not saved: ${escapeHtml(error.message)}</p>`);
  }
});

// ---------------------------------------------------------------------------
async function init() {
  try {
    const info = await api.model();
    $("modelInfo").innerHTML = info.ready
      ? `✅ <b>${escapeHtml(info.model)}</b><br><span class="muted">SignConnect uses ${info.vocabulary.length} of its ${info.total_signs_in_model} signs.
        A sign is accepted when it has ≥ ${Math.round(info.thresholds.min_confidence * 100)}% among the SignConnect signs AND is in the model's top ${info.thresholds.max_global_rank} of all 250.</span>`
      : `❌ Model not loaded: ${escapeHtml(info.error)}`;
    $("vocab").innerHTML = `<tr><th>Sign</th><th>How (ASL)</th><th>Caller hears</th></tr>` + info.vocabulary.map((id) => {
      const s = signInfo(id);
      return `<tr><td><b>${escapeHtml(s.gloss)}</b></td><td>${escapeHtml(s.how)}</td><td dir="auto">${escapeHtml(s.phrase.ar)}<br><span class="muted">${escapeHtml(s.phrase.en)}</span></td></tr>`;
    }).join("");
  } catch (error) {
    $("modelInfo").textContent = "Server unreachable: " + error.message;
  }
  if (SIGNS.length === 0) $("vocab").textContent = "No signs configured.";
}

init();
