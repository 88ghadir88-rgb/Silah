// SignConnect - the hearing caller's phone (/caller). The caller does NOT install SignConnect.
// Figma steps: STEP 1 calling -> STEP 4 "you are talking to Layla" -> STEP 7 sign language -> voice.
//
// What happens here:
//   - the caller's voice -> speech-to-text (browser Web Speech API) -> sent to Layla's screen
//   - Layla's signed reply arrives -> text-to-speech (browser voice) -> the caller hears it

import { Api } from "./api.js";
import { DEMO_SCRIPT, NAMES, langKey } from "./config.js";
import { SpeechToText, sttSupported, speak, unlockSpeech } from "./speech.js";
import { applyIcons } from "./icons.js";
import { $, escapeHtml, toast, startStatusClock, setNetStatus } from "./ui.js";

const params = new URLSearchParams(location.search);
const SETTINGS_KEY = "signconnect.caller.v2";
let saved = {};
try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) { /* ignore */ }
const settings = {
  room: params.get("room") || saved.room || "layla",
  lang: params.get("lang") || saved.lang || "ar-SA",
};

let api = new Api(settings.room, "caller");
const stt = new SpeechToText();
let room = null;
let callId = null;
let messages = [];
let screen = "c-dial";
let muted = false;
let speakQueue = Promise.resolve();
let micError = "";

function show(id) {
  if (id === screen) return;
  const previous = screen;
  screen = id;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  const talking = id === "c-talking" || id === "c-reply";
  const wasTalking = previous === "c-talking" || previous === "c-reply";
  if (talking && !wasTalking) startMic();
  if (!talking && wasTalking) { stt.stop(); updateMic("off"); }
  updateChrome();
}

function updateChrome() {
  const talking = screen === "c-talking" || screen === "c-reply";
  const demo = talking && room?.mode === "demo";
  $("modeFlag").classList.toggle("hidden", !demo);
  $("opDemoLine").classList.toggle("hidden", !demo);
  $("cTypeText").classList.toggle("hidden", !talking);
  $("cTypeSend").classList.toggle("hidden", !talking);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
$("cRoom").value = settings.room;
$("cLang").value = settings.lang;
const saveSettings = () => {
  const oldRoom = settings.room;
  settings.room = $("cRoom").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "layla";
  settings.lang = $("cLang").value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  if (settings.room !== oldRoom) connect();
};
$("cRoom").addEventListener("change", saveSettings);
$("cLang").addEventListener("change", saveSettings);

// ---------------------------------------------------------------------------
// Server connection
// ---------------------------------------------------------------------------
function connect() {
  api.stopPolling();
  api = new Api(settings.room, "caller");
  callId = null;
  api.startPolling(onUpdate, setNetStatus);
}

function onUpdate({ room: newRoom, messages: newMessages }) {
  room = newRoom;
  if (room.call_id !== callId) {
    callId = room.call_id;
    messages = [];
  }
  newMessages.forEach(ingest);

  if (room.status === "ringing" && screen === "c-dial") show("c-calling");
  if (room.status === "connected" && (screen === "c-calling" || screen === "c-dial")) show("c-talking");
  if (room.status === "ended" && ["c-calling", "c-talking", "c-reply"].includes(screen)) {
    $("cEndedText").textContent = room.connected_at ? "Call ended" : "No answer";
    show("c-ended");
  }
  updateChrome();
}

function ingest(message) {
  if (messages.some((m) => m.seq === message.seq)) return;
  messages.push(message);
  messages.sort((a, b) => a.seq - b.seq);
  if (message.sender === "caller") {
    const text = `You: “${message.text}”`;
    $("youSaid").textContent = text;
    $("youSaid2").textContent = text;
  }
  // Every reply from Layla is spoken exactly once, in order (Figma step 7).
  if (message.sender === "user" && !message.spoken_at && (screen === "c-talking" || screen === "c-reply")) {
    speakQueue = speakQueue.then(() => playReply(message));
  }
}

// ---------------------------------------------------------------------------
// Call control
// ---------------------------------------------------------------------------
$("btnCall").addEventListener("click", async () => {
  unlockSpeech(); // phones only allow speech after a tap
  try {
    await api.ring({ mode: "live", origin: "caller_page", caller_name: NAMES.caller });
    show("c-calling");
  } catch (error) {
    toast("Could not call: " + error.message);
  }
});
document.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", () => api.end().catch(() => {})));
document.querySelectorAll("[data-visual]").forEach((b) => b.addEventListener("click", () => toast("Visual only in this prototype")));
$("btnNew").addEventListener("click", () => show("c-dial"));
$("btnReplyBack").addEventListener("click", () => show("c-talking"));
$("btnMute").addEventListener("click", () => {
  muted = !muted;
  $("btnMute").classList.toggle("on", muted);
  if (muted) { stt.pause(); updateMic("muted"); } else { stt.resume(); }
});

// ---------------------------------------------------------------------------
// Speech-to-text: the caller's voice -> Layla's screen
// ---------------------------------------------------------------------------
function startMic() {
  micError = "";
  muted = false;
  $("btnMute").classList.remove("on");
  if (!sttSupported()) {
    micError = "No speech recognition in this browser – use Chrome, or type.";
    updateMic("error");
    return;
  }
  stt.start(settings.lang, {
    onState: updateMic,
    onInterim: (text) => { $("youSaid").textContent = `🎙 ${text} …`; $("youSaid2").textContent = `🎙 ${text} …`; },
    onFinal: async (text, { finalizeMs }) => {
      try {
        const result = await api.sendMessage({
          sender: "caller", source: "live_stt", text, originAt: api.serverNow(),
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
  const labels = {
    listening: "🎙 listening (live speech-to-text)", restarting: "🎙 listening (live speech-to-text)",
    paused: "🔇 mic paused while Layla's reply plays", muted: "🔇 muted", off: "🎙 mic off", stopped: "🎙 mic off",
  };
  $("cMic").textContent = micError ? `⚠ ${micError}` : labels[state] || "🎙 starting…";
}

async function sendTyped() {
  const text = $("cTypeText").value.trim();
  if (!text) return;
  try {
    ingest((await api.sendMessage({ sender: "caller", source: "typed", text })).message);
    $("cTypeText").value = "";
  } catch (error) {
    toast(error.message);
  }
}
$("cTypeSend").addEventListener("click", sendTyped);
$("cTypeText").addEventListener("keydown", (e) => { if (e.key === "Enter") sendTyped(); });

$("opDemoLine").addEventListener("click", async () => {
  const index = messages.filter((m) => m.sender === "caller" && m.source === "demo_script").length;
  const line = DEMO_SCRIPT[index];
  if (!line) { toast("Demo script finished."); return; }
  try {
    ingest((await api.sendMessage({ sender: "caller", source: "demo_script", text: line.caller[langKey(settings.lang)] })).message);
  } catch (error) {
    toast(error.message);
  }
});

// ---------------------------------------------------------------------------
// Figma step 7: Layla's reply -> text + voice
// ---------------------------------------------------------------------------
async function playReply(message) {
  const chip = {
    live_sign: ["Translated from sign language", ""],
    demo_script: ["DEMO · pre-written, not AI", "demo"],
    typed: ["Typed by Layla", "typed"],
  }[message.source] || [message.source, ""];
  $("replyText").textContent = message.text;
  $("replyChip").textContent = chip[0];
  $("replyChip").className = `chip-src ${chip[1]}`;
  $("replyDetail").innerHTML = message.meta?.signs?.length
    ? `Signs: ${escapeHtml(message.meta.signs.join(" + ").toUpperCase())}${message.meta.confidence ? ` · ${Math.round(message.meta.confidence * 100)}%` : ""}`
    : "";
  show("c-reply");
  $("replyWave").classList.add("playing");
  stt.pause(); // don't transcribe our own loudspeaker
  updateMic("paused");
  try {
    const { played } = await speak(message.text, settings.lang, { onStart: () => api.ack(message.seq, "spoken") });
    if (!played) toast("The browser did not play the audio. Check the volume or use Chrome.");
  } catch (error) {
    toast("Could not play audio: " + error.message);
  }
  $("replyWave").classList.remove("playing");
  if (!muted && (screen === "c-talking" || screen === "c-reply")) stt.resume();
}

applyIcons();
startStatusClock();
connect();
