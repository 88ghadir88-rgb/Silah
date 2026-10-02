// SignConnect - configuration you are allowed to change.
// --------------------------------------------------------------------------
// 1. SIGNS:       the vocabulary. The ids MUST match VOCABULARY in recognizer.py
//                 (they are sign names from the pre-trained ASL model's 250-sign list).
// 2. DEMO_SCRIPT: the pre-written Bank Alinma conversation used ONLY in DEMO MODE.
// 3. SETTINGS / NAMES: defaults.
// --------------------------------------------------------------------------

// "phrase" = what the hearing caller hears when this sign is recognized by the model.
// You may change the phrases (e.g. YES -> "نعم، أكّد الموعد" matches our Figma story).
// "how" = how the sign is performed in ASL. Practise with a video dictionary such as
// https://www.handspeak.com or https://www.lifeprint.com before the demo.
export const SIGNS = [
  { id: "yes", gloss: "YES", phrase: { ar: "نعم، أكّد الموعد", en: "Yes, please confirm the appointment." },
    how: "Make a fist (S-hand) at chest height and nod it up and down, like a head nodding." },
  { id: "no", gloss: "NO", phrase: { ar: "لا", en: "No." },
    how: "Index and middle finger extended, snap them down onto the thumb (twice)." },
  { id: "thankyou", gloss: "THANK YOU", phrase: { ar: "شكراً لك", en: "Thank you." },
    how: "Flat hand, fingertips touch the chin, then move the hand forward and down." },
  { id: "please", gloss: "PLEASE", phrase: { ar: "من فضلك", en: "Please." },
    how: "Flat hand on the chest, rub it in a circle." },
  { id: "hello", gloss: "HELLO", phrase: { ar: "مرحباً", en: "Hello." },
    how: "Flat hand next to the temple, move it outward (like a small salute). Keep it near shoulder height." },
  { id: "bye", gloss: "BYE", phrase: { ar: "مع السلامة", en: "Goodbye." },
    how: "Open hand, palm facing the camera, bend the fingers down and up (wave)." },
  { id: "callonphone", gloss: "CALL (ON PHONE)", phrase: { ar: "اتصل بي من فضلك", en: "Please call me." },
    how: "Y-hand (thumb and little finger out) held at the ear like a phone, move it slightly." },
  { id: "tomorrow", gloss: "TOMORROW", phrase: { ar: "غداً", en: "Tomorrow." },
    how: "Thumb of an A-hand on the cheek near the jaw, arc it forward." },
  { id: "time", gloss: "TIME", phrase: { ar: "في أي وقت؟", en: "What time?" },
    how: "Tap the back of the other wrist with a bent index finger (where a watch would be)." },
  { id: "later", gloss: "LATER", phrase: { ar: "لاحقاً", en: "Later." },
    how: "L-hand (thumb + index finger), twist it forward, pivoting on the thumb." },
];

// DEMO MODE ONLY. These lines are pre-written. The app always labels them "DEMO · pre-written"
// and the backend never counts them in latency or accuracy results.
// "reply" = the signs used by the "Use scripted reply (DEMO)" button.
export const DEMO_SCRIPT = [
  {
    caller: {
      ar: "مرحباً، حاب أأكد الموعد؟",
      en: "Hello, I would like to confirm the appointment?",
    },
    reply: ["yes"],
  },
  {
    caller: {
      ar: "تم تأكيد الموعد. هل تحتاجين أي شيء آخر؟",
      en: "Your appointment is confirmed. Do you need anything else?",
    },
    reply: ["no", "thankyou"],
  },
  {
    caller: { ar: "العفو، مع السلامة!", en: "You're welcome. Goodbye!" },
    reply: ["bye"],
  },
];

export const NAMES = {
  caller: "Bank Alinma",          // shown on Layla's phone
  callerNumber: "Mobile",
  user: "Layla",                  // shown on the caller's phone
};

export const DEFAULT_SETTINGS = {
  mode: "live",      // "live" = real AI, "demo" = pre-written lines (clearly labeled)
  lang: "ar-SA",     // speech language: "ar-SA" (Arabic) or "en-US" (English)
  room: "layla",     // both phones must use the same room name
};

export function langKey(lang) {
  return lang.startsWith("ar") ? "ar" : "en";
}

export function signInfo(id) {
  return SIGNS.find((s) => s.id === id) || { id, gloss: id.toUpperCase(), phrase: { ar: id, en: id }, how: "" };
}

export function phraseFor(signIds, lang) {
  const key = langKey(lang);
  return signIds.map((id) => signInfo(id).phrase[key]).join(key === "ar" ? "، " : " ");
}

export function glossFor(signIds) {
  return signIds.map((id) => signInfo(id).gloss).join(" + ");
}
