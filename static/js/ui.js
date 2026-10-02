// SignConnect - small helpers shared by all pages.

export const $ = (id) => document.getElementById(id);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
export function toast(message, ms = 3500) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// Every message shows WHERE it came from. These labels are the core of our honesty policy.
export const SOURCE_LABELS = {
  live_stt: { text: "LIVE · speech-to-text", css: "live" },
  live_sign: { text: "LIVE · ASL model", css: "live" },
  typed: { text: "TYPED · manual fallback", css: "typed" },
  demo_script: { text: "DEMO · pre-written, not AI", css: "demo" },
};

export function sourceTag(source) {
  const label = SOURCE_LABELS[source] || { text: source, css: "" };
  return `<span class="tag ${label.css}">${label.text}</span>`;
}

// iOS-style clock in the status bar
export function startStatusClock() {
  const update = () => {
    const now = new Date();
    const text = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;
    document.querySelectorAll(".sb-time").forEach((el) => (el.textContent = text));
  };
  update();
  setInterval(update, 10000);
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function setNetStatus(online) {
  const el = $("netStatus");
  if (!el) return;
  el.textContent = online ? "● server connected" : "● server unreachable – retrying…";
  el.className = `net ${online ? "ok" : "bad"}`;
}
