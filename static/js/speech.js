// SignConnect - Speech-to-Text and Text-to-Speech using the browser's built-in Web Speech API.
//
// Speech-to-Text (SpeechRecognition): works in Google Chrome and Microsoft Edge on desktop and
//   Android. Needs INTERNET (Chrome sends the audio to Google's speech service) and microphone
//   permission. No API key and no cost.
// Text-to-Speech (speechSynthesis): works in all modern browsers, mostly offline, no key.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function sttSupported() {
  return Boolean(Recognition);
}

export function ttsSupported() {
  return "speechSynthesis" in window;
}

// Friendly explanations for the most common speech-recognition errors.
export const STT_ERRORS = {
  "not-allowed": "Microphone permission was blocked. Click the lock icon in the address bar and allow the microphone.",
  "service-not-allowed": "This browser blocked speech recognition. Use Google Chrome (or Edge) and open the page via https:// or localhost.",
  "network": "Speech recognition needs internet (Chrome sends audio to Google). Check the Wi-Fi or switch to DEMO mode.",
  "audio-capture": "No microphone was found. Plug in a microphone or check Windows/macOS sound settings.",
  "language-not-supported": "This language is not supported by the browser's speech recognition.",
};

export class SpeechToText {
  constructor() {
    this.active = false;     // we WANT to be listening
    this.paused = false;     // temporarily paused (e.g. while the computer is speaking)
    this.recognition = null;
    this.lastResultAt = 0;
    this.handlers = {};
    this.restartTimer = null;
  }

  // handlers: { onInterim(text), onFinal(text, {finalizeMs}), onError(code, message), onState(state) }
  start(lang, handlers) {
    if (!Recognition) {
      handlers.onError?.("unsupported", "Speech recognition is not available in this browser. Use Google Chrome.");
      return;
    }
    this.lang = lang;
    this.handlers = handlers;
    this.active = true;
    this.paused = false;
    this.launch();
  }

  launch() {
    if (!this.active || this.paused) return;
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => this.handlers.onState?.("listening");
    recognition.onresult = (event) => {
      const now = performance.now();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          // finalizeMs = time between the last partial words appearing and the final sentence.
          // It approximates "how long after the caller stopped talking did the text finish".
          const finalizeMs = this.lastResultAt ? Math.round(now - this.lastResultAt) : null;
          this.lastResultAt = 0;
          this.handlers.onFinal?.(text, { finalizeMs, confidence: result[0].confidence });
        } else {
          interim += text + " ";
        }
      }
      if (interim) {
        this.lastResultAt = now;
        this.handlers.onInterim?.(interim.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return; // normal, just restart
      const message = STT_ERRORS[event.error] || `Speech recognition error: ${event.error}`;
      this.handlers.onError?.(event.error, message);
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        this.active = false; // do not keep retrying when permission is missing
      }
    };
    recognition.onend = () => {
      this.handlers.onState?.(this.paused ? "paused" : this.active ? "restarting" : "stopped");
      // Chrome stops listening after silence or ~60 s. Restart automatically while active.
      if (this.active && !this.paused) {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.launch(), 250);
      }
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      // "already started" - harmless
    }
  }

  pause() {
    this.paused = true;
    this.recognition?.abort();
  }

  resume() {
    if (!this.active) return;
    this.paused = false;
    this.launch();
  }

  stop() {
    this.active = false;
    this.paused = false;
    clearTimeout(this.restartTimer);
    this.recognition?.abort();
    this.recognition = null;
    this.handlers.onState?.("stopped");
  }
}

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------
let voicesReady = null;

function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}

function pickVoice(voices, lang) {
  const base = lang.split("-")[0];
  const langOf = (v) => (v.lang || "").replace("_", "-"); // Android writes "en_US"
  return (
    voices.find((v) => langOf(v) === lang && /Google|Microsoft|Natural/i.test(v.name)) ||
    voices.find((v) => langOf(v) === lang) ||
    voices.find((v) => langOf(v).startsWith(base)) ||
    null
  );
}

// Some browsers (iPhone Safari) only allow speech after the user has tapped something.
// Call this inside a click handler once, e.g. on "Answer" or "Call".
export function unlockSpeech() {
  if (!ttsSupported()) return;
  try {
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    speechSynthesis.speak(utterance);
  } catch (e) { /* ignore */ }
}

// Speaks text. Resolves with {played, voice} when finished.
// onStart() fires when the audio actually begins (used to measure latency).
export async function speak(text, lang, { onStart } = {}) {
  if (!ttsSupported()) throw new Error("Text-to-speech is not available in this browser.");
  const voices = await loadVoices();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(voices, lang);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    let started = false;
    let done = false;
    const markStarted = () => { if (!started) { started = true; onStart?.(); } };
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ played: started, voice: voice?.name || "browser default" });
    };
    utterance.onstart = markStarted;
    utterance.onend = () => { markStarted(); finish(); }; // some browsers skip onstart
    utterance.onerror = finish;                          // audio did NOT play
    speechSynthesis.speak(utterance);
    // Safety net: some browsers never fire onend. Do not wait forever.
    setTimeout(finish, 1500 + text.length * 90 + 4000);
  });
}
