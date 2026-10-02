// SignConnect - configuration you are allowed to change.
// --------------------------------------------------------------------------
// 1. SIGNS:       the vocabulary the sign recognizer can learn.
// 2. DEMO_SCRIPT: the pre-written hospital conversation used in DEMO MODE.
// 3. SETTINGS:    default values for the settings on the home screen.
// --------------------------------------------------------------------------

// Each sign = one static ASL handshape that our classifier learns from your own samples.
// "phrase" is what the hearing caller hears when the sign is recognized.
// HONESTY NOTE: in real ASL most of these signs also include MOVEMENT and a LOCATION
// on the body. The MVP only recognizes the HANDSHAPE (one frame), which is why we call it
// "a small vocabulary of static ASL handshapes", not "ASL translation".
export const SIGNS = [
  {
    id: "YES",
    handshape: "S-hand: closed fist, thumb across the front of the fingers",
    asl: "ASL YES = this fist nodding up and down. We recognize the fist handshape.",
    phrase: { en: "Yes.", ar: "نعم." },
  },
  {
    id: "NO",
    handshape: "Index + middle finger straight and together, thumb out (like a beak)",
    asl: "ASL NO = index and middle finger snapping down onto the thumb.",
    phrase: { en: "No.", ar: "لا." },
  },
  {
    id: "THANK_YOU",
    handshape: "Flat B-hand: fingers straight and together, thumb tucked",
    asl: "ASL THANK-YOU = flat hand moving forward from the chin.",
    phrase: { en: "Thank you.", ar: "شكراً لك." },
  },
  {
    id: "FINE",
    handshape: "5-hand: all five fingers spread wide",
    asl: "ASL FINE = spread hand, thumb touching the chest.",
    phrase: { en: "That time works for me.", ar: "هذا الموعد مناسب لي." },
  },
  {
    id: "HELP",
    handshape: "A-hand with thumb pointing up (thumbs-up)",
    asl: "ASL HELP = this hand resting on the other flat palm, lifted up.",
    phrase: { en: "I need help, please.", ar: "أحتاج إلى مساعدة من فضلك." },
  },
  {
    id: "PHONE",
    handshape: "Y-hand: thumb and little finger out, other fingers folded",
    asl: "ASL PHONE/CALL = Y-hand held at the ear.",
    phrase: { en: "Please send me the details by text message.", ar: "من فضلك أرسل لي التفاصيل برسالة نصية." },
  },
];

// DEMO MODE ONLY. These lines are pre-written. The app always labels them "DEMO · scripted"
// and the backend never counts them in the latency/accuracy results.
// "reply" = the signs Sara is expected to answer with (used by the "Use scripted reply" button).
export const DEMO_SCRIPT = [
  {
    caller: {
      en: "Hello, this is the appointments desk at City General Hospital. Am I speaking with Sara?",
      ar: "مرحباً، معك قسم المواعيد في مستشفى المدينة العام. هل أتحدث مع سارة؟",
    },
    reply: ["YES"],
  },
  {
    caller: {
      en: "Your appointment with Dr. Khalid at the dermatology clinic is on Sunday at 10:30 in the morning. Does this time work for you?",
      ar: "موعدك مع الدكتور خالد في عيادة الجلدية يوم الأحد الساعة العاشرة والنصف صباحاً. هل يناسبك هذا الموعد؟",
    },
    reply: ["FINE"],
  },
  {
    caller: {
      en: "Great, your appointment is confirmed. Please arrive fifteen minutes early and bring your ID card. Would you like a reminder?",
      ar: "ممتاز، تم تأكيد موعدك. يرجى الحضور قبل الموعد بخمس عشرة دقيقة وإحضار بطاقة الهوية. هل ترغبين في تذكير؟",
    },
    reply: ["PHONE"],
  },
  {
    caller: {
      en: "Done, we will send you a text message. Is there anything else I can help you with?",
      ar: "تم، سنرسل لك رسالة نصية. هل هناك أي شيء آخر يمكنني مساعدتك به؟",
    },
    reply: ["NO", "THANK_YOU"],
  },
  {
    caller: {
      en: "You're welcome, Sara. Goodbye!",
      ar: "العفو يا سارة. مع السلامة!",
    },
    reply: [],
  },
];

export const DEFAULT_SETTINGS = {
  mode: "live",          // "live" = real AI, "demo" = scripted caller lines (clearly labeled)
  callerDevice: "same",  // "same" = caller speaks into THIS laptop, "separate" = caller uses /caller page
  lang: "en-US",         // speech language: "en-US" or "ar-SA"
  room: "sara",          // both devices must use the same room name
};

export const CALLER = {
  name: "City General Hospital",
  department: "Appointments Desk",
  number: "+966 11 000 0000",
};

// Sign recognition tuning (change only if recognition feels too slow / too jumpy).
export const RECOGNITION = {
  k: 5,                  // k-nearest-neighbours: how many closest samples vote
  minConfidence: 0.6,    // at least 3 of 5 neighbours must agree
  holdMs: 700,           // the sign must be held steady this long before it counts
  rejectFactor: 2.0,     // larger = accepts less-similar hands (more mistakes, fewer misses)
  samplesPerRecording: 40,
};

export function phraseFor(signIds, lang) {
  const key = lang.startsWith("ar") ? "ar" : "en";
  return signIds
    .map((id) => SIGNS.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => s.phrase[key])
    .join(" ");
}

export function signLabel(id) {
  return id.replace("_", " ");
}
