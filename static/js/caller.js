// SignConnect - the hearing caller's page (/caller).
// Listens to the caller's voice (speech-to-text), sends the text to Sara,
// and speaks Sara's signed replies out loud (text-to-speech).

import { Api } from "./api.js";
import { SpeechToText, sttSupported, ttsSupported, speak, unlockSpeech } from "./speech.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const SETTINGS_KEY = "signconnect.caller.v1";
let saved = {};
try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) { /* ignore */ }
const settings = {
  room: params.get("room") || saved.room || "sara",
  lang: params.get("lang") || saved.lang || "en-US",
  name: saved.name || "City General Hospital",
};

let api = new Api(settings.room, "caller");
const stt = new SpeechToText();
let room = null;
let callId = null;
let messages = [];
let screen = "c-setup";
let speakQueue = Promise.resolve();
let timer = null;
let micError = "";

const SOURCE_LABELS = {
  live_stt: ["LIVE · speech-to-text", "live"],
  live_sign: ["LIVE · sign recognition", "live"],
  typed: ["TYPED", "typed"],
  demo_script: ["DEMO · pre-written", "demo"],
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message, ms = 4000) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), ms);
}

function show(id) {
  if (id === screen) return;
  const previous = screen;
  screen = id;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  if (id === "c-call") startMic();
  if (previous === "c-call") stt.stop();
  const badge = { "c-setup": "READY", "c-ringing": "RINGING", "c-call": "IN CALL", "c-ended": "ENDED" }[id];
  $("statusBadge").textContent = badge;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
$("cRoom").value = settings.room;
$("cLang").value = settings.lang;
$("cName").value = settings.name;

function saveSettings() {
  settings.room = $("cRoom").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "sara";
  settings.lang = $("cLang").value;
  settings.name = $("cName").value.trim() || "City General Hospital";
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

["cRoom", "cLang", "cName"].forEach((id) => $(id).addEventListener("change", () => {
  const oldRoom = settings.room;
  saveSettings();
  if (settings.room !== oldRoom) connect();
}));

const warnings = [];
if (!window.isSecureContext) warnings.push("The microphone only works on https:// (use the Render link) or http://localhost.");
if (!sttSupported()) warnings.push("This browser has no speech recognition. Use Google Chrome (Android/desktop) or Edge. You can still type.");
if (!ttsSupported()) warnings.push("This browser cannot speak text aloud.");
if (warnings.length) {
  $("cWarning").innerHTML = warnings.map(escapeHtml).join("<br>");
  $("cWarning").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Server connection
// ---------------------------------------------------------------------------
function connect() {
  api.stopPolling();
  api = new Api(settings.room, "caller");
  callId = null;
  api.startPolling(onUpdate, (online) => {
    $("netStatus").textContent = online ? "● server connected" : "● server unreachable – retrying…";
    $("netStatus").className = `net ${online ? "ok" : "bad"}`;
  });
}

function onUpdate({ room: newRoom, messages: newMessages }) {
  room = newRoom;
  if (room.call_id !== callId) {
    callId = room.call_id;
    messages = [];
    render();
  }
  newMessages.forEach(ingest);

  if (room.status === "ringing" && screen === "c-setup" && room.ring_origin === "caller_page") show("c-ringing");
  if (room.status === "connected" && (screen === "c-ringing" || screen === "c-setup")) startCallScreen();
  if (room.status === "ended" && (screen === "c-ringing" || screen === "c-call")) {
    $("cEndedText").textContent = room.connected_at ? "The call has ended." : "Sara did not answer.";
    clearInterval(timer);
    show("c-ended");
  }
}

function ingest(message) {
  if (messages.some((m) => m.seq === message.seq)) return;
  messages.push(message);
  messages.sort((a, b) => a.seq - b.seq);
  render();
  // Speak every reply from Sara exactly once, in order.
  if (message.sender === "user" && !message.spoken_at && screen === "c-call") {
    speakQueue = speakQueue.then(() => speakReply(message));
  }
}

function render() {
  $("cTranscript").innerHTML = messages.map((m) => {
    const [label, css] = SOURCE_LABELS[m.source] || [m.source, ""];
    return `<div class="bubble ${m.sender === "caller" ? "user" : "caller"}">
      <div class="who">${m.sender === "caller" ? "You" : "Sara"} <span class="tag ${css}">${label}</span></div>
      <div dir="auto">${escapeHtml(m.text)}</div></div>`;
  }).join("");
  $("cTranscript").scrollTop = $("cTranscript").scrollHeight;
}

// ---------------------------------------------------------------------------
// Call control
// ---------------------------------------------------------------------------
$("btnCall").addEventListener("click", async () => {
  unlockSpeech(); // iPhone/Safari: speech must be unlocked by a tap
  saveSettings();
  try {
    await api.ring({ mode: "live", origin: "caller_page", caller_name: settings.name });
    show("c-ringing");
  } catch (error) {
    toast("Could not call: " + error.message);
  }
});

$("btnCancel").addEventListener("click", () => api.end().catch(() => {}));
$("btnHangUp").addEventListener("click", () => api.end().catch(() => {}));
$("btnNew").addEventListener("click", () => show("c-setup"));

function startCallScreen() {
  show("c-call");
  clearInterval(timer);
  timer = setInterval(() => {
    if (!room?.connected_at) return;
    const s = Math.max(0, Math.floor((api.serverNow() - room.connected_at) / 1000));
    $("cTimer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
}

// ---------------------------------------------------------------------------
// Speech-to-text (caller's voice -> Sara's screen)
// ---------------------------------------------------------------------------
function startMic() {
  micError = "";
  updateMic("starting");
  stt.start(settings.lang, {
    onState: updateMic,
    onInterim: (text) => { $("cInterim").textContent = text + " …"; },
    onFinal: async (text, { finalizeMs }) => {
      $("cInterim").textContent = text;
      const originAt = api.serverNow();
      try {
        const result = await api.sendMessage({
          sender: "caller", source: "live_stt", text, originAt,
          meta: { stt_finalize_ms: finalizeMs, lang: settings.lang, engine: "Web Speech API" },
        });
        ingest(result.message);
      } catch (error) {
        toast("Could not send: " + error.message);
      }
    },
    onError: (code, message) => { micError = message; updateMic("error"); toast(message, 6000); },
  });
}

function updateMic(state) {
  const el = $("cMic");
  if (micError) el.innerHTML = `<span class="dot bad"></span> ${escapeHtml(micError)}`;
  else if (state === "paused") el.innerHTML = '<span class="dot"></span> Microphone paused while Sara’s reply is spoken';
  else if (state === "listening" || state === "restarting") el.innerHTML = '<span class="dot ok pulse"></span> Microphone on – live speech-to-text';
  else el.innerHTML = '<span class="dot"></span> Microphone starting…';
}

$("cTypeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("cTypeText").value.trim();
  if (!text) return;
  try {
    const result = await api.sendMessage({ sender: "caller", source: "typed", text });
    $("cTypeText").value = "";
    ingest(result.message);
  } catch (error) {
    toast("Could not send: " + error.message);
  }
});

// ---------------------------------------------------------------------------
// Text-to-speech (Sara's reply -> caller hears it)
// ---------------------------------------------------------------------------
async function speakReply(message) {
  $("cSpeakingText").textContent = message.text;
  $("cSpeaking").classList.remove("hidden");
  stt.pause(); // do not transcribe our own loudspeaker
  updateMic("paused");
  try {
    const { played } = await speak(message.text, settings.lang, { onStart: () => api.ack(message.seq, "spoken") });
    if (!played) toast("The browser did not play the audio. Check the volume or use Google Chrome.");
  } catch (error) {
    toast("Could not play audio: " + error.message);
  }
  $("cSpeaking").classList.add("hidden");
  if (screen === "c-call") { stt.resume(); updateMic("listening"); }
}

connect();
