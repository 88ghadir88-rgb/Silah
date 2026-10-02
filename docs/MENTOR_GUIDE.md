# SignConnect: Technical Mentor Guide

This guide is for a team with little or no programming experience. Read it from top to bottom.
Every step says what to do, what you should see, and what to do if it goes wrong.

**Contents**
1. [The recommended stack (one choice for each part)](#1-the-recommended-stack)
2. [Architecture](#2-architecture)
3. [Why this is realistic in 3 days](#3-why-this-is-realistic-in-3-days)
4. [Day 0 setup checklist (before the hackathon)](#4-day-0-setup-checklist)
5. [Project files: what each one does](#5-project-files)
6. [Step-by-step: run, train, test, deploy](#6-step-by-step)
7. [Matching your Figma design](#7-matching-your-figma-design)
8. [Live AI mode and Demo mode](#8-live-ai-mode-and-demo-mode)
9. [Measuring impact (real numbers only)](#9-measuring-impact)
10. [Implemented / Simulated / Future](#10-implemented--simulated--future)
11. [3-day plan](#11-3-day-plan)
12. [Troubleshooting](#12-troubleshooting)
13. [Final demo checklist](#13-final-demo-checklist)
14. [Roadmap](#14-roadmap)
15. [How the code works (for curious team members)](#15-how-the-code-works)

---

## 1. The recommended stack

| Part | Our choice | Why we chose it |
|---|---|---|
| **Frontend** | Plain **HTML + CSS + JavaScript** (no framework) | Nothing to compile or install. You edit a file, press refresh, and see the change. Your 7 Figma screens become 7 `<section>` blocks in one file. |
| **Backend** | **Python 3.12 + Flask** | Flask is the smallest Python web framework. The whole backend is one file (`app.py`) with one real dependency. |
| **Speech-to-Text** | The browser's built-in **Web Speech API** (Chrome/Edge) | Free, no API key, real-time partial captions, supports English **and Arabic (ar-SA)**. |
| **Sign recognition** | **Google MediaPipe Hand Landmarker** (pre-trained) + a small **k-Nearest-Neighbours classifier** calibrated on samples you record yourselves | Runs in the browser on a normal laptop CPU at real-time speed. No GPU, no API key, Apache-2.0 license. Works offline. See the comparison below. |
| **Text-to-Speech** | The browser's built-in **speechSynthesis** | Free, instant, no key, mostly offline. |
| **Frontend ↔ Backend** | **REST over HTTPS + polling** (the browser asks “anything new?” every 0.7 s) | Simplest thing that works everywhere, including Render's free plan. WebSockets would add complexity with no visible benefit for a 2-person call. |
| **Cloud hosting** | **Render** (free Web Service) | Deploys directly from GitHub, gives you an `https://` address (required for camera and microphone), and needs no Docker. |
| **Database** | **None** | Calls live in server memory. You don't need to keep data after the demo. |
| **Code sharing** | **GitHub** + **GitHub Desktop** | You click buttons instead of typing git commands. |

**API keys needed: none.** Nothing in this project costs money.

### Options we compared (and why we didn't pick them)

**Frontend**
| Option | Verdict |
|---|---|
| HTML/CSS/JS ✅ | No build tools. You can see exactly what the browser runs. |
| React | Needs Node.js, npm, a build step, and new concepts like JSX, state, and hooks. That's too much to learn in 3 days. |
| Streamlit | Easy for dashboards, but every click reloads the page. Live webcam, live captions, and a phone-like UI are hard to do with it. |

**Backend**
| Option | Verdict |
|---|---|
| Flask ✅ | One file, very beginner-friendly, lots of tutorials. |
| FastAPI | Also good, but its async style and type hints add concepts you don't need here. |

**Speech-to-Text**
| Option | Verdict |
|---|---|
| Web Speech API ✅ | Free, real-time, no key. Downsides: Chrome/Edge only, needs internet (Chrome sends the audio to Google). We cover these with Demo mode and the typed fallback. |
| OpenAI Whisper on your laptop | Too slow for real time on a laptop CPU, and a big install (PyTorch). |
| Whisper / Deepgram / Google Cloud / Azure APIs | Accurate, but they need an account, a key, sometimes a credit card, and streaming code. This is the right production path (see Roadmap). |

**Sign language recognition**

| Option | Signs | Ready to use? | Hardware | Setup risk | Verdict |
|---|---|---|---|---|---|
| MediaPipe **Gesture Recognizer** (default model) | 7 generic gestures (thumbs up, victory…) | Yes | CPU, browser | Very low | ❌ Only one gesture (“I love you”) is an actual ASL sign. Calling it sign language would be dishonest. |
| **ASL alphabet** image classifiers (Kaggle CNNs, Roboflow models) | 26 letters (fingerspelling) | Partly; often needs an API key or a Python TensorFlow server | CPU/GPU | Medium | ❌ Spelling “Y-E-S” letter by letter is not a realistic conversation, and accuracy drops a lot with different backgrounds and lighting. |
| **Word-level ASL models** (Kaggle *Isolated Sign Language Recognition*, 250 signs; WLASL I3D) | 250–2000 words, with motion | Weights are scattered across competition notebooks; preprocessing has to match exactly | CPU possible | **High** | ❌ for this hackathon. The model needs full-body landmark sequences, start/end detection, and a TFLite runtime, and accuracy on new signers through a webcam is unproven. **This is our Phase 1 upgrade.** |
| **MediaPipe Hand Landmarker + kNN on your own samples** ✅ | 6 static ASL handshapes (you can add more) | Yes: the pre-trained hand model is included in this repo | CPU, browser, real time | **Low** | ✅ Reliable, fast, offline, honest, and **measurable** with the built-in Test screen. |

**Why the chosen approach works:** Google's pre-trained model does the hard part, which is finding the hand and 21 joint points in any lighting and against any background. The kNN classifier only needs to tell 6 hand shapes apart, and about 40 examples per sign is enough for that. You record those examples in about 5 minutes on the **Train** screen.

**The honest limitation:** real ASL signs also include **movement** and a **location on the body**. The MVP only recognizes the **handshape**. So say *“a small vocabulary of static ASL handshapes”*, not *“ASL translation”*.

**Supported vocabulary (you can change it in `static/js/config.js`):**

| Sign | Handshape | Caller hears |
|---|---|---|
| YES | S-hand (fist) | “Yes.” |
| NO | index + middle finger + thumb | “No.” |
| THANK YOU | flat B-hand | “Thank you.” |
| FINE | 5-hand (fingers spread) | “That time works for me.” |
| HELP | A-hand, thumb up | “I need help, please.” |
| PHONE | Y-hand | “Please send me the details by text message.” |

Signs can be combined: NO + THANK YOU → “No. Thank you.”

**Disclaimer to use (on the home screen already, and on your slides):**
> The current MVP recognizes a small set of static ASL (American Sign Language) handshapes using Google's pre-trained MediaPipe hand-tracking model and a lightweight classifier calibrated on samples recorded by our team. It demonstrates technical feasibility. It is not full sign-language translation and does not support Saudi Sign Language. Production deployment would require adaptation, testing and validation for Saudi Sign Language (SSL) with Deaf users.

---

## 2. Architecture

```
 HEARING CALLER  ──►  DEAF USER (Sara)
 ─────────────────────────────────────────────────────────────────────────────
  Caller speaks ─► Microphone ─► Web Speech API (STT) ─► text ─► Flask backend
                                 (in the browser;               (stores message,
                                  audio goes to Google)          timestamps it)
                                                                      │ polling
                                                                      ▼
                                                    Sara's screen shows the caption

 DEAF USER (Sara)  ──►  HEARING CALLER
 ─────────────────────────────────────────────────────────────────────────────
  Sara signs ─► Webcam ─► MediaPipe Hand Landmarker ─► 21 hand points
                          (pre-trained, in the browser, CPU)
                ─► kNN classifier ─► sign "YES" ─► phrase "Yes." ─► Flask backend
                   (in the browser)                                     │ polling
                                                                        ▼
                                  caller's device ─► speechSynthesis (TTS) ─► caller hears "Yes."
```

```
 ┌──────────────────────────────┐        HTTPS (REST + JSON)       ┌────────────────────────────┐
 │  WEB FRONTEND (browser)      │  POST /api/rooms/sara/messages   │  CLOUD BACKEND (Render)    │
 │                              │ ───────────────────────────────► │  Flask  (app.py)           │
 │  index.html  = Sara's app    │                                  │                            │
 │  caller.html = caller's app  │  GET /api/rooms/sara?since=12    │  • call state (ringing,    │
 │                              │ ◄─────────────────────────────── │    connected, ended)       │
 │  AI that runs HERE:          │       every 0.7 s (polling)      │  • message relay           │
 │  • Web Speech API  (STT) ────┼──► Google speech service         │  • timestamps & latency    │
 │  • MediaPipe hand model      │    (cloud, used by Chrome)       │  • call summary            │
 │  • kNN sign classifier       │                                  │  • accuracy test results   │
 │  • speechSynthesis (TTS)     │                                  │  (no audio, no video)      │
 └──────────────────────────────┘                                  └────────────────────────────┘
```

**Where each part runs**

| Component | Runs where | Internet needed? | API key? | Cost / limits |
|---|---|---|---|---|
| Web pages (HTML/CSS/JS) | Served by Render, executed in the browser | To load the page | No | Free |
| Flask backend | Render cloud (or your laptop while developing) | Yes, between devices | No | Render free plan: the server sleeps after ~15 min without visitors and takes up to about a minute to wake up |
| Speech-to-Text | Browser → Google's speech service | **Yes** | No | Free, no published quota for Chrome; Chrome/Edge only |
| Hand model + sign classifier | **In the browser, on the laptop CPU** | No (files are inside this repo) | No | Free, Apache-2.0 |
| Text-to-Speech | Browser / operating system voices | Usually no | No | Free |
| GPU | **Not required** | – | – | – |

**Why the AI runs in the browser:** video never leaves the device (good for privacy), there's no upload delay, and you don't need a paid GPU server. The cloud backend connects the two people in the call and records the measurements. That is a realistic design for this kind of product.

---

## 3. Why this is realistic in 3 days

**What you can realistically build (and this repo already contains it):**
- a simulated incoming call with Answer/Decline, a call timer, and End call
- live captions of the caller's speech (English or Arabic)
- webcam sign recognition of 6 signs that you train yourselves
- the signed reply spoken aloud to the caller
- a call summary with transcript, sources, and measured latency
- a Train screen and an accuracy Test screen
- a separate caller page, so a second laptop or Android phone acts as the “hospital phone”

**What you should NOT attempt in 3 days:**
- real cellular calls (iOS and Android don't allow apps to read or inject call audio; real calls need a telecom provider such as Twilio, phone numbers, and approvals)
- training a sign-language model from scratch, or anything for Saudi Sign Language (no public dataset or model is ready)
- continuous sentence-level sign translation
- user accounts, databases, Docker, native mobile apps

**Feasibility arguments for the judges:**
- **Model availability:** Google's production MediaPipe hand model, Apache-2.0, already bundled in the repo (`static/vendor/mediapipe/`).
- **Data:** you only need about 40 samples per sign, recorded by the team on the Train screen in a few minutes.
- **Hardware:** an ordinary laptop CPU runs the hand model in real time. No GPU.
- **Cloud:** one small Flask service on a free plan. No GPU server, no API keys, no cost.

---

## 4. Day 0 setup checklist

Do all of this **before** the hackathon, on **every** team laptop. It takes about 45 minutes.

### Software
- [ ] **Google Chrome** (latest): <https://www.google.com/chrome/>. Speech recognition only works in Chrome or Edge. Use Chrome for everything.
- [ ] **Python 3.12.10**: <https://www.python.org/downloads/release/python-31210/>
  - Windows: download the *Windows installer (64-bit)*. On the first installer screen, **tick “Add python.exe to PATH”**, then click *Install Now*.
  - macOS: download the *macOS 64-bit universal2 installer* and run it.
  - Check: open a terminal (Windows: *PowerShell*; Mac: *Terminal*) and type `python --version` (Windows) or `python3.12 --version` (Mac). You should see `Python 3.12.10`.
- [ ] **Visual Studio Code**: <https://code.visualstudio.com/>. After installing, open it, go to *Extensions* (the 4-squares icon), and install **Python** (by Microsoft).
- [ ] **GitHub Desktop**: <https://desktop.github.com/>. Sign in with your GitHub account.

### Accounts
- [ ] **GitHub** account for every member (free): <https://github.com/signup>. The repo owner adds teammates under *Settings → Collaborators*.
- [ ] **Render** account (free): <https://render.com>. Click *Get Started* and **sign up with GitHub**. (Free web services did not require a credit card when this guide was written. If Render asks for one, tell your mentor.)
- [ ] No AI or API accounts are needed.

### Hardware & browser checks
- [ ] A laptop with a working **webcam** and **microphone**.
- [ ] Optional but recommended: a **second device** for the hearing caller (second laptop with Chrome, or an **Android phone with Chrome**). iPhone Safari speech recognition is less reliable, so use the typed fallback there if needed.
- [ ] A **phone hotspot** as a backup Wi-Fi.
- [ ] Wired or USB **speakers** if the room is loud (laptop speakers are quiet).
- [ ] Test the camera and microphone in Chrome: open <https://webcamtests.com> and <https://mictests.com> (or any similar site).

### Get the code (one-time)
- [ ] In GitHub Desktop: *File → Clone repository → URL* → `https://github.com/88ghadir88-rgb/Silah` → choose a folder (e.g. *Documents*) → **Clone**.
- [ ] If the code is still on the branch `claude/signconnect-hackathon-jmrti7` (not merged to `main` yet), select that branch in the *Current branch* menu at the top of GitHub Desktop.

---

## 5. Project files

```
Silah/
├── app.py                      ← Flask backend (cloud). Serves the pages + the API.
├── requirements.txt            ← exact Python library versions
├── render.yaml                 ← Render settings (same as the manual steps in 6.5)
├── .python-version             ← tells Render to use Python 3.12.10
├── README.md                   ← short overview
├── docs/MENTOR_GUIDE.md        ← this guide
├── tests/test_api.py           ← automatic checks for the backend
└── static/                     ← everything the browser downloads
    ├── index.html              ← Sara's app: the 7 Figma screens + Train + Test
    ├── caller.html             ← the hearing caller's page ("hospital phone")
    ├── css/styles.css          ← all styling; Figma colours go at the top
    ├── js/config.js            ← signs, phrases, demo script, settings  ← EDIT THIS
    ├── js/app.js               ← Sara's screen logic
    ├── js/caller.js            ← caller page logic
    ├── js/api.js               ← talks to the backend (REST + polling)
    ├── js/speech.js            ← speech-to-text + text-to-speech
    ├── js/signs.js             ← webcam + MediaPipe + kNN classifier
    ├── models/sign_model.json  ← your trained signs (empty until you train; see 6.4)
    ├── assets/logo.svg         ← replace with your Figma logo
    └── vendor/mediapipe/       ← Google's pre-trained hand model + its runtime (don't edit)
```

You will mainly edit **`config.js`** (vocabulary, phrases, demo script), **`styles.css`** (Figma look), and **`index.html`** (texts and layout).

---

## 6. Step-by-step

### 6.1 Open the project and create a virtual environment

A *virtual environment* is a private folder of Python libraries for this project only.

1. Open **VS Code** → *File → Open Folder* → select the `Silah` folder.
2. Open the built-in terminal: *Terminal → New Terminal*.
3. Run these commands one line at a time:

**Windows (PowerShell):**
```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**macOS (Terminal):**
```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**You should see:** `(.venv)` at the start of the terminal line, and at the end `Successfully installed Flask-3.1.3 ...`.

**If you see an error:**
- `Activate.ps1 cannot be loaded because running scripts is disabled` → run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, then try again.
- `py is not recognized` / `python3.12: command not found` → Python is not installed or not on PATH. Reinstall Python 3.12.10 and tick *Add python.exe to PATH*.
- If VS Code asks *“We noticed a new environment… select it for the workspace?”* → click **Yes**.

> Every time you open a new terminal, activate the environment again (the second command above).

### 6.2 Run the automatic tests
```bash
python -m unittest -v
```
**You should see:** `Ran 7 tests ... OK`. If not, copy the error message to your mentor or ChatGPT/Claude.

### 6.3 Run the app on your laptop
```bash
python app.py
```
**You should see:**
```
  SignConnect is running.
  Sara (Deaf user) screen:  http://localhost:8000/
  Hearing caller screen:    http://localhost:8000/caller
```
Open **Chrome** at <http://localhost:8000>. Stop the server with **Ctrl + C** in the terminal.

**First test (Demo mode, about 2 minutes):**
1. Settings: *AI mode* = **DEMO**, *caller is* = **on this laptop**.
2. Click **📞 Simulate incoming hospital call** → **Answer**.
3. Click **▶ Play next scripted caller line (DEMO)**. The text appears.
4. Click **✋ Reply in sign language** and allow the camera. You should see yourself.
5. Click **▶ Use scripted reply (DEMO)** → **Review →** → **🔊 Speak to caller**. You should hear “Yes.”
6. Repeat 3–5, then click **End** to see the summary. All items are labeled **DEMO**.

**If it doesn't work:**
- `Address already in use` → another program is using port 8000. Run with another port: Windows `$env:PORT=8001; python app.py`, Mac `PORT=8001 python app.py`, then open `http://localhost:8001`.
- Blank page or buttons do nothing → press **F12** → *Console* tab → read the red error. Usually it's a typo in a file you edited.

### 6.4 Train the signs (Live AI)

1. Home → **✋ Train signs**. Allow the camera.
2. Good conditions: face a window or lamp (light in front of you, not behind), plain background, your hand fully visible and about 40–60 cm from the camera.
3. For each sign: click **● Record**. After “Get ready”, hold the handshape and **move it slightly** for 4 seconds (a bit closer and further away, small turns). This variety makes recognition robust.
4. Record each sign **2–3 times** (it adds up: 80–120 samples per sign). If possible, let **two different team members** record.
5. Watch **Live guess** below the camera: it should show the right sign when you make it, and *unknown* when your hand is relaxed.
6. If two signs get confused (e.g. YES and HELP), record more samples of both, showing the difference clearly (thumb up vs. thumb across).

Samples are saved automatically **in this browser on this laptop**.

**Share the model with the team and the cloud version:**
1. Click **⬇ Download model file** → you get `sign_model.json`.
2. Replace the file `static/models/sign_model.json` in the project with it.
3. GitHub Desktop → commit (“Add trained sign model”) → **Push origin**. Render redeploys automatically (6.5).
4. Any browser with no samples of its own loads this file. Click **↺ Use bundled model** to switch to it.

### 6.5 Measure accuracy (Test screen)

1. Home → **📊 Test accuracy**. Enter the tester's name.
2. Choose **5 tries per sign** → **▶ Start test**.
3. When a sign appears, make it. Lower your hand when it says “Lower your hand”.
4. At the end you get overall accuracy, per-sign accuracy, mistakes, and speed. The result is saved to the server and shown on the call summary.
5. **Fair testing:** the most convincing number comes from a tester who did **not** record training samples. Report it exactly as measured, for example: *“87% (26/30), 1 tester not in the training data, indoor lighting”*.

### 6.6 Live call on one laptop

Settings: *AI mode* = **LIVE AI**, *caller is* = **on this laptop**, language = English or Arabic.

1. Simulate call → Answer. The microphone status turns green.
2. A teammate (the “hospital”) speaks: *“Hello, this is City General Hospital. Am I speaking with Sara?”* The caption appears live.
3. Sara clicks **Reply in sign language**, signs **YES**, holds it until the bar fills, then clicks **Review → Speak to caller**. The laptop says “Yes.”
4. Continue the scenario, then **End**.

The microphone is switched off automatically while the laptop speaks, so the app doesn't caption its own voice.

### 6.7 Deploy to the cloud (Render)

1. Make sure your latest code is pushed to GitHub (GitHub Desktop → *Push origin*).
2. <https://dashboard.render.com> → **New + → Web Service** → connect GitHub → choose the **Silah** repo.
3. Fill in:
   | Field | Value |
   |---|---|
   | Name | `signconnect` (it becomes part of the address) |
   | Language | `Python 3` |
   | Branch | `main` (or `claude/signconnect-hackathon-jmrti7` if not merged yet) |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `gunicorn app:app --workers 1 --threads 8 --timeout 60 --bind 0.0.0.0:$PORT` |
   | Instance Type | **Free** |
   | Environment Variables | `PYTHON_VERSION` = `3.12.10` |
4. Click **Create Web Service**. Wait about 3–5 minutes until the log says `Your service is live 🎉`.
5. Open `https://signconnect-XXXX.onrender.com` (your address is shown at the top). Test `/api/health`. It should show `{"ok": true, ...}`.

**Important:**
- Keep `--workers 1`. With more workers the two sides of the call would end up in different memory and never see each other.
- The free server **sleeps** after about 15 minutes without visitors. **Open the site 5 minutes before you present** and keep a tab open.
- The server forgets calls when it restarts. That's fine for a demo.

### 6.8 Two-device call (most convincing demo)

- Sara's laptop: open the Render address → settings: **LIVE AI**, caller **on another device**, room `sara`.
- Hospital device (second laptop or Android phone, in Chrome): open `https://YOUR-APP.onrender.com/caller?room=sara` → **📞 Call Sara**.
- Sara's screen rings → Answer → the caller speaks → Sara reads → Sara signs → **the caller's device speaks the reply**.

Both must use **https** (the Render address). Phones can't use the microphone on `http://` addresses.

---

## 7. Matching your Figma design

Figma is a design tool. It can't run your app, and Python can't “connect to Figma”. Instead, you **copy the design values** into the web code. The code is already organised like your 7 frames:

| Figma frame | In `static/index.html` |
|---|---|
| 1. Incoming Call | `<section id="screen-incoming">` |
| 2. Call Connected | `<section id="screen-connected">` |
| 3. Caller Speech → Text | `<section id="screen-listen">` |
| 4. Sign Language Camera | `<section id="screen-camera">` |
| 5. Sign → Text | `<section id="screen-review">` |
| 6. Text → Speech | `<section id="screen-speak">` |
| 7. Call Summary | `<section id="screen-summary">` |

**Step A: colours, fonts, corners (30 minutes, biggest effect)**
1. In Figma, click a button → right panel → **Inspect / Dev Mode** → copy the hex colour (e.g. `#1A73E8`).
2. Paste it into the matching variable at the top of `static/css/styles.css` (`--color-primary`, `--color-dark`, `--radius-button`…).
3. Font: if you use e.g. *Inter* or *Poppins* from Google Fonts, add this line inside `<head>` in **both** `index.html` and `caller.html`:
   `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap">`
   and set `--font: "Poppins", system-ui, sans-serif;`. (Fonts need internet; the system font is used offline.)

**Step B: logo and icons**
1. In Figma, select the logo layer → right panel bottom → **Export** → `+` → format **SVG** → *Export*.
2. Save it as `static/assets/logo.svg` (replace the placeholder). For other icons: export as SVG into `static/assets/` and use `<img src="/static/assets/NAME.svg" alt="" width="24">`.
3. Photos or illustrations: export as **PNG 2x**.

**Step C: texts and layout**
- Change texts directly in `index.html` (e.g. headings, button labels).
- To move things, change the order of elements inside a `<section>`.
- **Don't** delete or rename elements that have an `id="..."`. JavaScript uses them. Change only the text or the CSS.

**Avoid** “Figma to code” plugins: they produce hundreds of absolutely positioned boxes that break on other screen sizes and are hard to connect to the logic.

---

## 8. Live AI mode and Demo mode

| | LIVE AI mode | DEMO mode |
|---|---|---|
| Caller lines | Real speech-to-text (or typed, labeled TYPED) | **Pre-written** lines from `config.js`, labeled **DEMO · pre-written** |
| Sara's replies | Real sign recognition (or typed) | Real sign recognition **still works**; the optional “Use scripted reply” is labeled **DEMO** |
| Badge | green **LIVE AI** | orange **DEMO MODE** |
| Latency metrics | measured | demo/typed messages are **excluded** |

**How the honesty is enforced in code (not only in the UI):**
- every message carries a `source`: `live_stt`, `live_sign`, `typed`, or `demo_script`
- the backend **rejects** pre-written lines in a LIVE call (`app.py`, `api_post_message`)
- the summary counts each source separately, and the latency averages use only `live_*` messages
- the demo script lives in its own clearly named block (`DEMO_SCRIPT` in `config.js`)

**When to switch to Demo mode during the presentation:** if the Wi-Fi fails and captions stop (error “Speech recognition needs internet…”). Say it out loud: *“The venue Wi-Fi is down, so I'm switching to demo mode for the caller's lines. Sign recognition runs locally and is still live.”* Judges respect that much more than a fake.

**Offline fallback:** if the internet is completely down, run the server on the presenting laptop (`python app.py`, open `http://localhost:8000`). The hand model is bundled, so sign recognition and text-to-speech still work. Only speech-to-text needs the internet.

---

## 9. Measuring impact

Only report numbers you measured. The app measures these for you:

| Metric | Where it comes from | How to report it |
|---|---|---|
| **Sign recognition accuracy** | Test screen | “X% over N trials, Y testers, Z of them not in the training data” |
| **Signs supported** | `config.js` | “6 static ASL handshapes, combinable into short replies” |
| **Caller speech → Sara's screen** | Summary (server-timed, clock-corrected) | average over 5 live calls |
| **Speech-to-text finalize time** (approx.) | Summary | average over 5 live calls |
| **Sign hold time** | Summary (≈0.7 s by design) | “a sign is accepted after it's held for ~0.7 s” |
| **Sara sends → caller hears** | Summary | average over 5 live calls |
| **Hand-model speed** | HUD on the camera / Test screen | “X ms per frame, Y fps on a [laptop model], CPU only” |
| **Replies given independently** | Summary: “Replies by live sign: a/b” | count over 5 full scenario runs |
| **Flow completion rate** | Your own log | run the full hospital scenario 5 times and count runs that finished without help |

**Measuring speech-to-text accuracy (Word Error Rate) by hand:**
1. Read the 5 caller lines of the demo script aloud in LIVE mode.
2. For each line, count wrongly recognized + missing + extra words.
3. WER = errors ÷ total words in the script. Example: 6 errors / 90 words = **6.7% WER**. Do it in English and Arabic if you support both.

**Template table for your slides:**

| Metric | Result | Conditions |
|---|---|---|
| Sign accuracy | __% (__/__) | __ testers, lighting: __ |
| Caller → screen latency | __ s | avg of __ calls, venue Wi-Fi |
| Sign reply → caller hears | __ s | avg of __ calls |
| Hand model | __ ms/frame, __ fps | [laptop], CPU only |
| Scenario completed independently | __/5 runs | hospital script |

**Impact story (problem understanding):** many Deaf people's first language is a **sign language**, and written Arabic or English is a second language for them. Typing during a fast phone call is slow and stressful, and the alternative is usually asking a family member or interpreter, which costs privacy and independence (for example, medical details). SignConnect lets them **read** the caller and **reply in sign**. For population figures, cite official sources (e.g. the WHO hearing-loss fact sheet, or GASTAT's disability survey for Saudi Arabia) and quote them exactly. Don't estimate.

---

## 10. Implemented / Simulated / Future

**IMPLEMENTED (works in the prototype)**
- Cloud web app (Flask on Render) with two roles: Deaf user and hearing caller
- Real-time speech-to-text of the caller (Web Speech API, English and Arabic)
- Webcam sign recognition of 6 static ASL handshapes (pre-trained MediaPipe hand model + kNN classifier trained on our samples), running in the browser on the CPU
- Text-to-speech of Sara's reply (browser voices), played on the caller's device or the same laptop
- Call states (ringing, connected, ended), message relay between two devices, call summary with transcript
- Source labels on every message, latency measurements, built-in accuracy testing
- Demo mode with clearly labeled pre-written lines, and typed fallback

**SIMULATED**
- The **phone call itself**: there's no cellular or VoIP connection. The incoming call is started by a button or by the caller page in a browser.
- The **hospital caller** is a teammate using the caller page
- In DEMO mode: the caller's lines (pre-written) and optionally Sara's reply (pre-written), always labeled

**FUTURE (not built)**
- Real phone network integration (telecom/VoIP provider, mobile OS integration)
- Saudi Sign Language support (needs a dataset, Deaf signers, validation)
- Dynamic signs (movement), two-handed signs, facial expressions, sentence-level recognition
- Production speech-to-text with privacy agreements, user accounts, data protection, and accessibility certification

---

## 11. 3-day plan

Suggested roles: **A**: app and AI (sign training, testing); **B**: design (Figma → CSS); **C**: pitch, metrics, and demo script; **D** (if you have one): cloud deployment and second device.

**Day 1: get it running**
- Morning: everyone runs it locally (6.1–6.3). A deploys to Render (6.7) **on day 1**, not day 3.
- Afternoon: A trains the 6 signs (6.4) and runs a first Test (6.5). B starts on colours, fonts, and logo (section 7). C writes the problem statement and the honesty slide (section 10).
- End of day: one full DEMO-mode call and one LIVE call on one laptop.

**Day 2: make it solid**
- A: record more samples with a second person, re-test, and commit `sign_model.json`. Optionally adapt the vocabulary in `config.js`.
- B: finish the visual match with Figma for screens 1–7.
- C/D: two-device call (6.8). Collect metrics over 5 live calls and fill the table in section 9.
- End of day: full rehearsal with timing (aim for a 2–3 minute live demo).

**Day 3: rehearse and protect the demo**
- Morning: freeze the code (no new features). Rehearse 3 times, including one rehearsal **in Demo mode**.
- Record a **backup video** of a successful live call (Windows: Xbox Game Bar `Win+G`; Mac: `Cmd+Shift+5`).
- Final checklist (section 13).

---

## 12. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `python` / `py` not recognized | Python is not on PATH | Reinstall Python 3.12.10 and tick *Add python.exe to PATH*; restart VS Code |
| `Activate.ps1 cannot be loaded` | Windows script policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `ModuleNotFoundError: No module named 'flask'` | Virtual environment not active | Activate `.venv` (6.1), then `python -m pip install -r requirements.txt` |
| `Address already in use` | Port busy | Use `PORT=8001` (see 6.3) |
| Camera says “permission blocked” | Chrome blocked it | Click the camera icon in the address bar → *Allow* → reload |
| Camera “used by another app” | Zoom/Teams/Camera app is open | Close those apps |
| Microphone: “Speech recognition needs internet” | Wi-Fi down, or the network blocks Google | Switch to a phone hotspot, or to DEMO mode |
| No speech recognition at all | Not Chrome/Edge, or Firefox/Safari | Use Google Chrome |
| Camera/mic don't work on a phone | Page opened via `http://` (not https) | Use the Render `https://` address |
| No sound when replying | Volume, wrong output device, or no voice for the language | Check volume and output; try English; on iPhone tap a button first |
| Captions of the computer's own voice | Using an external speaker next to the mic | Keep the speaker away from the mic, or use two devices |
| Sign never recognized | No samples, bad light, or hand partly outside the frame | Check the HUD: “no hand” = lighting/framing; “unknown” = record more samples |
| Wrong sign recognized | Similar handshapes | Record more samples of both signs; exaggerate the difference |
| HUD shows fewer than 10 fps | Slow laptop or battery saver | Plug in the charger, close other tabs; or try the graphics chip by adding `?gpu=1` to the address |
| Two devices don't see each other | Different room names, or not the same server | Same address (Render) and same room on both devices |
| Render: `gunicorn: command not found` | Build failed | Check that the build log ran `pip install -r requirements.txt` without errors |
| Render: site takes ~1 minute to load | Free server was asleep | Open it 5 minutes before the demo |
| Calls “disappear” | Server restarted (free plan, redeploy) | Normal; start a new call |
| You changed a file but nothing changes | Browser cache | `Ctrl+Shift+R` (Mac `Cmd+Shift+R`) |
| After editing, the page is broken | A typo in JS/HTML | F12 → Console → the red error shows the file and line |

---

## 13. Final demo checklist

**The night before**
- [ ] Latest code pushed; Render shows *Live*; the Render URL works on both devices
- [ ] `sign_model.json` committed; the Test screen shows ≥ 80% on the presenting laptop (if it doesn't, record more samples)
- [ ] Metrics table filled in with real numbers
- [ ] Backup video recorded

**30 minutes before**
- [ ] Laptops charged and plugged in; battery saver off; notifications off (Focus / Do Not Disturb)
- [ ] Chrome only; close Zoom, Teams, and the Camera app
- [ ] Open the Render URL (wakes the server) on both devices; room `sara` on both
- [ ] Allow camera and microphone; run one quick test call; check volume
- [ ] Light in front of the signer; plain background
- [ ] Phone hotspot ready; know how to switch to DEMO mode

**During the demo (2–3 minutes)**
1. Problem in one sentence: *“Sara is Deaf. The hospital calls to confirm her appointment. Today she needs another person to make that call for her.”*
2. Incoming call → Answer (point out the **SIMULATED CALL** label honestly).
3. The caller speaks → captions appear live.
4. Sara signs YES / FINE / PHONE → the caller's device speaks.
5. End → Summary: show the **LIVE** labels and measured latency.
6. Close with the honesty slide (Implemented / Simulated / Future) and the roadmap.

---

## 14. Roadmap

| Phase | What | How (technically credible) |
|---|---|---|
| 1 | Bigger vocabulary, dynamic signs | Move from single-frame handshapes to **landmark sequences** (hands + pose + face) and a small sequence model (1D-CNN/Transformer), starting from the public 250-sign ASL ISLR dataset and models |
| 2 | Saudi Sign Language | Partner with Deaf associations and SSL interpreters; record and annotate an SSL dataset with consent; train and validate per sign; publish the measured accuracy |
| 3 | Testing with Deaf users | Usability sessions with Deaf users and accessibility experts; measure task completion, time, and satisfaction; iterate on the UI (captions, contrast, vibration) |
| 4 | Real-time & accuracy | Continuous signing (no button), confidence-based confirmation, production STT with Arabic dialect support and privacy agreements, on-device models |
| 5 | Real telecom integration | VoIP/telephony provider (e.g. SIP or programmable voice APIs) to bridge real calls; then mobile apps; follow platform rules for call audio |
| 6 | Sector rollout | Pilot with one hospital appointment centre, then banks, universities, government services; integrate with existing contact-centre software |

---

## 15. How the code works

**One call, step by step:**
1. **Ring:** the caller page (or the simulate button) sends `POST /api/rooms/sara/ring`. The server sets the status to `ringing`.
2. Sara's page polls `GET /api/rooms/sara?since=0` every 0.7 s, sees `ringing`, and shows screen 1.
3. **Answer:** `POST /api/rooms/sara/answer` → `connected`. Both pages show the call screens.
4. **Caller speaks:** `speech.js` (Web Speech API) produces text → `POST /api/rooms/sara/messages` with `source: "live_stt"`.
5. Sara's next poll receives it, shows it, and sends `POST .../messages/1/ack {"event": "displayed"}` (used for the latency number).
6. **Sara signs:** `signs.js` gets 21 hand points per frame from MediaPipe, turns them into 63 numbers, the kNN classifier votes, and the stabilizer waits 0.7 s → sign `YES` → phrase “Yes.” (`config.js`).
7. **Send:** `POST .../messages` with `source: "live_sign"` and the signs used.
8. **Speak:** the caller page receives it and plays it with `speechSynthesis`. When audio starts it sends `ack {"event": "spoken"}`.
9. **End:** `POST /api/rooms/sara/end` → the server builds the summary (`build_summary` in `app.py`).

**API reference**

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Is the server alive? |
| `GET /api/rooms/<room>?since=<n>&role=user\|caller` | Call status + messages newer than `n` |
| `POST /api/rooms/<room>/ring` | `{"mode": "live"\|"demo", "origin": "caller_page"\|"simulated_button"}` |
| `POST /api/rooms/<room>/answer` · `/decline` · `/end` | Call control |
| `POST /api/rooms/<room>/messages` | `{"sender": "caller"\|"user", "source": "live_stt"\|"live_sign"\|"typed"\|"demo_script", "text": "...", "meta": {...}, "origin_at": ms}` |
| `POST /api/rooms/<room>/messages/<seq>/ack` | `{"event": "displayed"\|"spoken"}` |
| `GET /api/rooms/<room>/summary` | Call summary |
| `GET/POST /api/evaluations` | Accuracy test results |

**Changing the vocabulary:** edit `SIGNS` in `static/js/config.js` (add `{ id, handshape, asl, phrase: {en, ar} }`), reload, record samples for the new sign on the Train screen, test, then export and commit the model.

**Changing the demo script:** edit `DEMO_SCRIPT` in the same file.
