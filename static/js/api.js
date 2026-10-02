// SignConnect - talking to the cloud backend.
// The browser uses plain HTTP requests (REST + JSON):
//   - POST to send something (ring, answer, a message, an acknowledgement)
//   - GET every 700 ms to ask "anything new?" (this is called polling)
// Polling is simpler and more reliable than WebSockets for a 3-day prototype.

export class Api {
  constructor(room, role) {
    this.room = encodeURIComponent(room || "layla");
    this.role = role;               // "user" (Layla, the Deaf user) or "caller"
    this.offset = 0;                // serverClock - localClock, in ms
    this.bestRtt = Infinity;
    this.lastSeq = 0;
    this.pollTimer = null;
    this.online = true;
  }

  // Current time on the SERVER's clock. Used for latency measurements, so that two
  // different devices (with slightly different clocks) can be compared fairly.
  serverNow() {
    return Date.now() + this.offset;
  }

  async request(method, path, payload) {
    const t0 = Date.now();
    const response = await fetch(path, {
      method,
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    const t1 = Date.now();
    let data = {};
    try { data = await response.json(); } catch (e) { /* not JSON */ }
    if (typeof data.server_time === "number") this.updateClock(t0, t1, data.server_time);
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `Server error ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // Simple clock sync: trust the measurement with the shortest round trip.
  updateClock(t0, t1, serverTime) {
    const rtt = t1 - t0;
    if (rtt <= this.bestRtt * 1.5 || rtt < 150) {
      this.offset = serverTime - (t0 + t1) / 2;
      this.bestRtt = Math.min(this.bestRtt, rtt);
    }
  }

  roomPath(suffix = "") {
    return `/api/rooms/${this.room}${suffix}`;
  }

  health() { return this.request("GET", "/api/health"); }
  state(since = 0) { return this.request("GET", this.roomPath(`?since=${since}&role=${this.role}`)); }
  ring(options) { return this.request("POST", this.roomPath("/ring"), options); }
  decline() { return this.request("POST", this.roomPath("/decline"), {}); }
  end() { return this.request("POST", this.roomPath("/end"), {}); }
  summary() { return this.request("GET", this.roomPath("/summary")); }

  sendMessage({ sender, source, text, meta = {}, originAt }) {
    return this.request("POST", this.roomPath("/messages"), {
      sender, source, text, meta,
      origin_at: Math.round(originAt ?? this.serverNow()),
    });
  }

  ack(seq, event) {
    return this.request("POST", this.roomPath(`/messages/${seq}/ack`), {
      event, at: Math.round(this.serverNow()),
    }).catch(() => {}); // an acknowledgement is only for metrics; never break the call for it
  }

  saveEvaluation(evaluation) { return this.request("POST", "/api/evaluations", evaluation); }
  model() { return this.request("GET", "/api/model"); }
  // Sends one signed sequence (landmark numbers only) to the ASL model on the backend.
  recognize(frames) { return this.request("POST", "/api/recognize", { frames }); }
  answer(mode) { return this.request("POST", this.roomPath("/answer"), mode ? { mode } : {}); }

  // Calls onUpdate({room, messages}) every intervalMs. Calls onConnection(true/false)
  // when the connection to the server is lost or comes back.
  startPolling(onUpdate, onConnection, intervalMs = 700) {
    this.stopPolling();
    let currentCall = null;
    const tick = async () => {
      try {
        const data = await this.state(this.lastSeq);
        if (!this.online) { this.online = true; onConnection?.(true); }
        // A new call started: forget the old message numbers.
        if (currentCall !== null && data.room.call_id !== currentCall) {
          this.lastSeq = 0;
          currentCall = data.room.call_id;
          const fresh = await this.state(0);
          this.handle(fresh, onUpdate);
        } else {
          currentCall = data.room.call_id;
          this.handle(data, onUpdate);
        }
      } catch (error) {
        if (this.online) { this.online = false; onConnection?.(false, error); }
      }
      this.pollTimer = setTimeout(tick, intervalMs);
    };
    tick();
  }

  handle(data, onUpdate) {
    for (const message of data.messages) this.lastSeq = Math.max(this.lastSeq, message.seq);
    onUpdate(data);
  }

  stopPolling() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
