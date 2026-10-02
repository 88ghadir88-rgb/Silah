# SignConnect

**An accessibility layer for phone calls for Deaf users. Hackathon prototype.**

The hearing caller speaks and the Deaf user reads the text. The Deaf user signs in front of the camera, and a pre-trained ASL model recognizes the sign. The caller hears the reply as speech. The caller needs no app.

```
Caller speaks ─► Speech-to-Text ─► text on Layla's screen
Layla signs   ─► webcam ─► MediaPipe Holistic ─► pre-trained ASL model (cloud) ─► text ─► Text-to-Speech ─► caller hears it
```

**Two UI layers:**
1. The **SignConnect app**: activation, plus settings and permissions. It is installed and activated once.
2. The **call experience**: our Figma call screens. It opens automatically when a call arrives.

> **Honesty note.** The incoming-call trigger and the phone call are **simulated** in the browser. A production version needs native iOS telephony integration.
> Sign recognition uses a **pre-trained English/ASL model** (10 of its 250 signs). It does **not** support Saudi Sign Language yet; that would require adaptation, testing and validation.

## Quick start

```bash
# Windows (PowerShell)
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py

# macOS (Apple Silicon)
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Then open these pages in Google Chrome:

| Page | Address |
|---|---|
| Both phones side by side (one-laptop demo) | **http://localhost:8000/stage** |
| Layla's phone (Deaf user) | http://localhost:8000/ |
| Caller's phone | http://localhost:8000/caller |
| Model test / accuracy (team tool) | http://localhost:8000/lab |

Run the tests with `python -m unittest -v`.

## Stack

| Part | Technology | Runs where |
|---|---|---|
| Frontend | HTML / CSS / JavaScript | Browser |
| Backend | Python 3.12 + Flask | Render (cloud) |
| Sign recognition | MediaPipe Holistic (landmarks) → pre-trained ASL TFLite model via `ai-edge-litert` | Browser + backend, CPU only |
| Speech-to-Text | Web Speech API (Chrome) | Caller's browser |
| Text-to-Speech | speechSynthesis | Caller's browser |

No API keys, no database, no GPU.

## Full guide

**[docs/MENTOR_GUIDE.md](docs/MENTOR_GUIDE.md)** covers setup, the Day 0 checklist, the supported signs, the Figma mapping, Demo mode, metrics, troubleshooting and the demo checklist.

## Third-party components

- `static/vendor/mediapipe/`: Google MediaPipe Tasks Vision 1.0.1 and the Holistic Landmarker model (Apache-2.0).
- `models/asl_islr/`: the pre-trained ASL isolated-sign model by pradhyumn (GPL-3.0), trained on the Google Isolated Sign Language Recognition data. See `models/asl_islr/README.md`.
