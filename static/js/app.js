// SignConnect - Sara's app (the Deaf user's screen).
// Controls the 7 call screens + the Train and Test screens.
//
// Screen flow:
//   home -> incoming (1) -> connected (2) -> listen (3) -> camera (4) -> review (5) -> speak (6)
//        -> back to listen (3) for the next turn ... -> summary (7)

import { Api } from "./api.js";
import { SIGNS, DEMO_SCRIPT, DEFAULT_SETTINGS, CALLER, RECOGNITION, phraseFor, signLabel } from "./config.js";
import { SpeechToText, sttSupported, ttsSupported, speak, unlockSpeech } from "./speech.js";
import { HandTracker, SignClassifier, SignStabilizer } from "./signs.js";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const langKey = () => (settings.lang.startsWith("ar") ? "ar" : "en");

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
function toast(message, ms = 3500) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// Every message shows WHERE it came from. These labels are the core of our honesty policy.
const SOURCE_LABELS = {
  live_stt: { text: "LIVE · speech-to-text", css: "live" },
  live_sign: { text: "LIVE · sign recognition", css: "live" },
  typed: { text: "TYPED · manual fallback", css: "typed" },
  demo_script: { text: "DEMO · pre-written", css: "demo" },
};

function sourceTag(source) {
  const label = SOURCE_LABELS[source] || { text: source, css: "" };
  return `<span class="tag ${label.css}">${label.text}</span>`;
}

// ---------------------------------------------------------------------------
// Settings (saved in this browser)
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "signconnect.settings.v1";

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) { /* ignore */ }
  const fromUrl = new URLSearchParams(location.search).get("room");
  return { ...DEFAULT_SETTINGS, ...saved, ...(fromUrl ? { room: fromUrl } : {}) };
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

const settings = loadSettings();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let api = new Api(settings.room, "user");
const tracker = new HandTracker();
const classifier = new SignClassifier();
const stt = new SpeechToText();

let room = null;              // latest room state from the server
let callId = null;
let messages = [];            // messages of the current call (sorted by seq)
let draft = [];               // recognized signs waiting to be sent: {label, confidence, holdMs}
let draftSource = "live_sign";
let demoIndex = 0;            // next line of the DEMO_SCRIPT
let currentScreen = "home";
let timerInterval = null;
let summaryShownFor = null;

const CALL_SCREENS = ["incoming", "connected", "listen", "camera", "review", "speak"];
const CAMERA_SLOTS = { camera: "slot-camera", train: "slot-train", eval: "slot-eval" };

// ---------------------------------------------------------------------------
// Screen navigation
// ---------------------------------------------------------------------------
function show(name) {
  if (name === currentScreen) return;
  const previous = currentScreen;
  currentScreen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
  $("phone").scrollTop = 0;

  // Microphone: only on screen 3 (listen), only if the caller is on this laptop and mode is live.
  if (name === "listen") startCallerMic();
  else if (previous === "listen") stopCallerMic();

  // Camera: only on screens that have a camera slot.
  if (CAMERA_SLOTS[name]) startCamera(CAMERA_SLOTS[name]);
  else if (CAMERA_SLOTS[previous]) tracker.stop();

  updateModeBadge();
}

function updateModeBadge() {
  const inCall = CALL_SCREENS.includes(currentScreen) || currentScreen === "summary";
  const mode = inCall && room ? room.mode : settings.mode;
  const badge = $("modeBadge");
  badge.textContent = mode === "demo" ? "DEMO MODE" : "LIVE AI";
  badge.className = `badge ${mode === "demo" ? "demo" : "live"}`;
  $("demoCallerControls").classList.toggle("hidden", !(inCall && mode === "demo"));
  $("demoSignControls").classList.toggle("hidden", !(inCall && mode === "demo"));
}

// ---------------------------------------------------------------------------
// Home screen & settings
// ---------------------------------------------------------------------------
function initSettingsForm() {
  $("setMode").value = settings.mode;
  $("setCallerDevice").value = settings.callerDevice;
  $("setLang").value = settings.lang;
  $("setRoom").value = settings.room;
  updateCallerLink();

  const onChange = () => {
    settings.mode = $("setMode").value;
    settings.callerDevice = $("setCallerDevice").value;
    settings.lang = $("setLang").value;
    const newRoom = $("setRoom").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "sara";
    if (newRoom !== settings.room) {
      settings.room = newRoom;
      connect();
    }
    saveSettings();
    updateCallerLink();
    updateModeBadge();
    updateWarnings();
  };
  ["setMode", "setCallerDevice", "setLang"].forEach((id) => $(id).addEventListener("change", onChange));
  $("setRoom").addEventListener("change", onChange);
}

function updateCallerLink() {
  $("callerLink").href = `/caller?room=${encodeURIComponent(settings.room)}&lang=${settings.lang}`;
}

function updateWarnings() {
  const warnings = [];
  if (!window.isSecureContext) {
    warnings.push("Camera and microphone only work on https:// or http://localhost. Open the page with one of those addresses.");
  }
  if (settings.mode === "live" && settings.callerDevice === "same" && !sttSupported()) {
    warnings.push("This browser has no speech recognition. Use Google Chrome or Microsoft Edge, or switch to DEMO mode.");
  }
  if (!ttsSupported()) warnings.push("This browser cannot speak text aloud. Use Google Chrome.");
  if (settings.callerDevice === "same" && room?.online?.caller) {
    warnings.push("The caller page is open on another device. Change “The hearing caller is…” to “on another device”, otherwise both devices will listen and speak.");
  }
  if (settings.callerDevice === "separate" && room && !room.online?.caller) {
    warnings.push(`No caller device connected yet. Open ${location.origin}/caller?room=${settings.room} on the other device.`);
  }
  const el = $("settingsWarning");
  el.innerHTML = warnings.map(escapeHtml).join("<br><br>");
  el.classList.toggle("hidden", warnings.length === 0);
}

function updateModelStatus() {
  const signs = classifier.trainedSigns();
  const text = signs.length
    ? `${signs.length} of ${SIGNS.length} signs trained (${classifier.totalSamples()} samples) · loaded from ${classifier.source}.`
    : "No signs trained yet. Press “Train signs” (takes about 5 minutes). DEMO mode works without training.";
  $("modelStatus").textContent = text;
}

// ---------------------------------------------------------------------------
// Connection to the backend (polling)
// ---------------------------------------------------------------------------
function connect() {
  api.stopPolling();
  api = new Api(settings.room, "user");
  room = null;
  callId = null;
  api.startPolling(onServerUpdate, (online) => {
    const el = $("netStatus");
    el.textContent = online ? "● server connected" : "● server unreachable – retrying…";
    el.className = `net ${online ? "ok" : "bad"}`;
    if (!online) toast("Lost connection to the server. Retrying automatically…");
  });
}

function onServerUpdate({ room: newRoom, messages: newMessages }) {
  const previousStatus = room?.status;
  room = newRoom;

  if (room.call_id !== callId) {
    // A new call started (or first load).
    callId = room.call_id;
    messages = [];
    draft = [];
    demoIndex = 0;
    summaryShownFor = null;
    renderTranscripts();
  }
  newMessages.forEach(ingest);

  // React to call status changes made by either side.
  if (previousStatus === undefined && room.status === "connected" && currentScreen === "home") {
    // The page was reloaded in the middle of a call: go straight back into it.
    document.querySelectorAll(".callName").forEach((el) => (el.textContent = room.caller_name || CALLER.name));
    showConnected();
  } else if (room.status === "ringing" && ["home", "summary"].includes(currentScreen)) {
    showIncoming();
  } else if (room.status === "ringing" && ["train", "eval"].includes(currentScreen) && previousStatus !== "ringing") {
    toast("📞 Incoming call – go Home to answer.", 6000);
  } else if (room.status === "connected" && currentScreen === "incoming") {
    showConnected();
  } else if (room.status === "ended" && CALL_SCREENS.includes(currentScreen)) {
    if (currentScreen === "incoming") {
      toast("The caller hung up.");
      show("home");
    } else {
      showSummary();
    }
  }
  if (currentScreen === "home") updateWarnings();
  updateMicStatus();
}

// Adds a message to the conversation (ignores duplicates).
function ingest(message) {
  if (messages.some((m) => m.seq === message.seq)) return;
  messages.push(message);
  messages.sort((a, b) => a.seq - b.seq);
  if (message.sender === "caller") {
    $("captionMain").textContent = message.text;
    $("captionInterim").textContent = "";
    document.querySelectorAll(".lastCallerText").forEach((el) => (el.textContent = message.text));
    api.ack(message.seq, "displayed");
    if (currentScreen !== "listen" && CALL_SCREENS.includes(currentScreen)) {
      if (navigator.vibrate) navigator.vibrate(150);
    }
  }
  renderTranscripts();
}

function renderTranscripts() {
  const html = messages.map((m) => `
    <div class="bubble ${m.sender}">
      <div class="who">${m.sender === "caller" ? "Caller" : "Sara"} ${sourceTag(m.source)}</div>
      <div dir="auto">${escapeHtml(m.text)}</div>
      ${m.meta?.signs?.length ? `<div class="signs-used">signs: ${m.meta.signs.map(signLabel).join(" · ")}</div>` : ""}
    </div>`).join("");
  const el = $("transcriptListen");
  el.innerHTML = html || '<p class="muted small">The conversation will appear here.</p>';
  el.scrollTop = el.scrollHeight;
  if (!messages.some((m) => m.sender === "caller")) {
    $("captionMain").textContent = "Waiting for the caller to speak…";
    document.querySelectorAll(".lastCallerText").forEach((e) => (e.textContent = "…"));
  }
}

// ---------------------------------------------------------------------------
// Screens 1 & 2: incoming call, connected
// ---------------------------------------------------------------------------
async function simulateIncomingCall() {
  try {
    await api.ring({
      mode: settings.mode,
      origin: "simulated_button",
      caller_name: CALLER.name,
      caller_number: CALLER.number,
    });
    // The next poll (within 0.7 s) will see status "ringing" and open the incoming screen.
  } catch (error) {
    toast("Could not start the call: " + error.message);
  }
}

function showIncoming() {
  $("incomingName").textContent = room.caller_name || CALLER.name;
  $("incomingNumber").textContent = room.caller_number || CALLER.number;
  document.querySelectorAll(".callName").forEach((el) => (el.textContent = room.caller_name || CALLER.name));
  $("connectedName").textContent = room.caller_name || CALLER.name;
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  show("incoming");
}

async function answerCall() {
  unlockSpeech(); // allows the browser to speak later
  try {
    await api.answer();
    room.status = "connected";
    room.connected_at = api.serverNow();
    showConnected();
  } catch (error) {
    toast("Could not answer: " + error.message);
  }
}

function showConnected() {
  show("connected");
  startTimer();
  setTimeout(() => { if (currentScreen === "connected") show("listen"); }, 1800);
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!room?.connected_at) return;
    const end = room.ended_at || api.serverNow();
    const seconds = Math.max(0, Math.floor((end - room.connected_at) / 1000));
    const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    document.querySelectorAll(".callTimer, #connectedTimer").forEach((el) => (el.textContent = text));
  }, 500);
}

// ---------------------------------------------------------------------------
// Screen 3: caller speech -> text
// ---------------------------------------------------------------------------
function callerUsesThisLaptop() {
  return settings.callerDevice === "same" && room?.mode !== "demo";
}

let micState = "stopped";
let micError = "";

function startCallerMic() {
  micError = "";
  if (!callerUsesThisLaptop()) { updateMicStatus(); return; }
  stt.start(settings.lang, {
    onState: (state) => { micState = state; updateMicStatus(); },
    onInterim: (text) => { $("captionInterim").textContent = text + " …"; },
    onFinal: async (text, { finalizeMs }) => {
      $("captionInterim").textContent = "";
      const originAt = api.serverNow();
      try {
        const result = await api.sendMessage({
          sender: "caller", source: "live_stt", text, originAt,
          meta: { stt_finalize_ms: finalizeMs, lang: settings.lang, engine: "Web Speech API" },
        });
        ingest(result.message);
      } catch (error) {
        toast("Could not send the caption: " + error.message);
      }
    },
    onError: (code, message) => { micError = message; updateMicStatus(); toast(message, 6000); },
  });
}

function stopCallerMic() {
  stt.stop();
  $("captionInterim").textContent = "";
}

function updateMicStatus() {
  const el = $("micStatus");
  if (!el) return;
  let html;
  if (room?.mode === "demo") {
    html = '<span class="dot demo"></span> DEMO MODE: caller lines are pre-written, not live speech recognition.';
  } else if (settings.callerDevice === "separate") {
    html = room?.online?.caller
      ? '<span class="dot ok"></span> Caller device connected – their speech is transcribed there.'
      : '<span class="dot bad"></span> Caller device not connected. Open /caller on the other device.';
  } else if (micError) {
    html = `<span class="dot bad"></span> ${escapeHtml(micError)}`;
  } else if (micState === "listening" || micState === "restarting") {
    html = '<span class="dot ok pulse"></span> Microphone on – caller speaks into this laptop (live speech-to-text).';
  } else {
    html = '<span class="dot"></span> Microphone starting…';
  }
  el.innerHTML = html;
}

async function playNextDemoLine() {
  const line = DEMO_SCRIPT[demoIndex];
  if (!line) { toast("The demo script is finished. Press End."); return; }
  try {
    const result = await api.sendMessage({ sender: "caller", source: "demo_script", text: line.caller[langKey()] });
    demoIndex++;
    ingest(result.message);
  } catch (error) {
    toast("Could not send demo line: " + error.message);
  }
}

// ---------------------------------------------------------------------------
// Camera (shared by the sign camera, train and test screens)
// ---------------------------------------------------------------------------
async function startCamera(slotId) {
  const rig = $("cameraRig");
  $(slotId).appendChild(rig);
  rig.classList.add("on");
  $("cameraMessage").textContent = "Starting camera… (first time can take ~5 seconds)";
  $("cameraMessage").classList.remove("hidden");
  try {
    await tracker.start($("video"), $("overlay"));
    $("cameraMessage").classList.add("hidden");
    if (!CAMERA_SLOTS[currentScreen]) tracker.stop(); // user left the screen while it was starting
  } catch (error) {
    const reasons = {
      NotAllowedError: "Camera permission blocked. Click the camera icon in the address bar → Allow, then reload.",
      NotFoundError: "No camera found on this computer.",
      NotReadableError: "The camera is being used by another app (Zoom, Teams, Camera app). Close it and try again.",
    };
    $("cameraMessage").textContent = reasons[error.name] || "Camera / model error: " + error.message;
  }
}

const stabilizer = new SignStabilizer((sign) => onSignRecognized(sign));
const evalStabilizer = new SignStabilizer((sign) => onEvalSign(sign));

tracker.onFrame((frame) => {
  const prediction = classifier.predict(frame.features);
  let state = { label: null, progress: 0 };
  if (currentScreen === "camera") state = stabilizer.feed(prediction, frame.time);
  else if (currentScreen === "eval" && evalRunning && evalAccepting) state = evalStabilizer.feed(prediction, frame.time);
  else if (currentScreen === "train") trainFrame(frame, prediction);

  // HUD (heads-up display on top of the video)
  const shown = state.label || prediction?.label || null;
  $("hudSign").textContent = !frame.landmarks ? "no hand" : shown ? signLabel(shown) : "unknown";
  $("hudHold").style.width = `${Math.round((state.progress || 0) * 100)}%`;
  $("hudStats").textContent = `${tracker.delegate} · ${tracker.inferenceMs.toFixed(0)} ms · ${tracker.fps.toFixed(0)} fps`;
});

// ---------------------------------------------------------------------------
// Screen 4: sign language camera
// ---------------------------------------------------------------------------
function openSignCamera() {
  if (!classifier.isReady() && room?.mode !== "demo") {
    toast("No sign model trained yet. Train signs first, use DEMO mode, or type instead.", 6000);
  }
  stabilizer.reset();
  renderDraft();
  show("camera");
}

function onSignRecognized(sign) {
  if (draftSource !== "live_sign") { draft = []; draftSource = "live_sign"; }
  draft.push(sign);
  if (draft.length > 6) draft.shift();
  if (navigator.vibrate) navigator.vibrate(60);
  renderDraft();
}

function useDemoReply() {
  const line = DEMO_SCRIPT[Math.max(0, demoIndex - 1)];
  if (!line || !line.reply.length) { toast("No scripted reply for this line."); return; }
  draft = line.reply.map((label) => ({ label, confidence: null, holdMs: null }));
  draftSource = "demo_script";
  renderDraft();
}

function renderDraft() {
  const el = $("draftChips");
  if (!draft.length) {
    el.innerHTML = '<span class="muted">Hold a sign steady for a moment…</span>';
    return;
  }
  el.innerHTML = draft.map((d) => `<span class="chip ${draftSource === "demo_script" ? "demo" : ""}">${signLabel(d.label)}${
    d.confidence ? ` <small>${Math.round(d.confidence * 100)}%</small>` : ""}</span>`).join("") +
    (draftSource === "demo_script" ? ' <span class="tag demo">DEMO</span>' : "");
}

// ---------------------------------------------------------------------------
// Screen 5: sign -> text
// ---------------------------------------------------------------------------
function openReview() {
  if (!draft.length) { toast("No sign recognized yet. Hold a sign steady, or tap “Type instead”."); return; }
  $("reviewChips").innerHTML = draft.map((d) => `<span class="chip">${signLabel(d.label)}</span>`).join("");
  $("reviewText").textContent = phraseFor(draft.map((d) => d.label), settings.lang);
  $("reviewSource").innerHTML = sourceTag(draftSource) +
    (draftSource === "live_sign" ? ' <span class="small muted">recognized by the hand model + classifier</span>' : "");
  show("review");
}

async function sendReply() {
  const signs = draft.map((d) => d.label);
  const text = phraseFor(signs, settings.lang);
  const live = draftSource === "live_sign";
  const avg = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const meta = { signs, lang: settings.lang };
  if (live) {
    meta.engine = "MediaPipe HandLandmarker + kNN";
    meta.sign_hold_ms = avg(draft.map((d) => d.holdMs));
    meta.confidence = Math.round((draft.reduce((a, d) => a + d.confidence, 0) / draft.length) * 100) / 100;
    meta.avg_inference_ms = Math.round(tracker.inferenceMs * 10) / 10;
    meta.fps = Math.round(tracker.fps);
  }
  await sendUserMessage(draftSource, text, meta);
  draft = [];
  draftSource = "live_sign";
}

// Used by sign replies and typed replies.
async function sendUserMessage(source, text, meta = {}) {
  try {
    const result = await api.sendMessage({ sender: "user", source, text, meta, originAt: api.serverNow() });
    ingest(result.message);
    playToCaller(result.message);
  } catch (error) {
    toast("Could not send: " + error.message);
  }
}

// ---------------------------------------------------------------------------
// Screen 6: text -> speech
// ---------------------------------------------------------------------------
async function playToCaller(message) {
  $("speakText").textContent = message.text;
  $("speakDetail").textContent = "";
  $("screen-speak").classList.add("playing");
  show("speak");

  if (settings.callerDevice === "same") {
    $("speakStatus").textContent = "Speaking to the caller on this laptop…";
    try {
      const { played, voice } = await speak(message.text, settings.lang, { onStart: () => api.ack(message.seq, "spoken") });
      $("speakStatus").textContent = played ? "✓ The caller heard your reply" : "⚠ The browser did not play the audio";
      $("speakDetail").textContent = played
        ? `Browser text-to-speech · voice: ${voice}`
        : "Check the laptop volume / output device, or use Google Chrome.";
    } catch (error) {
      $("speakStatus").textContent = "Could not play audio: " + error.message;
    }
  } else {
    $("speakStatus").textContent = "Sent – playing on the caller’s device…";
    const heard = await waitForSpoken(message.seq, 12000);
    $("speakStatus").textContent = heard ? "✓ The caller heard your reply" : "Sent (no confirmation from the caller device)";
    $("speakDetail").textContent = heard ? "Played with text-to-speech on the caller’s device" : "Check that /caller is open on the other device.";
  }
  $("screen-speak").classList.remove("playing");
  await sleep(1200);
  if (currentScreen === "speak") show("listen");
}

async function waitForSpoken(seq, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(400);
    try {
      const data = await api.state(seq - 1);
      const message = data.messages.find((m) => m.seq === seq);
      if (message?.spoken_at) return true;
    } catch (e) { /* keep trying */ }
  }
  return false;
}

// Typed fallback
function openTypeDialog() {
  $("typeText").value = "";
  $("typeDialog").showModal();
  $("typeText").focus();
}

$("typeDialog").addEventListener("close", () => {
  const text = $("typeText").value.trim();
  if ($("typeDialog").returnValue === "send" && text) sendUserMessage("typed", text, { lang: settings.lang });
});

// ---------------------------------------------------------------------------
// Screen 7: call summary
// ---------------------------------------------------------------------------
async function endCall() {
  try {
    const data = await api.end();
    room = data.room;
    renderSummary(data.summary);
  } catch (error) {
    toast("Could not end the call: " + error.message);
  }
}

async function showSummary() {
  if (summaryShownFor === callId && currentScreen === "summary") return;
  try {
    const data = await api.summary();
    renderSummary(data.summary);
  } catch (error) {
    toast("Could not load the summary: " + error.message);
    show("home");
  }
}

function ms(value) {
  return value == null ? '<span class="na">not measured</span>' : `${(value / 1000).toFixed(2)} s`;
}

function renderSummary(s) {
  summaryShownFor = callId;
  clearInterval(timerInterval);
  stopCallerMic();
  window.speechSynthesis?.cancel();

  $("sumTitle").textContent = s.completed ? "Call completed" : "Call ended";
  const minutes = s.duration_s != null ? `${Math.floor(s.duration_s / 60)} min ${s.duration_s % 60} s` : "–";
  $("sumOutcome").innerHTML = s.completed
    ? (s.completed_with_signs_only
      ? `Sara completed this call <b>independently</b>: all ${s.replies_total} replies were given in sign language (live recognition).`
      : `Sara replied ${s.replies_total} time${s.replies_total === 1 ? "" : "s"}: ${s.replies_by_live_sign} by live sign recognition, the rest typed or pre-written.`)
    : "The call ended before a full exchange took place.";

  const lat = s.latency;
  const tiles = [
    ["Duration", minutes],
    ["Messages", s.turns],
    ["Replies by live sign", `${s.replies_by_live_sign} / ${s.replies_total}`],
    ["Signs recognized", s.signs_recognized.length],
    ["Caller speech → Sara’s screen", ms(lat.caller_speech_to_screen_ms)],
    ["Speech-to-text finalize (approx.)", ms(lat.stt_finalize_ms)],
    ["Sign hold before accepted", ms(lat.sign_hold_ms)],
    ["Sara sends → caller hears", ms(lat.user_send_to_caller_audio_ms)],
    ["Hand model per frame", lat.hand_model_inference_ms == null ? '<span class="na">not measured</span>' : `${lat.hand_model_inference_ms} ms`],
    ["Last accuracy test", s.latest_evaluation ? `${Math.round(s.latest_evaluation.accuracy * 100)}% (${s.latest_evaluation.correct}/${s.latest_evaluation.total})` : '<span class="na">not run yet</span>'],
  ];
  $("sumMetrics").innerHTML = tiles.map(([label, value]) => `<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`).join("");

  $("sumTranscript").innerHTML = s.transcript.map((m) => `
    <div class="bubble ${m.sender}">
      <div class="who">${m.sender === "caller" ? "Caller" : "Sara"} ${sourceTag(m.source)}</div>
      <div dir="auto">${escapeHtml(m.text)}</div>
      ${m.signs.length ? `<div class="signs-used">signs: ${m.signs.map(signLabel).join(" · ")}</div>` : ""}
    </div>`).join("") || '<p class="muted small">No messages.</p>';

  const c = s.caller_messages;
  const u = s.user_messages;
  $("sumHonesty").innerHTML = `
    <ul>
      <li><b>Phone call:</b> simulated in the browser (${s.ring_origin === "caller_page" ? "started from the caller page" : "started with the “simulate call” button"}). No cellular network was used.</li>
      <li><b>Caller lines:</b> ${c.live_stt} live speech-to-text · ${c.typed} typed · ${c.demo_script} demo (pre-written)</li>
      <li><b>Sara’s replies:</b> ${u.live_sign} live sign recognition · ${u.typed} typed · ${u.demo_script} demo (pre-written)</li>
      <li>Latency numbers only use LIVE messages. Demo and typed messages are excluded.</li>
      <li>Sign recognition: static ASL handshapes (pre-trained MediaPipe hand model + our calibrated classifier). Not Saudi Sign Language.</li>
    </ul>`;
  show("summary");
}

// ---------------------------------------------------------------------------
// Train screen
// ---------------------------------------------------------------------------
let recording = null; // {signId, target, added, lastAt, startedAt}

function renderTrainList() {
  $("trainList").innerHTML = SIGNS.map((s) => {
    const count = classifier.count(s.id);
    const busy = recording?.signId === s.id;
    return `<div class="train-row">
      <div>
        <b>${signLabel(s.id)}</b> <span class="small muted">→ “${escapeHtml(s.phrase.en)}”</span><br>
        <span class="small">${escapeHtml(s.handshape)}</span><br>
        <span class="small muted">${escapeHtml(s.asl)}</span>
      </div>
      <div class="train-actions">
        <span class="count ${count >= 40 ? "ok" : ""}">${count} samples</span>
        <button class="btn small primary" data-record="${s.id}" ${recording ? "disabled" : ""}>${busy ? `Recording ${recording.added}/${recording.target}` : "● Record"}</button>
        <button class="btn small" data-clear="${s.id}" ${recording || !count ? "disabled" : ""}>Clear</button>
      </div>
    </div>`;
  }).join("");
  $("trainSource").textContent = `Model loaded from: ${classifier.source}. Samples are saved in this browser automatically. To share them with the team and the cloud version, download the model file and replace static/models/sign_model.json (see guide, Step 7).`;
}

async function startRecording(signId) {
  if (!tracker.running) { toast("Camera is not running."); return; }
  toast(`Get ready: show ${signLabel(signId)}…`, 1500);
  await sleep(1200);
  recording = { signId, target: RECOGNITION.samplesPerRecording, added: 0, lastAt: 0, startedAt: performance.now() };
  renderTrainList();
}

function trainFrame(frame, prediction) {
  $("trainLive").textContent = !frame.landmarks
    ? "Live guess: no hand visible"
    : `Live guess: ${prediction?.label ? `${signLabel(prediction.label)} (${Math.round(prediction.confidence * 100)}%)` : "unknown"}`;
  if (!recording) return;
  const now = frame.time;
  if (frame.features && now - recording.lastAt > 80) { // about 12 samples per second
    classifier.addSample(recording.signId, frame.features);
    recording.added++;
    recording.lastAt = now;
    renderTrainList();
  }
  if (recording.added >= recording.target || now - recording.startedAt > 10000) {
    const added = recording.added;
    const signId = recording.signId;
    recording = null;
    classifier.prepare();
    classifier.saveToBrowser();
    renderTrainList();
    updateModelStatus();
    toast(added ? `Saved ${added} samples for ${signLabel(signId)}.` : "No hand was visible – nothing recorded.");
  }
}

$("trainList").addEventListener("click", (event) => {
  const record = event.target.closest("[data-record]");
  const clear = event.target.closest("[data-clear]");
  if (record) startRecording(record.dataset.record);
  if (clear && confirm(`Delete all samples for ${clear.dataset.clear}?`)) {
    classifier.clear(clear.dataset.clear);
    classifier.saveToBrowser();
    renderTrainList();
    updateModelStatus();
  }
});

$("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(classifier.toJSON())], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "sign_model.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

$("fileImport").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    classifier.load(JSON.parse(await file.text()), "imported file");
    classifier.saveToBrowser();
    toast(`Loaded ${classifier.totalSamples()} samples.`);
  } catch (error) {
    toast("Could not load file: " + error.message);
  }
  event.target.value = "";
  renderTrainList();
  updateModelStatus();
});

$("btnLoadBundled").addEventListener("click", async () => {
  classifier.forgetBrowserCopy();
  await classifier.loadBundled();
  renderTrainList();
  updateModelStatus();
  toast(`Bundled model: ${classifier.totalSamples()} samples.`);
});

$("btnClearAll").addEventListener("click", () => {
  if (!confirm("Delete ALL recorded samples in this browser?")) return;
  classifier.clear();
  classifier.saveToBrowser();
  renderTrainList();
  updateModelStatus();
});

// ---------------------------------------------------------------------------
// Test-accuracy screen
// ---------------------------------------------------------------------------
let evalRunning = false;
let evalAccepting = false;
let evalCurrent = null; // {expected, resolve, startedAt}

function onEvalSign(sign) {
  if (!evalCurrent) return;
  evalCurrent.resolve({ predicted: sign.label, time_ms: Math.round(performance.now() - evalCurrent.startedAt) });
}

function waitForEvalSign(expected, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ predicted: "", time_ms: null }), timeoutMs);
    evalCurrent = {
      expected,
      startedAt: performance.now(),
      resolve: (result) => { clearTimeout(timer); evalCurrent = null; resolve(result); },
    };
  });
}

async function runEvaluation() {
  const signs = classifier.trainedSigns().filter((id) => SIGNS.some((s) => s.id === id));
  if (signs.length < 2) { toast("Train at least 2 signs first."); return; }
  if (!tracker.running) { toast("Camera is not running."); return; }
  const perSign = Number($("evalTrials").value);
  const queue = [];
  signs.forEach((id) => { for (let i = 0; i < perSign; i++) queue.push(id); });
  queue.sort(() => Math.random() - 0.5);

  evalRunning = true;
  const trials = [];
  $("evalResults").innerHTML = "";
  for (let i = 0; i < queue.length && evalRunning; i++) {
    const expected = queue[i];
    const info = SIGNS.find((s) => s.id === expected);
    evalAccepting = false;
    $("evalPrompt").innerHTML = `<span class="muted">Lower your hand…</span><br><small>${i + 1} / ${queue.length}</small>`;
    await sleep(1500);
    if (!evalRunning) break;
    $("evalPrompt").innerHTML = `Sign: <b>${signLabel(expected)}</b><br><small>${escapeHtml(info.handshape)}</small>`;
    evalStabilizer.reset();
    evalAccepting = true;
    const result = await waitForEvalSign(expected, 6000);
    evalAccepting = false;
    trials.push({ expected, ...result });
    $("evalPrompt").innerHTML = result.predicted === expected
      ? `✅ ${signLabel(expected)}`
      : `❌ expected ${signLabel(expected)}, got ${result.predicted ? signLabel(result.predicted) : "nothing (timeout)"}`;
    await sleep(700);
  }
  evalRunning = false;
  evalAccepting = false;
  if (trials.length) showEvalResults(trials);
}

async function showEvalResults(trials) {
  const correct = trials.filter((t) => t.predicted === t.expected).length;
  const perSign = {};
  for (const t of trials) {
    perSign[t.expected] ||= { total: 0, correct: 0, times: [] };
    perSign[t.expected].total++;
    if (t.predicted === t.expected) { perSign[t.expected].correct++; perSign[t.expected].times.push(t.time_ms); }
  }
  const times = trials.filter((t) => t.predicted === t.expected).map((t) => t.time_ms);
  const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const errors = trials.filter((t) => t.predicted !== t.expected);

  $("evalPrompt").innerHTML = `Accuracy: <b>${Math.round((correct / trials.length) * 100)}%</b> (${correct}/${trials.length})`;
  $("evalResults").innerHTML = `
    <table class="table">
      <tr><th>Sign</th><th>Correct</th><th>Accuracy</th></tr>
      ${Object.entries(perSign).map(([id, r]) => `<tr><td>${signLabel(id)}</td><td>${r.correct}/${r.total}</td><td>${Math.round((r.correct / r.total) * 100)}%</td></tr>`).join("")}
    </table>
    <p class="small">Average time from prompt to accepted sign (correct only): ${avgTime != null ? (avgTime / 1000).toFixed(2) + " s" : "–"}<br>
    Hand model: ${tracker.delegate}, ${tracker.inferenceMs.toFixed(1)} ms per frame, ${tracker.fps.toFixed(0)} fps<br>
    Mistakes: ${errors.length ? errors.map((e) => `${signLabel(e.expected)}→${e.predicted ? signLabel(e.predicted) : "none"}`).join(", ") : "none"}</p>
    <p class="small muted">Saved to the server (shown on the call summary). Write these numbers in your pitch exactly as measured.</p>`;
  try {
    await api.saveEvaluation({
      tester: $("evalTester").value.trim(),
      trials,
      avg_inference_ms: Math.round(tracker.inferenceMs * 10) / 10,
      fps: Math.round(tracker.fps),
    });
  } catch (error) {
    toast("Results shown but not saved to server: " + error.message);
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
$("btnSimulateCall").addEventListener("click", () => { unlockSpeech(); simulateIncomingCall(); });
$("btnAnswer").addEventListener("click", answerCall);
$("btnDecline").addEventListener("click", async () => { await api.decline().catch(() => {}); show("home"); });
$("btnReplySign").addEventListener("click", openSignCamera);
$("btnDemoNextLine").addEventListener("click", playNextDemoLine);
$("btnDemoReply").addEventListener("click", useDemoReply);
$("btnCameraBack").addEventListener("click", () => show("listen"));
$("btnDraftUndo").addEventListener("click", () => { draft.pop(); if (!draft.length) draftSource = "live_sign"; renderDraft(); });
$("btnDraftDone").addEventListener("click", openReview);
$("btnSendReply").addEventListener("click", sendReply);
$("btnSignAgain").addEventListener("click", () => { draft = []; draftSource = "live_sign"; openSignCamera(); });
$("btnBackHome").addEventListener("click", () => show("home"));
$("btnGoTrain").addEventListener("click", () => { renderTrainList(); show("train"); });
$("btnGoEval").addEventListener("click", () => { $("evalResults").innerHTML = ""; $("evalPrompt").textContent = "Press Start."; show("eval"); });
$("btnEvalStart").addEventListener("click", () => { if (!evalRunning) runEvaluation(); });
$("btnEvalStop").addEventListener("click", () => { evalRunning = false; evalCurrent?.resolve({ predicted: "", time_ms: null }); });

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "end") endCall();
  if (action === "type") openTypeDialog();
  if (action === "home") { evalRunning = false; recording = null; show("home"); }
});

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
async function init() {
  initSettingsForm();
  updateModeBadge();
  connect();
  await classifier.loadBest();
  updateModelStatus();
  updateWarnings();
  // Load the hand model in the background so the camera starts quickly later.
  tracker.loadModel().catch((error) => console.warn("Hand model preload failed", error));
}

init();
