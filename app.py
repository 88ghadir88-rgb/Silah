"""
SignConnect - cloud backend (Flask)

What this file does:
  1. Serves the web pages:
       /        Layla's phone (the Deaf user): SignConnect app screens + the call experience
       /caller  the hearing caller's phone (Bank Alinma)
       /stage   both phones side by side on ONE laptop (for the demo)
       /lab     developer page: test the sign model and measure its accuracy
  2. Runs the pre-trained ASL sign-language model (recognizer.py) at POST /api/recognize.
  3. Keeps the state of each "call room" in memory (ringing / connected / ended + all messages).
  4. Relays messages between the two phones (the browsers ask for news every ~0.7 s = "polling").
  5. Records timing data and builds the Call Summary (with honest LIVE / DEMO / TYPED labels).
  6. Stores accuracy-test results.

This server never receives audio or video. For sign recognition it receives only the
coordinates of the lips, hands and arms (numbers) extracted in the browser.

Run locally:   python app.py          -> open http://localhost:8000
Run on Render: gunicorn app:app --workers 1 --threads 8   (see render.yaml)

IMPORTANT: keep --workers 1. All call data lives in this one process's memory.
"""

import mimetypes
import os
import threading
import time

from flask import Flask, jsonify, request, send_from_directory

from recognizer import recognizer

# Windows sometimes has wrong file types in its registry (e.g. ".js" = "text/plain"),
# which makes Chrome refuse to run our JavaScript. Force the correct types.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")

# ---------------------------------------------------------------------------
# Allowed values (anything else is rejected, so the summary labels stay honest)
# ---------------------------------------------------------------------------
SENDERS = {"caller", "user"}
SOURCES = {
    "live_stt",     # real speech-to-text from a microphone
    "live_sign",    # real sign recognition from the webcam
    "typed",        # someone typed the message by hand (manual fallback)
    "demo_script",  # pre-written demo line (DEMO MODE, not produced by AI)
}
MODES = {"live", "demo"}
MAX_TEXT = 500
MAX_MESSAGES = 200
MAX_ROOMS = 50
MAX_EVALUATIONS = 20
MAX_RECOGNIZE_BYTES = 2 * 1024 * 1024

_lock = threading.Lock()
_rooms = {}        # room_id -> room dict
_evaluations = []  # newest last


def now_ms():
    """Server time in milliseconds. Every timestamp the server stores uses this clock."""
    return int(time.time() * 1000)


def new_room(room_id):
    return {
        "room_id": room_id,
        "call_id": 0,
        "status": "idle",          # idle -> ringing -> connected -> ended
        "mode": "live",
        "caller_name": "",
        "caller_number": "",
        "ring_origin": "",         # "caller_page" or "simulated_button"
        "created_at": now_ms(),
        "ringing_at": None,
        "connected_at": None,
        "ended_at": None,
        "next_seq": 1,
        "messages": [],
        "presence": {},            # role -> last heartbeat (server ms)
    }


def get_room(room_id):
    """Return the room, creating it if needed. Caller must hold _lock."""
    room_id = (room_id or "layla").strip().lower()[:32] or "layla"
    if room_id not in _rooms:
        if len(_rooms) >= MAX_ROOMS:
            oldest = min(_rooms.values(), key=lambda r: r["created_at"])
            del _rooms[oldest["room_id"]]
        _rooms[room_id] = new_room(room_id)
    return _rooms[room_id]


def public_room(room):
    """The part of the room that is sent to browsers (without the message list)."""
    t = now_ms()
    return {
        "room_id": room["room_id"],
        "call_id": room["call_id"],
        "status": room["status"],
        "mode": room["mode"],
        "caller_name": room["caller_name"],
        "caller_number": room["caller_number"],
        "ring_origin": room["ring_origin"],
        "ringing_at": room["ringing_at"],
        "connected_at": room["connected_at"],
        "ended_at": room["ended_at"],
        # A role counts as "online" if it sent a heartbeat in the last 6 seconds.
        "online": {role: (t - seen) < 6000 for role, seen in room["presence"].items()},
    }


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def bad_request(message):
    return jsonify({"ok": False, "error": message}), 400


def as_number(value):
    """Return value if it is a real number (not bool), else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.route("/")
def page_user():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/caller")
def page_caller():
    return send_from_directory(STATIC_DIR, "caller.html")


@app.route("/stage")
def page_stage():
    return send_from_directory(STATIC_DIR, "stage.html")


@app.route("/lab")
def page_lab():
    return send_from_directory(STATIC_DIR, "lab.html")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "service": "signconnect", "server_time": now_ms(),
                    "sign_model_ready": recognizer.ready})


@app.route("/api/model")
def api_model():
    return jsonify({"ok": True, **recognizer.info()})


@app.route("/api/recognize", methods=["POST"])
def api_recognize():
    """Sign recognition. Body: {"frames": [{"lips": [...], "left": [...], "right": [...], "pose": [...]}]}"""
    if (request.content_length or 0) > MAX_RECOGNIZE_BYTES:
        return bad_request("too much data")
    frames = body().get("frames")
    if not isinstance(frames, list) or not frames:
        return bad_request("frames must be a non-empty list")
    if not recognizer.ready:
        return jsonify({"ok": False, "error": "sign model not loaded: %s" % recognizer.error}), 503
    try:
        result = recognizer.recognize(frames)
    except (ValueError, TypeError) as exc:
        return bad_request("invalid landmark data: %s" % exc)
    return jsonify({"ok": True, "server_time": now_ms(), **result})


@app.route("/api/rooms/<room_id>")
def api_room_state(room_id):
    """Polling endpoint. ?since=<seq> returns only messages newer than that number."""
    try:
        since = int(request.args.get("since", "0"))
    except ValueError:
        since = 0
    role = request.args.get("role", "")
    with _lock:
        room = get_room(room_id)
        if role in ("user", "caller"):
            room["presence"][role] = now_ms()
        messages = [m for m in room["messages"] if m["seq"] > since]
        return jsonify({
            "ok": True,
            "server_time": now_ms(),
            "room": public_room(room),
            "messages": messages,
        })


@app.route("/api/rooms/<room_id>/ring", methods=["POST"])
def api_ring(room_id):
    """Start a NEW call (clears the previous call's messages)."""
    data = body()
    mode = data.get("mode", "live")
    if mode not in MODES:
        return bad_request("mode must be 'live' or 'demo'")
    origin = data.get("origin", "simulated_button")
    if origin not in ("caller_page", "simulated_button"):
        return bad_request("origin must be 'caller_page' or 'simulated_button'")
    with _lock:
        room = get_room(room_id)
        presence = room["presence"]
        fresh = new_room(room["room_id"])
        fresh["call_id"] = room["call_id"] + 1
        fresh["presence"] = presence
        fresh["status"] = "ringing"
        fresh["mode"] = mode
        fresh["caller_name"] = str(data.get("caller_name", "Bank Alinma"))[:80]
        fresh["caller_number"] = str(data.get("caller_number", "+966 11 000 0000"))[:40]
        fresh["ring_origin"] = origin
        fresh["ringing_at"] = now_ms()
        _rooms[fresh["room_id"]] = fresh
        return jsonify({"ok": True, "room": public_room(fresh)})


@app.route("/api/rooms/<room_id>/answer", methods=["POST"])
def api_answer(room_id):
    # The Deaf user's phone decides the AI mode (it is a setting in her SignConnect app).
    mode = body().get("mode")
    if mode is not None and mode not in MODES:
        return bad_request("mode must be 'live' or 'demo'")
    with _lock:
        room = get_room(room_id)
        if room["status"] != "ringing":
            return bad_request("there is no ringing call to answer")
        if mode:
            room["mode"] = mode
        room["status"] = "connected"
        room["connected_at"] = now_ms()
        return jsonify({"ok": True, "room": public_room(room)})


@app.route("/api/rooms/<room_id>/decline", methods=["POST"])
def api_decline(room_id):
    with _lock:
        room = get_room(room_id)
        if room["status"] == "ringing":
            room["status"] = "ended"
            room["ended_at"] = now_ms()
        return jsonify({"ok": True, "room": public_room(room)})


@app.route("/api/rooms/<room_id>/end", methods=["POST"])
def api_end(room_id):
    with _lock:
        room = get_room(room_id)
        if room["status"] in ("ringing", "connected"):
            room["status"] = "ended"
            room["ended_at"] = now_ms()
        return jsonify({"ok": True, "room": public_room(room), "summary": build_summary(room)})


@app.route("/api/rooms/<room_id>/messages", methods=["POST"])
def api_post_message(room_id):
    data = body()
    sender = data.get("sender")
    source = data.get("source")
    text = str(data.get("text", "")).strip()
    if sender not in SENDERS:
        return bad_request("sender must be 'caller' or 'user'")
    if source not in SOURCES:
        return bad_request("source must be one of: " + ", ".join(sorted(SOURCES)))
    if not text:
        return bad_request("text is empty")
    if len(text) > MAX_TEXT:
        return bad_request("text is longer than %d characters" % MAX_TEXT)

    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    # Keep only small, known metadata fields (numbers / short strings / short lists).
    clean_meta = {}
    for key in ("stt_finalize_ms", "sign_capture_ms", "recognize_ms", "model_inference_ms",
                "avg_landmark_ms", "fps", "confidence"):
        number = as_number(meta.get(key))
        if number is not None:
            clean_meta[key] = number
    for key in ("lang", "engine"):
        if isinstance(meta.get(key), str):
            clean_meta[key] = meta[key][:40]
    if isinstance(meta.get("signs"), list):
        clean_meta["signs"] = [str(s)[:30] for s in meta["signs"][:10]]

    with _lock:
        room = get_room(room_id)
        if room["status"] != "connected":
            return bad_request("the call is not connected")
        # LIVE calls never accept pre-written lines. DEMO calls accept everything, but every
        # message keeps its own source label, so a live sign during a demo call is still
        # shown as LIVE and a scripted line is always shown as DEMO.
        if room["mode"] == "live" and source == "demo_script":
            return bad_request("this call is in LIVE mode; demo lines are not accepted")
        if len(room["messages"]) >= MAX_MESSAGES:
            return bad_request("message limit reached for this call")

        server_time = now_ms()
        origin_at = as_number(data.get("origin_at"))
        # origin_at = when the text was finalized on the sending device (converted to server clock).
        # Accept it only if it is plausible (not in the future, not older than 60 s).
        if origin_at is None or origin_at > server_time + 1000 or origin_at < server_time - 60000:
            origin_at = server_time

        message = {
            "seq": room["next_seq"],
            "sender": sender,
            "source": source,
            "text": text,
            "meta": clean_meta,
            "origin_at": int(origin_at),
            "received_at": server_time,
            "displayed_at": None,   # set when the other side shows it on screen
            "spoken_at": None,      # set when text-to-speech starts playing it
        }
        room["next_seq"] += 1
        room["messages"].append(message)
        return jsonify({"ok": True, "message": message, "server_time": server_time})


@app.route("/api/rooms/<room_id>/messages/<int:seq>/ack", methods=["POST"])
def api_ack(room_id, seq):
    """A browser reports that it displayed (or started speaking) message <seq>."""
    data = body()
    event = data.get("event")
    if event not in ("displayed", "spoken"):
        return bad_request("event must be 'displayed' or 'spoken'")
    with _lock:
        room = get_room(room_id)
        server_time = now_ms()
        at = as_number(data.get("at"))
        if at is None or at > server_time + 1000 or at < server_time - 60000:
            at = server_time
        for message in room["messages"]:
            if message["seq"] == seq:
                field = event + "_at"
                if message[field] is None:
                    message[field] = int(at)
                return jsonify({"ok": True})
        return jsonify({"ok": False, "error": "message not found"}), 404


@app.route("/api/rooms/<room_id>/summary")
def api_summary(room_id):
    with _lock:
        room = get_room(room_id)
        return jsonify({"ok": True, "summary": build_summary(room)})


@app.route("/api/evaluations", methods=["GET", "POST"])
def api_evaluations():
    """Sign-recognition accuracy tests run on the Evaluation screen."""
    if request.method == "GET":
        with _lock:
            return jsonify({"ok": True, "evaluations": list(reversed(_evaluations))})
    data = body()
    trials = data.get("trials")
    if not isinstance(trials, list) or not trials:
        return bad_request("trials must be a non-empty list")
    clean = []
    for trial in trials[:500]:
        if not isinstance(trial, dict):
            continue
        clean.append({
            "expected": str(trial.get("expected", ""))[:30],
            "predicted": str(trial.get("predicted", "") or "")[:30],
            "time_ms": as_number(trial.get("time_ms")),
        })
    correct = sum(1 for t in clean if t["expected"] and t["expected"] == t["predicted"])
    record = {
        "created_at": now_ms(),
        "tester": str(data.get("tester", ""))[:60],
        "notes": str(data.get("notes", ""))[:200],
        "trials": clean,
        "total": len(clean),
        "correct": correct,
        "accuracy": round(correct / len(clean), 4) if clean else None,
        "avg_inference_ms": as_number(data.get("avg_inference_ms")),
        "fps": as_number(data.get("fps")),
    }
    with _lock:
        _evaluations.append(record)
        del _evaluations[:-MAX_EVALUATIONS]
    return jsonify({"ok": True, "evaluation": record})


# ---------------------------------------------------------------------------
# Call summary
# ---------------------------------------------------------------------------
def average(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values)) if values else None


def build_summary(room):
    messages = room["messages"]
    caller_msgs = [m for m in messages if m["sender"] == "caller"]
    user_msgs = [m for m in messages if m["sender"] == "user"]

    def count_sources(msgs):
        counts = {source: 0 for source in sorted(SOURCES)}
        for m in msgs:
            counts[m["source"]] += 1
        return counts

    duration_s = None
    if room["connected_at"]:
        end = room["ended_at"] or now_ms()
        duration_s = round((end - room["connected_at"]) / 1000)

    # Latencies are only computed from LIVE messages, so demo lines never inflate the results.
    live_caller = [m for m in caller_msgs if m["source"] == "live_stt"]
    live_user = [m for m in user_msgs if m["source"] == "live_sign"]

    signs = []
    for m in live_user:
        signs.extend(m["meta"].get("signs", []))

    latency = {
        "caller_speech_to_screen_ms": average(
            [m["displayed_at"] - m["origin_at"] for m in live_caller if m["displayed_at"]]),
        "stt_finalize_ms": average([m["meta"].get("stt_finalize_ms") for m in live_caller]),
        # time from "hands down" (end of signing) until the model's answer was back in the browser
        "sign_recognition_ms": average([m["meta"].get("recognize_ms") for m in live_user]),
        "sign_model_inference_ms": average([m["meta"].get("model_inference_ms") for m in live_user]),
        "landmarks_per_frame_ms": average([m["meta"].get("avg_landmark_ms") for m in live_user]),
        "user_send_to_caller_audio_ms": average(
            [m["spoken_at"] - m["origin_at"] for m in live_user if m["spoken_at"]]),
    }

    replies_total = len(user_msgs)
    replies_by_sign = len(live_user)
    completed = (room["status"] == "ended" and len(caller_msgs) > 0 and replies_total > 0)

    return {
        "room_id": room["room_id"],
        "call_id": room["call_id"],
        "status": room["status"],
        "mode": room["mode"],
        "caller_name": room["caller_name"],
        "ring_origin": room["ring_origin"],
        "duration_s": duration_s,
        "turns": len(messages),
        "caller_messages": count_sources(caller_msgs),
        "user_messages": count_sources(user_msgs),
        "signs_recognized": signs,
        "replies_total": replies_total,
        "replies_by_live_sign": replies_by_sign,
        "completed": completed,
        "completed_with_signs_only": completed and replies_by_sign == replies_total,
        "latency": latency,
        "transcript": [
            {"seq": m["seq"], "sender": m["sender"], "source": m["source"], "text": m["text"],
             "signs": m["meta"].get("signs", []), "origin_at": m["origin_at"]}
            for m in messages
        ],
        "latest_evaluation": (
            {k: _evaluations[-1][k] for k in ("created_at", "accuracy", "total", "correct", "tester")}
            if _evaluations else None
        ),
    }


@app.after_request
def no_cache_for_api(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))  # not 5000: macOS uses 5000 for AirPlay
    print("\n  SignConnect is running.")
    print("  Both phones (one laptop): http://localhost:%d/stage" % port)
    print("  Layla (Deaf user) phone:  http://localhost:%d/" % port)
    print("  Caller phone:             http://localhost:%d/caller" % port)
    print("  Model lab (team tool):    http://localhost:%d/lab" % port)
    print("  ASL sign model loaded:    %s\n" % (recognizer.ready if recognizer.ready else "NO - " + str(recognizer.error)))
    # threaded=True lets several browser tabs poll at the same time.
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
