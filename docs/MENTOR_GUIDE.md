# SignConnect: Technical Mentor Guide

This guide is for a team with little or no programming experience. Read it from top to bottom.
Every step says what to do, what you should see, and what to do if it goes wrong.

**Contents**
1. [Product architecture: two UI layers](#1-product-architecture-two-ui-layers)
2. [The recommended stack](#2-the-recommended-stack)
3. [System architecture](#3-system-architecture)
4. [Why this is realistic in 3 days](#4-why-this-is-realistic-in-3-days)
5. [Day 0 setup checklist](#5-day-0-setup-checklist)
6. [Project files](#6-project-files)
7. [Step-by-step: install, run, test, deploy](#7-step-by-step)
8. [The supported signs, and how to get good recognition](#8-the-supported-signs)
9. [Figma → code mapping](#9-figma--code-mapping)
10. [Live AI mode and Demo mode](#10-live-ai-mode-and-demo-mode)
11. [Measuring impact (real numbers only)](#11-measuring-impact)
12. [Implemented / Simulated / Future](#12-implemented--simulated--future)
13. [3-day plan](#13-3-day-plan)
14. [Troubleshooting](#14-troubleshooting)
15. [Final demo checklist](#15-final-demo-checklist)
16. [Roadmap](#16-roadmap)
17. [How the code works](#17-how-the-code-works)

---

## 1. Product architecture: two UI layers

```
LAYER 1: SIGNCONNECT APP UI (installed once, activated once)
  App screen 1  Welcome / Activation
  App screen 2  Settings / Permissions
  (no login, no profile, no dashboard, no home page, no camera here)

        Incoming call ──► Trigger (SIMULATED in the MVP)
                              │
                              ▼
LAYER 2: SIGNCONNECT CALL EXPERIENCE (our Figma call screens)
  Layla's phone:  Incoming call → Call connected → Speech → Text
                  → Sign camera → Sign → Text → (caller hears it) → Call summary
  Caller's phone: Calling… → "You are talking to Layla (Deaf user)" → Sign language → Text / Voice
```

- The **Deaf user (Layla)** installs and activates SignConnect **once**. She never has to open it for a call.
- The **hearing caller (Bank Alinma)** installs **nothing**. Their phone just shows the call.
- The **camera belongs to the call experience** (Figma step 6), never to the app UI.

> **Framing for the judges:** "For the MVP, we simulate the incoming-call trigger to demonstrate the communication experience. A production version would require native iOS telephony integration and the appropriate system-level permissions."

---

## 2. The recommended stack

| Part | Choice | Why |
|---|---|---|
| Frontend | Plain **HTML + CSS + JavaScript** | No build step. Edit a file, refresh, and see the change. |
| Backend | **Python 3.12 + Flask** (`app.py`) | Smallest Python web framework. |
| **Sign recognition** | **Pre-trained ASL model** (TensorFlow Lite, 250 ASL signs) running on the **backend** with `ai-edge-litert`, fed by **Google MediaPipe Holistic** landmarks from the browser | A real, pre-trained sign-language model: no training needed, CPU only, about 30–80 ms per sign. |
| Speech-to-Text | Browser **Web Speech API** (Chrome/Edge) on the caller's phone | Free, real time, **Arabic (ar-SA)** and English, no key. |
| Text-to-Speech | Browser **speechSynthesis** on the caller's phone | Free and instant. |
| Frontend ↔ Backend | **REST + JSON over HTTPS**, polling every 0.7 s | Simplest reliable option on a free host. |
| Hosting | **Render** free Web Service | Deploys from GitHub; gives https (needed for camera and mic). |
| Database | None | Calls live in server memory. |

**API keys needed: none.** **GPU needed: no.** **Cost: free.**

### Why this sign-recognition model

| Option | Verdict |
|---|---|
| MediaPipe Gesture Recognizer (7 gestures) | ❌ Not sign language (only "I love you" is an ASL sign). |
| ASL alphabet (fingerspelling) models | ❌ Spelling letter by letter is not a conversation. |
| Our own few-shot classifier (version 1 of this repo) | ❌ The team would have to record samples first; it shipped empty, so it showed the hand but never gave a sign (see 17.4). |
| **Pre-trained isolated-sign ASL model (Google ISLR data, 250 signs)** ✅ | Real ASL words with movement, trained on ~94,000 recordings by 21 Deaf signers. Works out of the box. |

Model details, author and license: `models/asl_islr/README.md`. Reported accuracy: **73.6% top-1 over all 250 signs**.
SignConnect only uses **10** of the 250 signs, which makes the choice much easier for the model, and it rejects uncertain answers.

**Honest framing (use this sentence):**
> The current MVP uses a pre-trained English/ASL sign-language model to demonstrate technical feasibility. A production deployment would require adaptation, testing and validation for Saudi Sign Language (SSL).

---

## 3. System architecture

```
 CALLER'S PHONE (/caller)                 CLOUD BACKEND (Render, Flask)             LAYLA'S PHONE (/)
 ─────────────────────────                ─────────────────────────────             ─────────────────
 Caller speaks
   → Web Speech API (STT) ── text ──────► POST /api/rooms/layla/messages ──poll──► Speech → Text (step 5)

                                                                                     Layla presses Sign
                                                                                     → webcam (step 6)
                                                                                     → MediaPipe Holistic
                                                                                       (in browser, CPU):
                                                                                       lips + hands + arms
                                          POST /api/recognize  ◄── landmark numbers ─┘
                                          → recognizer.py
                                          → pre-trained ASL model (TFLite, CPU)
                                          → "YES" 82% ─────────────────────────────► "نعم، أكّد الموعد"
                                                                                     Layla taps ✓ send
 Text → Speech (speechSynthesis) ◄─poll── POST /api/rooms/layla/messages ◄────────────┘
   → caller HEARS the reply (step 7)
```

| Component | Runs where | Internet? | API key? |
|---|---|---|---|
| Web pages | Served by Render, run in the browser | to load | no |
| Flask backend + call relay | Render (or your laptop) | yes, between phones | no |
| **ASL sign model** | **Backend** (CPU) | browser → backend | no |
| MediaPipe Holistic (landmarks) | Browser (CPU), files in the repo | no | no |
| Speech-to-text | Caller's browser → Google speech service | **yes** | no |
| Text-to-speech | Caller's browser | usually no | no |

**Privacy note for the pitch:** no video or audio is sent to our server. For signs, only the **coordinates** of the lips, hands and arms are sent (numbers, a few KB).

---

## 4. Why this is realistic in 3 days

- **Already built (this repo):** both UI layers, the full call flow on two phones, live Arabic/English captions, real ASL sign recognition by a pre-trained model, voice replies, call summary with measured timings, Demo mode, typed fallback, and a Lab page for accuracy testing.
- **Don't attempt:** real cellular calls, a native iOS app, Saudi Sign Language, training your own model, or continuous sentence translation.
- **Hardware:** an ordinary laptop. MediaPipe ran at about 20 fps on CPU in our tests; the model takes about 30–80 ms per sign.
- **Cloud:** one free Flask service. The model is 7.6 MB, so no GPU server is needed.

---

## 5. Day 0 setup checklist

Do this **before** the hackathon, on every team laptop (about 45 minutes).

**Software**
- [ ] **Google Chrome** (latest). Speech recognition needs Chrome or Edge.
- [ ] **Python 3.12.10**: <https://www.python.org/downloads/release/python-31210/>
  - Windows: *Windows installer (64-bit)*; **tick "Add python.exe to PATH"**.
  - Mac: *macOS 64-bit universal2 installer*. ⚠️ The sign-model library only exists for **Apple-Silicon Macs (M1/M2/M3/M4)**, not Intel Macs. On an Intel Mac, use the Render link to run the app (step 7.6).
  - Check with `python --version` (Windows) or `python3.12 --version` (Mac). You should see `Python 3.12.10`.
- [ ] **Visual Studio Code** with the **Python** extension (by Microsoft).
- [ ] **GitHub Desktop**: <https://desktop.github.com/>. You don't need to install Git separately.

**Accounts (all free)**
- [ ] **GitHub** for every member. The repo owner adds teammates under *Settings → Collaborators*.
- [ ] **Render**: <https://render.com>, *Sign up with GitHub*.
- [ ] **No AI or API accounts. No paid services.**

**Hardware**
- [ ] A laptop with a webcam and microphone.
- [ ] Optional: a second device for the caller (laptop, or an Android phone with Chrome).
- [ ] Phone hotspot as backup internet; external speaker if the room is loud.

**Get the code:** GitHub Desktop → *File → Clone repository → URL* → `https://github.com/88ghadir88-rgb/Silah` → if not merged yet, switch to the branch `claude/signconnect-hackathon-jmrti7`.

---

## 6. Project files

```
Silah/
├── app.py                 ← Flask backend: pages, call relay, summary, /api/recognize
├── recognizer.py          ← runs the pre-trained ASL model + the vocabulary + thresholds
├── models/asl_islr/       ← the pre-trained ASL model (model.tflite, labels.json, LICENSE, README)
├── requirements.txt       ← exact library versions
├── render.yaml            ← Render settings
├── .python-version        ← Python 3.12.10 for Render
├── tests/test_api.py      ← automatic checks (backend + model)
├── docs/MENTOR_GUIDE.md   ← this guide
└── static/
    ├── index.html         ← LAYLA'S PHONE: App UI (2 screens) + Call Experience (Figma)
    ├── caller.html        ← CALLER'S PHONE: Figma steps 1, 4, 7
    ├── stage.html         ← both phones side by side on one laptop (/stage)
    ├── lab.html           ← team tool: try the model, measure accuracy (/lab)
    ├── css/styles.css     ← all styling; Figma colours at the top
    ├── js/config.js       ← sign phrases, demo script, names, defaults   ← EDIT THIS
    ├── js/app.js          ← Layla's phone logic
    ├── js/caller.js       ← caller's phone logic
    ├── js/signs.js        ← webcam + MediaPipe Holistic + sign segmentation
    ├── js/lab.js          ← Lab page logic
    ├── js/api.js          ← talks to the backend
    ├── js/speech.js       ← speech-to-text + text-to-speech
    ├── js/icons.js, ui.js ← icons + small helpers
    └── vendor/mediapipe/  ← Google MediaPipe runtime + Holistic model (don't edit)
```

---

## 7. Step-by-step

### 7.1 Create the virtual environment and install everything (one time)
In VS Code: *File → Open Folder* → `Silah` → *Terminal → New Terminal*, then:

**Windows (PowerShell)**
```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```
**Mac (Apple Silicon)**
```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```
**You should see:** `(.venv)` at the start of the line, and at the end `Successfully installed … ai-edge-litert-2.2.0 … Flask-3.1.3 … numpy-2.2.6 …`.

**If you get an error:**
- `Activate.ps1 cannot be loaded` → run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`.
- `No matching distribution found for ai-edge-litert` → you're on an Intel Mac or a 32-bit Python. Use 64-bit Python 3.12, or use the Render link.

### 7.2 Run the tests
```bash
python -m unittest -v
```
**You should see:** `Ran 12 tests … OK`. These tests also load the ASL model and run it once.

### 7.3 Start the app
```bash
python app.py
```
You should see three addresses. Open in **Chrome**:

| Address | What it is |
|---|---|
| <http://localhost:8000/stage> | **Both phones side by side** (best for a one-laptop demo) |
| <http://localhost:8000/> | Layla's phone only |
| <http://localhost:8000/caller> | The caller's phone only |
| <http://localhost:8000/lab> | Team tool: test the model |

Stop the server with **Ctrl + C**.

### 7.4 First run-through (one laptop, `/stage`)
1. Right phone (Layla): **Activate SignConnect**. Under *Permissions → Camera*, click **Allow**.
2. Left phone (caller): press the green **Call** button. The left phone shows *Calling… Layla* and the right phone rings.
3. Right: **Accept**. Left: *You are talking to Layla*.
4. Speak into the laptop microphone (the left phone listens). Right phone: your words appear under *Conversion Speech → Text*.
5. Right: press **Sign**. The camera opens with the **SignConnect AI** badge. Raise your hand, sign **YES**, then **lower your hand**. The pill shows *Recognizing…*, then **نعم، أكّد الموعد** with the model's confidence.
6. Press **✓**. The left phone shows *Sign Language → Text / Voice* and **speaks** the reply.
7. **End** → call summary on the right.

### 7.5 Measure accuracy (`/lab`)
1. Click *Start camera*, then try each sign and watch the **raw model output**.
2. **Accuracy test:** 5 tries per sign, in random order. Use a tester who is not the person who practised most.
3. The result is saved to the server and shown on the call summary. Report it exactly as measured.

### 7.6 Deploy to the cloud (Render)
1. Push the code to GitHub (GitHub Desktop → *Push origin*).
2. <https://dashboard.render.com> → **New + → Web Service** → choose the `Silah` repo.
3. Fill in:

| Field | Value |
|---|---|
| Language | Python 3 |
| Branch | `main` (or `claude/signconnect-hackathon-jmrti7`) |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --workers 1 --threads 8 --timeout 60 --bind 0.0.0.0:$PORT` |
| Instance Type | **Free** |
| Environment variable | `PYTHON_VERSION` = `3.12.10` |

4. **Create Web Service** and wait for `Your service is live`. Open `https://YOUR-APP.onrender.com/api/health`. It should show `"sign_model_ready": true`.
5. Keep `--workers 1`. The free server sleeps after about 15 minutes, so **open it 5 minutes before the demo**.

### 7.7 Two-device demo (most convincing)
- **Layla** (laptop with webcam): `https://YOUR-APP.onrender.com/`, activated, room `layla`.
- **Caller** (second laptop or Android phone in Chrome): `https://YOUR-APP.onrender.com/caller`, room `layla` → **Call**.

---

## 8. The supported signs

These are 10 of the model's 250 ASL signs. Each one is useful in a call and usually performed with one hand and a clear movement:

| Sign | How (ASL) | Caller hears (Arabic / English) |
|---|---|---|
| YES | Fist nodding up and down | نعم، أكّد الموعد / Yes, please confirm the appointment. |
| NO | Index + middle finger snap onto the thumb | لا / No. |
| THANK YOU | Fingertips at the chin, move forward and down | شكراً لك / Thank you. |
| PLEASE | Flat hand rubs a circle on the chest | من فضلك / Please. |
| HELLO | Flat hand at the temple, moves outward | مرحباً / Hello. |
| BYE | Open hand waves (fingers bend down and up) | مع السلامة / Goodbye. |
| CALL (ON PHONE) | Y-hand at the ear | اتصل بي من فضلك / Please call me. |
| TOMORROW | Thumb on the cheek, arcs forward | غداً / Tomorrow. |
| TIME | Index taps the back of the other wrist | في أي وقت؟ / What time? |
| LATER | L-hand twists forward | لاحقاً / Later. |

**Learn each sign from a real ASL video** (e.g. handspeak.com or lifeprint.com) and practise with the Lab page.
Several signs in a row are combined, e.g. NO + THANK YOU → "لا، شكراً لك".

**How to get good recognition** (these are the conditions the model was trained on):
1. **Face the camera.** Your head and upper body should be visible; the middle of the webcam picture is used.
2. **One sign at a time:** raise your hand, sign, then **lower your hands out of the picture**. Lowering your hands tells the app the sign is finished.
3. Sign at a **natural speed**, near **shoulder or chest height**, with good light from the front.
4. One-handed signs work best. The model saw very few two-handed recordings.

**How the app avoids wrong answers:** a sign is accepted only if (a) at least 8 frames show a hand, (b) the model gives it ≥ 45% among the 10 SignConnect signs, and (c) it is also in the model's **top 15 of all 250 signs**. Otherwise Layla sees "Not recognized. Please sign again." You can change these thresholds at the top of `recognizer.py`.

**Changing the vocabulary:**
1. Pick sign names from `models/asl_islr/labels.json`.
2. Put them in `VOCABULARY` in `recognizer.py`.
3. Add each sign with its phrase in `SIGNS` in `static/js/config.js`.
4. Restart the app and test it in `/lab`.

---

## 9. Figma → code mapping

| Figma frame | Where in the code |
|---|---|
| STEP 1 – Bank: *Calling… Layla* | `caller.html` → `#c-calling` |
| STEP 2 – Layla: *Mobile / Bank Alinma*, Decline / Accept | `index.html` → `#call-incoming` |
| STEP 3 – Layla: timer, *SignConnect* button, call controls | `index.html` → `#call-connected` |
| STEP 4 – Bank: *You are talking to Layla / Deaf user !* | `caller.html` → `#c-talking` |
| STEP 5 – Layla: *Conversion Speech → Text* | `index.html` → `#call-speech` |
| STEP 6 – Layla: camera + *SignConnect AI* + text pill | `index.html` → `#call-sign` |
| STEP 7 – Bank: *Sign Language → Text / Voice* + waveform | `caller.html` → `#c-reply` |
| Call Summary (not in Figma; built in the same style) | `index.html` → `#call-summary` |

**Small functional additions**, kept in the Figma style:
- a **Sign** button next to End on step 5
- ✓ (send) and ↺ (retry) inside the text pill on step 6, so Layla confirms before the caller hears anything
- a one-line caller caption on step 6
- *Mute* on step 4 really mutes the caller's microphone

*Speaker, Mute (Layla), More, Keypad, Message, Remind Me* are visual only.

**To fine-tune the look:** in Figma, select a layer → *Inspect / Dev Mode* → copy colours into the variables at the top of `static/css/styles.css` (`--call-bg`, `--call-btn`, `--end-red`, …). Export icons as SVG into `static/assets/`.

---

## 10. Live AI mode and Demo mode

Choose the mode in Layla's app: *Settings → AI mode*.

| | LIVE AI | DEMO |
|---|---|---|
| Caller's words | Real speech-to-text (or typed, labeled **TYPED**) | Pre-written lines via the orange **DEMO** buttons **outside** the phone, labeled **DEMO · pre-written, not AI** |
| Layla's signs | Real ASL model | Live recognition still works; the **"DEMO: scripted reply (not AI)"** button gives labeled pre-written replies |
| On the phone | – | an orange **DEMO MODE** flag |

**Enforced in code, not only on screen:**
- every message carries `source` = `live_stt` / `live_sign` / `typed` / `demo_script`
- the backend **refuses** pre-written lines in a LIVE call
- timing numbers use live messages only
- the summary lists what was live, typed, or demo
- demo controls sit **outside** the phone frame (operator strip), so they're never confused with the product

---

## 11. Measuring impact

| Metric | Where | How to report |
|---|---|---|
| Sign accuracy | `/lab` accuracy test | "X% (n/N) on 10 ASL signs, 5 tries each, tester not involved in setup" |
| Sign → recognized text | Summary | average over 5 live calls |
| Caller speech → Layla's screen | Summary | average over 5 live calls |
| Layla sends → caller hears | Summary | average over 5 live calls |
| ASL model inference | Summary / `/lab` | "~X ms per sign on a free CPU server" |
| Landmarks per frame | Camera badge (ms, fps) | "X fps on a [laptop], CPU only" |
| Replies given independently | Summary "Replies by live sign a/b" | over 5 scenario runs |
| Speech-to-text WER | By hand | wrong + missing + extra words ÷ total words of 5 read sentences |

Don't invent any numbers. For population figures, quote official sources exactly (WHO, GASTAT).

---

## 12. Implemented / Simulated / Future

**IMPLEMENTED**
- the SignConnect app UI (activation, settings/permissions; real camera permission)
- the call experience on two phones, matching the Figma
- live Arabic/English speech-to-text of the caller
- real ASL sign recognition: MediaPipe Holistic in the browser + pre-trained ASL model on the cloud backend, with confidence thresholds
- sign → text → speech, played on the caller's phone
- call summary with measured timings; accuracy test page; Demo mode with labels; typed fallback; cloud deployment

**SIMULATED**
- the **incoming-call trigger** and the call itself (no cellular network or iOS telephony)
- the *Phone calls*, *Call audio*, *Voice into the call* and *Notifications* permissions (shown as "Simulated in MVP")
- in DEMO mode: the pre-written caller lines and replies (always labeled)
- the visual-only call buttons (Speaker, More, Keypad, …)

**FUTURE**
- native iOS telephony integration and system permissions
- Saudi Sign Language dataset, model, and validation with Deaf users
- larger vocabulary, continuous signing, two-handed and facial grammar
- production speech-to-text with privacy agreements

---

## 13. 3-day plan

- **Day 1:** everyone installs (7.1–7.3) and does the run-through (7.4). Deploy to Render (7.6). The signer learns the 10 signs and practises in `/lab`.
- **Day 2:** run the accuracy test (7.5) and collect timings from 5 live calls. Do a two-device rehearsal (7.7). Fine-tune colours against Figma. Write the honesty slide (section 12).
- **Day 3:** freeze the code. Rehearse 3 times, including once in DEMO mode. Record a backup video. Run the final checklist (section 15).

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| `python`/`py` not recognized | Reinstall Python 3.12.10 with "Add to PATH"; restart VS Code |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `ModuleNotFoundError` | Activate `.venv`, then `python -m pip install -r requirements.txt` |
| `No matching distribution found for ai-edge-litert` | Intel Mac or 32-bit Python: use 64-bit Python 3.12 on Windows or an Apple-Silicon Mac, or the Render link |
| Strip says "ASL model: NOT loaded" | Check the terminal for the error; open `/api/model` |
| `Address already in use` | Use another port: Windows `$env:PORT=8001; python app.py`, Mac `PORT=8001 python app.py` |
| Camera blocked | Click the camera icon in the address bar → Allow → reload |
| "Not recognized" every time | Face the camera, upper body visible, **lower your hands after each sign**, sign at normal speed, practise with a video. Check `/lab` raw output. |
| Always the same wrong sign | Check how the sign is performed; try it at chest/shoulder height; check the top-5 list in `/lab` |
| "Too short" | Sign a little slower; keep your hand in the picture for about 1 second |
| Low fps (< 10) | Plug in the charger, close other tabs; try `?gpu=1` |
| No captions | Use Chrome, allow the microphone, check the internet (or use DEMO mode) |
| No voice on the caller's phone | Check the volume; on a phone, tap something first |
| The phones don't see each other | Same address and same room name on both |
| Render takes about 1 minute to load | The free server was asleep; open it early |

---

## 15. Final demo checklist

- [ ] Render shows *Live*; `/api/health` shows `sign_model_ready: true`
- [ ] Accuracy test done; numbers on the slides
- [ ] The signer has practised the demo signs (YES, NO, THANK YOU, BYE) at least 20 times in `/lab`
- [ ] Laptops charged, notifications off, Zoom/Teams closed
- [ ] Site opened 5 minutes early on both devices; same room
- [ ] Camera and microphone allowed; volume up; light in front of the signer
- [ ] You know how to switch to DEMO mode; a backup video is ready

**Demo script (2–3 minutes):**
1. Show the SignConnect app: activated once, permissions honestly marked "Simulated in MVP".
2. The bank calls (left phone) → Layla's phone rings (simulated trigger) → Accept.
3. The bank speaks Arabic → the text appears for Layla.
4. Layla presses **Sign**, signs **YES** → *نعم، أكّد الموعد* → ✓ → the bank's phone **speaks** it.
5. NO + THANK YOU, BYE → End → summary with **LIVE** labels and measured timings.
6. Honesty slide + roadmap.

---

## 16. Roadmap

| Phase | What |
|---|---|
| 1 | Larger vocabulary (more of the 250 ASL signs, then a larger dataset), continuous signing |
| 2 | **Saudi Sign Language**: collect a consented SSL dataset with Deaf associations and interpreters; train and validate per sign |
| 3 | Testing with Deaf users and accessibility experts (task completion, time, satisfaction) |
| 4 | Real-time accuracy: better segmentation, confidence-based confirmation, on-device models |
| 5 | **Native iOS telephony integration** (call trigger, call audio, system permissions) |
| 6 | Pilots: banks, hospitals, universities, government services, contact centres |

---

## 17. How the code works

### 17.1 One call
1. Caller **Call** → `POST /api/rooms/layla/ring`.
2. Layla's phone polls `GET /api/rooms/layla` every 0.7 s, sees `ringing`, and (if activated) opens the call experience.
3. **Accept** → `POST …/answer {"mode": "live"}`.
4. The caller speaks → STT → `POST …/messages {"sender":"caller","source":"live_stt"}` → shown on Layla's step 5 → ack `displayed`.
5. Layla signs → `signs.js` records the landmarks until her hands go down → `POST /api/recognize`.
6. `recognizer.py` builds a `[frames, 543, 3]` array → the ASL model → 250 probabilities → the best of the 10 SignConnect signs → accept or reject.
7. Layla taps ✓ → `POST …/messages {"sender":"user","source":"live_sign","meta":{"signs":["yes"],…}}`.
8. The caller's phone speaks the text → ack `spoken`. End → `POST …/end` → summary.

### 17.2 API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Server alive + `sign_model_ready` |
| `GET /api/model` | Model info, vocabulary, thresholds |
| `POST /api/recognize` | `{"frames":[{"lips":[x,y…80],"left":[…42]\|null,"right":[…42]\|null,"pose":[…20]\|null}]}` → sign, confidence, top 5 |
| `GET /api/rooms/<room>?since=<n>` | Call status + new messages |
| `POST /api/rooms/<room>/ring` · `/answer` · `/decline` · `/end` | Call control |
| `POST /api/rooms/<room>/messages` | Send text (`sender`, `source`, `text`, `meta`) |
| `POST /api/rooms/<room>/messages/<seq>/ack` | `displayed` / `spoken` (timings) |
| `GET /api/rooms/<room>/summary` | Summary |
| `GET/POST /api/evaluations` | Accuracy tests |

### 17.3 Model input
The model expects MediaPipe Holistic landmarks in the layout it was trained on: 468 face, 21 left hand, 33 pose, 21 right hand per frame. Missing parts are `NaN`. Only x and y are used. The browser sends just the 40 lip points, both hands, and 10 arm points; the server fills in the rest.

### 17.4 Why version 1 showed the hand but no sign
Version 1 drew MediaPipe's **hand landmarks** (that is detection) and then used a k-nearest-neighbour classifier. That classifier only knows signs the team has **recorded on its Train screen**, and the bundled sample file `static/models/sign_model.json` was **empty**. With no examples to compare against, it always answered "unknown". Detection worked; classification had no knowledge.

Version 2 replaces it with a **pre-trained** ASL model that already knows 250 signs. Every label shown comes from that model's output.
