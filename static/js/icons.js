// SignConnect - simple line icons (inline SVG), drawn to look like the iOS call screen in our Figma.
// Use in HTML as <span data-icon="speaker"></span>, then call applyIcons().

const svg = (body, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  speaker: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  video: svg('<rect x="2.5" y="6.5" width="13" height="11" rx="2.5" fill="currentColor" stroke="none"/><path d="M16.5 10.5l5-3v9l-5-3z" fill="currentColor" stroke="none"/>'),
  micOff: svg('<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none"/><path d="M5.5 11a6.5 6.5 0 0 0 11.2 4.5M18.5 11v0M12 17.5V21M4 4l16 16"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>'),
  keypad: svg([5, 12, 19].flatMap((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="1.7" fill="currentColor" stroke="none"/>`)).join("")),
  endCall: svg('<path d="M3 13.5c5-4.6 13-4.6 18 0l-2.2 2.6-3.6-1.4v-2.3a10 10 0 0 0-6.4 0v2.3l-3.6 1.4z" fill="currentColor" stroke="none"/>'),
  phone: svg('<path d="M6.6 3.5l2.7 3.3-1.6 2.4a12 12 0 0 0 7.1 7.1l2.4-1.6 3.3 2.7-1.4 3.1c-.4.9-1.4 1.3-2.3 1A18 18 0 0 1 2.5 7.2c-.3-.9.1-1.9 1-2.3z" fill="currentColor" stroke="none"/>'),
  message: svg('<path d="M12 4c4.7 0 8.5 3 8.5 6.8s-3.8 6.8-8.5 6.8c-.9 0-1.8-.1-2.6-.3L5 19.5l1.2-3.6C4.5 14.6 3.5 12.8 3.5 10.8 3.5 7 7.3 4 12 4z" fill="currentColor" stroke="none"/>'),
  alarm: svg('<circle cx="12" cy="13" r="7" fill="currentColor" stroke="none"/><path d="M4 5l3-2.5M20 5l-3-2.5M12 9.5V13l2.5 1.5" stroke="#3b3a33"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  // "Deaf / hearing access" symbol: an ear with a slash
  deaf: svg('<path d="M8 15.5c0 2 1.3 3.5 3 3.5 1.5 0 2.2-1 2.6-2.3.5-1.6 1.6-2.4 2.6-3.4A5.6 5.6 0 0 0 12.1 3.6 5.6 5.6 0 0 0 6.5 9.2"/><path d="M10 9.5a2.2 2.2 0 1 1 3.6 1.7c-.8.6-1.1 1.3-1.1 2.3"/><path d="M3.5 20.5L20.5 3.5" stroke-width="2"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11V4a1.5 1.5 0 0 1 3 0v7V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.7 7-6.5 7-2.3 0-3.7-1-5-3l-2.6-4.2a1.5 1.5 0 0 1 2.5-1.6z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  retry: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"/>'),
  shield: svg('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  camera: svg('<path d="M4 8h3l1.8-2.5h6.4L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.4"/>'),
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  wave: svg('<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10.5v3M21 12h0"/>'),
};

export function applyIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.dataset.iconDone && ICONS[el.dataset.icon]) {
      el.innerHTML = ICONS[el.dataset.icon];
      el.dataset.iconDone = "1";
    }
  });
}
