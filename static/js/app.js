// SignConnect - Layla's phone (the Deaf user).
//
// LAYER 1  SignConnect APP UI:        app-welcome (activation)  ->  app-settings (permissions)
// LAYER 2  SignConnect CALL EXPERIENCE (opens automatically when a call arrives):
//          call-incoming (Figma step 2) -> call-connected (step 3) -> call-speech (step 5)
//          -> call-sign (step 6: camera, sign -> text, send -> caller hears it) -> ... -> call-summary
//
// The incoming-call trigger is SIMULATED: the server tells this page that a call is ringing
// (started from the caller's page or the operator button). A production version would need
// native iOS telephony integration and system permissions.

import { Api } from "./api.js";
import { DEFAULT_SETTINGS, DEMO_SCRIPT, NAMES, langKey, phraseFor, glossFor, signInfo } from "./config.js";
import { SignCapture } from "./signs.js";
import { applyIcons } from "./icons.js";
import { $, sleep, escapeHtml, toast, sourceTag, startStatusClock, formatDuration, setNetStatus } from "./ui.js";

// ---------------------------------------------------------------------------
// Settings & activation (stored in this browser = "installed once")
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "signconnect.layla.settings.v2";
const ACTIVE_KEY = "signconnect.layla.active.v2";

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

const urlRoom = new URLSearchParams(location.search).get("room");
const settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}), ...(urlRoom ? { room: urlRoom } : {}) };
let activated = load(ACTIVE_KEY, false);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let api = new Api(settings.room, "user");
let room = null;
let callId = null;
let messages = [];
let current = "app-welcome";
let timer = null;
let modelReady = false;

// Draft reply built from recognized signs (cleared after sending)
let draft = { signs: [], results: [], source: "live_sign" };
let busy = false; // true while recognizing or sending

const CALL_SCREENS = ["call-incoming", "call-connected", "call-speech", "call-sign", "call-summary"];
const IN_CALL = ["call-connected", "call-speech", "call-sign"];

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function show(name) {
  if (name === current) return;
  const previous = current;
  current = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === name));
  $("phone").classList.toggle("app-mode", name.startsWith("app-"));
  if (name === "call-sign") startCamera();
  else if (previous === "call-sign") capture.stop();
  updateChrome();
}

function showApp() {
  show(activated ? "app-settings" : "app-welcome");
}

// Mode flag on the phone + operator buttons outside the phone
function updateChrome() {
  const inCall = CALL_SCREENS.includes(current) && current !== "call-summary";
  const demo = inCall && room?.mode === "demo";
  $("modeFlag").classList.toggle("hidden", !demo);
  $("opDemoLine").classList.toggle("hidden", !(demo && IN_CALL.includes(current)));
  $("opDemoReply").classList.toggle("hidden", !(demo && current === "call-sign"));
  $("opType").classList.toggle("hidden", !IN_CALL.includes(current));
  $("opRing").disabled = inCall;
}

// ---------------------------------------------------------------------------
// LAYER 1: App UI
// ---------------------------------------------------------------------------
$("btnActivate").addEventListener("click", () => {
  activated = true;
  save(ACTIVE_KEY, true);
  show("app-settings");
  toast("SignConnect is active. It will open automatically for incoming calls.");
});

$("btnDeactivate").addEventListener("click", () => {
  activated = false;
  save(ACTIVE_KEY, false);
  show("app-welcome");
});

function initSettings() {
  $("setMode").value = settings.mode;
  $("setLang").value = settings.lang;
  $("setRoom").value = settings.room;
  const onChange = () => {
    settings.mode = $("setMode").value;
    settings.lang = $("setLang").value;
    const newRoom = $("setRoom").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "layla";
    if (newRoom !== settings.room) { settings.room = newRoom; connect(); }
    $("setRoom").value = settings.room;
    save(SETTINGS_KEY, settings);
  };
  ["setMode", "setLang", "setRoom"].forEach((id) => $(id).addEventListener("change", onChange));
}

// Camera permission: this one is REAL (the browser asks). The others are simulated in the MVP.
async function refreshCameraPermission() {
  const el = $("permCamera");
  try {
    const status = await navigator.permissions.query({ name: "camera" });
    setCameraState(status.state);
    status.onchange = () => setCameraState(status.state);
  } catch (e) { /* some browsers cannot query; keep the button */ }
  function setCameraState(state) {
    el.textContent = state === "granted" ? "Allowed" : state === "denied" ? "Blocked" : "Allow";
    el.className = `perm-state ${state === "granted" ? "ok" : state === "denied" ? "bad" : "ask"}`;
  }
}

$("permCamera").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    $("permCamera").textContent = "Allowed";
    $("permCamera").className = "perm-state ok";
  } catch (error) {
    $("permCamera").textContent = "Blocked";
    $("permCamera").className = "perm-state bad";
    toast("Camera blocked. Click the camera icon in the address bar and allow it.");
  }
});

// ---------------------------------------------------------------------------
// Server connection (polling) = the simulated "incoming call trigger"
// ---------------------------------------------------------------------------
function connect() {
  api.stopPolling();
  api = new Api(settings.room, "user");
  room = null;
  callId = null;
  api.startPolling(onServerUpdate, (online) => {
    setNetStatus(online);
    if (!online) toast("Lost connection to the server. Retrying…");
  });
}

function onServerUpdate({ room: newRoom, messages: newMessages }) {
  const firstUpdate = room === null;
  room = newRoom;
  if (room.call_id !== callId) {
    callId = room.call_id;
    messages = [];
    resetDraft();
    renderSpeech();
  }
  newMessages.forEach(ingest);

  const onAppOrSummary = current.startsWith("app-") || current === "call-summary";
  if (room.status === "ringing" && onAppOrSummary && activated) {
    showIncoming();
  } else if (room.status === "connected" && (current === "call-incoming" || (firstUpdate && activated && onAppOrSummary))) {
    showConnected(); // answered, or the page was reloaded during a call
  } else if (room.status === "ended" && CALL_SCREENS.includes(current) && current !== "call-summary") {
    if (current === "call-incoming") { toast("Missed call"); showApp(); } else showSummary();
  }
  updateChrome();
}

function ingest(message) {
  if (messages.some((m) => m.seq === message.seq)) return;
  messages.push(message);
  messages.sort((a, b) => a.seq - b.seq);
  if (message.sender === "caller") {
    api.ack(message.seq, "displayed");
    renderSpeech();
    if (current === "call-connected") show("call-speech");
    if (navigator.vibrate) navigator.vibrate(120);
  }
}

// ---------------------------------------------------------------------------
// Figma step 2 + 3: incoming call, connected
// ---------------------------------------------------------------------------
function setCallerName() {
  document.querySelectorAll(".callerName").forEach((el) => (el.textContent = room?.caller_name || NAMES.caller));
}

function showIncoming() {
  setCallerName();
  $("inNumber").textContent = NAMES.callerNumber;
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  show("call-incoming");
}

$("btnAccept").addEventListener("click", async () => {
  try {
    const data = await api.answer(settings.mode);
    room = data.room;
    showConnected();
  } catch (error) {
    toast("Could not answer: " + error.message);
  }
});

$("btnDecline").addEventListener("click", async () => {
  await api.decline().catch(() => {});
  showApp();
});

function showConnected() {
  setCallerName();
  startTimer();
  show(messages.some((m) => m.sender === "caller") ? "call-speech" : "call-connected");
}

function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!room?.connected_at) return;
    const text = formatDuration((room.ended_at || api.serverNow()) - room.connected_at);
    document.querySelectorAll(".callTimer").forEach((el) => (el.textContent = text));
  }, 500);
}

$("btnSignConnect").addEventListener("click", () => show("call-speech"));
$("btnSpeechBack").addEventListener("click", () => show("call-connected"));

// ---------------------------------------------------------------------------
// Figma step 5: caller speech -> text
// ---------------------------------------------------------------------------
function renderSpeech() {
  const callerMessages = messages.filter((m) => m.sender === "caller");
  const last = callerMessages[callerMessages.length - 1];
  const previous = callerMessages[callerMessages.length - 2];
  $("speechText").innerHTML = last ? escapeHtml(last.text) : '<span class="speech-wait">Waiting for the caller to speak…</span>';
  $("speechOld").textContent = previous ? previous.text : "";
  $("speechSource").innerHTML = last ? sourceTag(last.source) : "";
  $("signCallerLine").textContent = last ? `${room?.caller_name || NAMES.caller}: ${last.text}` : "";
}

// ---------------------------------------------------------------------------
// Figma step 6: sign language camera -> ASL model -> text -> caller hears it
// ---------------------------------------------------------------------------
const capture = new SignCapture({
  onState: (state) => {
    if (busy) return;
    if (state === "recording") setPill("● Recording your sign…", { muted: true });
    if (state === "too-short") setPill("Too short. Sign again, then lower your hand.", { muted: true });
  },
  onFrame: ({ hasHand, recording, fps, landmarkMs }) => {
    $("aiBadge").classList.toggle("rec", recording);
    $("camStats").textContent = `${capture.delegate} · ${landmarkMs.toFixed(0)} ms · ${fps.toFixed(0)} fps${hasHand ? " · hand" : ""}`;
  },
  onSequence: (sequence) => recognizeSequence(sequence),
});

$$("[data-camera]").forEach((b) => b.addEventListener("click", () => show("call-sign")));
$("btnCameraOff").addEventListener("click", () => show("call-speech"));

function $$(selector) { return document.querySelectorAll(selector); }

async function startCamera() {
  resetDraft();
  setPill("Raise your hand, sign, then lower your hand", { muted: true });
  $("camMsg").classList.remove("hidden");
  $("camMsg").textContent = "Starting camera… (first time ~5–10 s)";
  if (!modelReady) $("signDetail").textContent = "⚠ ASL model not available on the server. Use DEMO mode or type.";
  try {
    await capture.start($("camCanvas"));
    $("camMsg").classList.add("hidden");
    if (current !== "call-sign") capture.stop();
  } catch (error) {
    const reasons = {
      NotAllowedError: "Camera blocked. Click the camera icon in the address bar → Allow.",
      NotFoundError: "No camera found.",
      NotReadableError: "Camera is used by another app (Zoom/Teams). Close it.",
    };
    $("camMsg").textContent = reasons[error.name] || "Camera error: " + error.message;
  }
}

async function recognizeSequence({ frames, captureMs, handFrames }) {
  if (busy) return;
  busy = true;
  capture.setPaused(true);
  setPill("Recognizing sign…", { muted: true });
  const t0 = performance.now();
  try {
    const result = await api.recognize(frames);
    const roundTrip = Math.round(performance.now() - t0);
    if (result.accepted) {
      if (draft.source !== "live_sign") resetDraft();
      draft.signs.push(result.sign);
      draft.results.push({ ...result, roundTrip, captureMs });
      showDraft();
      $("signDetail").textContent =
        `ASL model: ${signInfo(result.sign).gloss} · ${Math.round(result.confidence * 100)}% · ${(roundTrip / 1000).toFixed(2)} s`;
    } else {
      setPill("Not recognized. Please sign again.", { muted: true, retry: draft.signs.length > 0 });
      if (draft.signs.length) showDraft();
      $("signDetail").textContent = `${result.reason}${result.closest ? ` (closest: ${signInfo(result.closest).gloss}, ${Math.round(result.confidence * 100)}%)` : ""}`;
    }
  } catch (error) {
    setPill("Sign recognition unavailable", { muted: true });
    $("signDetail").textContent = error.message + " – switch to DEMO mode or type a reply.";
  }
  busy = false;
  capture.setPaused(false);
}

function resetDraft() {
  draft = { signs: [], results: [], source: "live_sign" };
}

function showDraft() {
  const text = phraseFor(draft.signs, settings.lang);
  setPill(text, { send: true, retry: true });
  if (draft.source === "demo_script") $("signDetail").innerHTML = `${sourceTag("demo_script")} ${escapeHtml(glossFor(draft.signs))}`;
}

function setPill(text, { muted = false, send = false, retry = false } = {}) {
  $("pillText").textContent = text;
  $("signPill").classList.toggle("muted", muted);
  $("btnSend").classList.toggle("hidden", !send);
  $("btnRetry").classList.toggle("hidden", !retry);
}

$("btnRetry").addEventListener("click", () => {
  resetDraft();
  setPill("Raise your hand, sign, then lower your hand", { muted: true });
  $("signDetail").textContent = "";
});

$("btnSend").addEventListener("click", async () => {
  if (!draft.signs.length || busy) return;
  const live = draft.source === "live_sign";
  const meta = { signs: [...draft.signs], lang: settings.lang };
  if (live) {
    const avg = (key) => Math.round(draft.results.reduce((a, r) => a + (r[key] || 0), 0) / draft.results.length);
    meta.engine = "MediaPipe Holistic + pre-trained ASL model (TFLite)";
    meta.confidence = Math.round((draft.results.reduce((a, r) => a + r.confidence, 0) / draft.results.length) * 100) / 100;
    meta.recognize_ms = avg("roundTrip");
    meta.model_inference_ms = avg("inference_ms");
    meta.sign_capture_ms = avg("captureMs");
    meta.avg_landmark_ms = Math.round(capture.landmarkMs);
    meta.fps = Math.round(capture.fps);
  }
  await sendReply(draft.source, phraseFor(draft.signs, settings.lang), meta);
});

// Sends Layla's reply. The CALLER's phone turns it into speech (text-to-speech).
async function sendReply(source, text, meta) {
  busy = true;
  capture.setPaused(true);
  try {
    const result = await api.sendMessage({ sender: "user", source, text, meta, originAt: api.serverNow() });
    ingest(result.message);
    resetDraft();
    setPill(`🔊 Speaking to ${room?.caller_name || NAMES.caller}…`, { muted: false });
    const heard = await waitForSpoken(result.message.seq, 15000);
    setPill(heard ? `✓ ${room?.caller_name || NAMES.caller} heard: “${text}”` : "Sent (no confirmation from the caller's phone)", { muted: !heard });
    await sleep(1600);
    if (current === "call-sign") show("call-speech");
  } catch (error) {
    toast("Could not send: " + error.message);
  }
  busy = false;
  capture.setPaused(false);
}

async function waitForSpoken(seq, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(400);
    try {
      const data = await api.state(seq - 1);
      if (data.messages.find((m) => m.seq === seq)?.spoken_at) return true;
    } catch (e) { /* keep trying */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// End call + summary
// ---------------------------------------------------------------------------
$$("[data-end]").forEach((b) => b.addEventListener("click", endCall));
$$("[data-visual]").forEach((b) => b.addEventListener("click", () => toast("Visual only in this prototype")));

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
  try {
    renderSummary((await api.summary()).summary);
  } catch (error) {
    showApp();
  }
}

const sec = (v) => (v == null ? '<span class="na">not measured</span>' : `${(v / 1000).toFixed(2)} s`);

function renderSummary(s) {
  clearInterval(timer);
  $("sumDuration").textContent = s.duration_s != null ? `Call ended · ${formatDuration(s.duration_s * 1000)}` : "Call ended";
  $("sumOutcome").innerHTML = !s.completed
    ? "The call ended before a full exchange."
    : s.completed_with_signs_only
      ? `Layla handled this call <b>independently</b>: all ${s.replies_total} replies were signed and recognized live.`
      : `Layla replied ${s.replies_total} time${s.replies_total === 1 ? "" : "s"}: ${s.replies_by_live_sign} by live sign recognition, the rest typed or pre-written.`;
  const l = s.latency;
  const tiles = [
    ["Replies by live sign", `${s.replies_by_live_sign} / ${s.replies_total}`],
    ["Signs recognized", s.signs_recognized.length ? s.signs_recognized.map((id) => signInfo(id).gloss).join(", ") : "–"],
    ["Caller speech → Layla's screen", sec(l.caller_speech_to_screen_ms)],
    ["Sign → recognized text", sec(l.sign_recognition_ms)],
    ["Layla sends → caller hears", sec(l.user_send_to_caller_audio_ms)],
    ["ASL model inference", l.sign_model_inference_ms == null ? '<span class="na">not measured</span>' : `${l.sign_model_inference_ms} ms`],
    ["Speech-to-text finalize (approx.)", sec(l.stt_finalize_ms)],
    ["Last accuracy test", s.latest_evaluation ? `${Math.round(s.latest_evaluation.accuracy * 100)}% (${s.latest_evaluation.correct}/${s.latest_evaluation.total})` : '<span class="na">not run yet</span>'],
  ];
  $("sumGrid").innerHTML = tiles.map(([label, value]) => `<div class="sum-tile"><b>${value}</b><span>${label}</span></div>`).join("");
  $("sumTranscript").innerHTML = s.transcript.map((m) => `
    <div class="bubble ${m.sender}">
      <div class="who">${m.sender === "caller" ? escapeHtml(s.caller_name || NAMES.caller) : NAMES.user} ${sourceTag(m.source)}
        ${m.signs.length ? `<span>signs: ${escapeHtml(glossFor(m.signs))}</span>` : ""}</div>
      <div dir="auto">${escapeHtml(m.text)}</div>
    </div>`).join("") || '<p class="tiny">No messages.</p>';
  const c = s.caller_messages;
  const u = s.user_messages;
  $("sumHonesty").innerHTML = `
    <li>Phone call: <b>simulated</b> in the browser (${s.ring_origin === "caller_page" ? "started from the caller's page" : "started with the MVP trigger button"}). No cellular network.</li>
    <li>Caller lines: ${c.live_stt} live speech-to-text · ${c.typed} typed · ${c.demo_script} demo (pre-written)</li>
    <li>Layla's replies: ${u.live_sign} live ASL model · ${u.typed} typed · ${u.demo_script} demo (pre-written)</li>
    <li>Timing numbers use LIVE messages only.</li>
    <li>Pre-trained English/ASL model; Saudi Sign Language is not supported yet.</li>`;
  show("call-summary");
}

$("btnSummaryDone").addEventListener("click", showApp);

// ---------------------------------------------------------------------------
// Operator strip (outside the phone): MVP trigger, demo mode, typed fallback
// ---------------------------------------------------------------------------
$("opRing").addEventListener("click", async () => {
  if (!activated) { toast("Activate SignConnect first (the app must be installed and active)."); return; }
  try {
    await api.ring({ mode: settings.mode, origin: "simulated_button", caller_name: NAMES.caller });
  } catch (error) {
    toast("Could not start the call: " + error.message);
  }
});

$("opDemoLine").addEventListener("click", async () => {
  const index = messages.filter((m) => m.sender === "caller" && m.source === "demo_script").length;
  const line = DEMO_SCRIPT[index];
  if (!line) { toast("Demo script finished. End the call."); return; }
  try {
    ingest((await api.sendMessage({ sender: "caller", source: "demo_script", text: line.caller[langKey(settings.lang)] })).message);
  } catch (error) {
    toast(error.message);
  }
});

$("opDemoReply").addEventListener("click", () => {
  const index = messages.filter((m) => m.sender === "caller" && m.source === "demo_script").length;
  const line = DEMO_SCRIPT[Math.max(0, index - 1)];
  if (!line?.reply.length) { toast("No scripted reply for this line."); return; }
  draft = { signs: [...line.reply], results: [], source: "demo_script" };
  showDraft();
});

$("opType").addEventListener("click", async () => {
  const text = (prompt("Type Layla's reply (manual fallback – it will be labeled TYPED):") || "").trim();
  if (!text) return;
  if (current !== "call-sign") show("call-sign");
  await sendReply("typed", text, { lang: settings.lang });
});

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
async function init() {
  applyIcons();
  startStatusClock();
  initSettings();
  refreshCameraPermission();
  showApp();
  connect();
  try {
    const info = await api.model();
    modelReady = info.ready;
    $("modelStatus").textContent = info.ready ? `ASL model: ready (${info.vocabulary.length} signs)` : "ASL model: NOT loaded";
    $("modelStatus").title = info.error || info.model;
  } catch (error) {
    $("modelStatus").textContent = "ASL model: server unreachable";
  }
  capture.load().catch((error) => console.warn("Holistic model preload failed", error));
}

init();
