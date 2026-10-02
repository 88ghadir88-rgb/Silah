# SignConnect

**An accessibility layer for phone calls for Deaf users. Hackathon prototype.**

A hearing caller speaks and the Deaf user reads live captions. The Deaf user replies in sign language in front of a webcam, and the caller hears the reply as speech.

```
Caller speaks ─► Speech-to-Text ─► text on Sara's screen
Sara signs    ─► Webcam ─► hand model + sign classifier ─► text ─► Text-to-Speech ─► caller hears it
```

Demo scenario: a hospital calls Sara to confirm her appointment.

> **Honesty note.** The phone call is **simulated** in the browser (no cellular network).
> Sign recognition covers **6 static ASL handshapes**, using Google's pre-trained MediaPipe hand model
> plus a lightweight classifier calibrated on samples recorded by our team. It is not full sign-language
> translation and does **not** support Saudi Sign Language yet.

## Quick start

```bash
# Windows (PowerShell)
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py

# macOS
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open **http://localhost:8000** in Google Chrome (Sara's app). The caller page is **http://localhost:8000/caller**.

Run the tests with `python -m unittest -v`.

## Stack

| Part | Technology | Runs where |
|---|---|---|
| Frontend | HTML / CSS / JavaScript | Browser |
| Backend | Python 3.12 + Flask | Render (cloud) |
| Speech-to-Text | Web Speech API (Chrome) | Browser + Google speech service |
| Sign recognition | MediaPipe Hand Landmarker (pre-trained) + kNN | Browser, CPU only |
| Text-to-Speech | speechSynthesis | Browser |
| Frontend ↔ backend | REST + JSON, polling every 0.7 s | HTTPS |

No API keys, no database, no GPU, no cost.

## Full guide

**[docs/MENTOR_GUIDE.md](docs/MENTOR_GUIDE.md)** covers setup, the Day 0 checklist, training and testing signs, deploying to Render, matching your Figma design, Demo mode, metrics, troubleshooting, and the final demo checklist.

## Third-party

`static/vendor/mediapipe/` contains Google's MediaPipe Tasks Vision runtime (v1.0.1) and the Hand Landmarker model, both under the Apache License 2.0.
