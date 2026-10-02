"""Automatic checks for the backend. Run with:  python -m unittest -v"""
import unittest

import app as signconnect


class ApiTest(unittest.TestCase):
    def setUp(self):
        signconnect._rooms.clear()
        signconnect._evaluations.clear()
        self.client = signconnect.app.test_client()

    def post(self, path, payload=None):
        return self.client.post(path, json=payload or {})

    def test_pages_and_health(self):
        for page in ("/", "/caller"):
            with self.client.get(page) as response:
                self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.get("/api/health").get_json()["ok"])

    def test_full_live_call(self):
        self.assertEqual(self.post("/api/rooms/test/ring", {"mode": "live"}).status_code, 200)
        self.assertEqual(self.client.get("/api/rooms/test").get_json()["room"]["status"], "ringing")
        self.assertEqual(self.post("/api/rooms/test/answer").status_code, 200)

        r = self.post("/api/rooms/test/messages", {
            "sender": "caller", "source": "live_stt", "text": "Does Sunday work?",
            "meta": {"stt_finalize_ms": 400}})
        self.assertEqual(r.status_code, 200)
        seq = r.get_json()["message"]["seq"]
        self.post("/api/rooms/test/messages/%d/ack" % seq, {"event": "displayed"})

        r = self.post("/api/rooms/test/messages", {
            "sender": "user", "source": "live_sign", "text": "Yes.",
            "meta": {"signs": ["YES"], "sign_hold_ms": 700, "avg_inference_ms": 12.5}})
        self.post("/api/rooms/test/messages/%d/ack" % r.get_json()["message"]["seq"], {"event": "spoken"})

        polled = self.client.get("/api/rooms/test?since=1").get_json()
        self.assertEqual([m["seq"] for m in polled["messages"]], [2])

        summary = self.post("/api/rooms/test/end").get_json()["summary"]
        self.assertTrue(summary["completed"])
        self.assertTrue(summary["completed_with_signs_only"])
        self.assertEqual(summary["signs_recognized"], ["YES"])
        self.assertEqual(summary["latency"]["stt_finalize_ms"], 400)
        self.assertIsNotNone(summary["latency"]["caller_speech_to_screen_ms"])
        self.assertIsNotNone(summary["latency"]["user_send_to_caller_audio_ms"])

    def test_live_call_rejects_demo_lines(self):
        self.post("/api/rooms/x/ring", {"mode": "live"})
        self.post("/api/rooms/x/answer")
        r = self.post("/api/rooms/x/messages", {"sender": "caller", "source": "demo_script", "text": "hi"})
        self.assertEqual(r.status_code, 400)

    def test_demo_lines_excluded_from_latency(self):
        self.post("/api/rooms/d/ring", {"mode": "demo"})
        self.post("/api/rooms/d/answer")
        self.post("/api/rooms/d/messages", {"sender": "caller", "source": "demo_script", "text": "Hello"})
        self.post("/api/rooms/d/messages", {"sender": "user", "source": "demo_script", "text": "Yes."})
        summary = self.post("/api/rooms/d/end").get_json()["summary"]
        self.assertEqual(summary["caller_messages"]["demo_script"], 1)
        self.assertFalse(summary["completed_with_signs_only"])
        self.assertIsNone(summary["latency"]["caller_speech_to_screen_ms"])

    def test_validation(self):
        self.post("/api/rooms/v/ring", {})
        r = self.post("/api/rooms/v/messages", {"sender": "caller", "source": "live_stt", "text": "hi"})
        self.assertEqual(r.status_code, 400)  # not answered yet
        self.post("/api/rooms/v/answer")
        self.assertEqual(self.post("/api/rooms/v/messages", {"sender": "x", "source": "typed", "text": "a"}).status_code, 400)
        self.assertEqual(self.post("/api/rooms/v/messages", {"sender": "user", "source": "magic", "text": "a"}).status_code, 400)
        self.assertEqual(self.post("/api/rooms/v/messages", {"sender": "user", "source": "typed", "text": " "}).status_code, 400)

    def test_new_call_clears_messages(self):
        self.post("/api/rooms/n/ring", {})
        self.post("/api/rooms/n/answer")
        self.post("/api/rooms/n/messages", {"sender": "user", "source": "typed", "text": "a"})
        self.post("/api/rooms/n/ring", {})
        state = self.client.get("/api/rooms/n").get_json()
        self.assertEqual(state["messages"], [])
        self.assertEqual(state["room"]["call_id"], 2)

    def test_evaluation(self):
        r = self.post("/api/evaluations", {"trials": [
            {"expected": "YES", "predicted": "YES", "time_ms": 900},
            {"expected": "NO", "predicted": "", "time_ms": None}]})
        self.assertEqual(r.get_json()["evaluation"]["accuracy"], 0.5)
        self.assertEqual(len(self.client.get("/api/evaluations").get_json()["evaluations"]), 1)


if __name__ == "__main__":
    unittest.main()
