"""Tests for the voice server's request handling and audio helpers (no model needed).

    docker run --rm poop-bird-voice python -m unittest discover -s voice
"""

import base64
import json
import unittest

import numpy as np

from server import LINES, MAX_LINES, decode_wav, encode_wav, normalize, parse_request, trim_silence

RATE = 24000


def tone(seconds: float, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def request(samples=None, lines=None) -> bytes:
    voice = base64.b64encode(encode_wav(tone(5) if samples is None else samples, RATE)).decode()
    return json.dumps({"voice": voice, "lines": lines or ["crash:0"]}).encode()


class AudioTest(unittest.TestCase):
    def test_wav_round_trip(self):
        x = tone(1)
        y, rate = decode_wav(encode_wav(x, RATE))
        self.assertEqual(rate, RATE)
        self.assertLess(np.max(np.abs(x - y)), 1e-3)

    def test_trim_silence_keeps_speech_and_padding(self):
        x = np.concatenate([np.zeros(RATE), tone(2), np.zeros(RATE)]).astype(np.float32)
        y = trim_silence(x, RATE, pad=0.1)
        self.assertAlmostEqual(len(y) / RATE, 2.2, delta=0.05)

    def test_trim_silence_on_silence_is_a_no_op(self):
        x = np.zeros(RATE, dtype=np.float32)
        self.assertEqual(len(trim_silence(x, RATE)), RATE)

    def test_normalize(self):
        self.assertAlmostEqual(float(np.max(np.abs(normalize(tone(1, 0.05))))), 0.9, places=3)
        self.assertEqual(float(np.max(np.abs(normalize(np.zeros(10))))), 0.0)


class ParseTest(unittest.TestCase):
    def test_valid(self):
        samples, rate, lines = parse_request(request(lines=["strain:0", "crash:0"]))
        self.assertEqual(rate, RATE)
        self.assertAlmostEqual(len(samples) / rate, 5, delta=0.01)
        self.assertEqual(lines, [{"id": "strain:0", "text": LINES["strain:0"]}, {"id": "crash:0", "text": LINES["crash:0"]}])

    def test_corpus(self):
        self.assertEqual(LINES["crash:0"], "Mommy!")
        self.assertFalse(any(k.startswith("_") for k in LINES))

    def test_rejects(self):
        cases = {
            "not json": b"nope",
            "no lines": json.dumps({"voice": ""}).encode(),
            "too many lines": request(lines=list(LINES)[: MAX_LINES + 1]),
            "own text": request(lines=[{"id": "a", "text": "Say whatever I want"}]),
            "unknown id": request(lines=["crash:99"]),
            "duplicate": request(lines=["crash:0", "crash:0"]),
            "too short": request(samples=tone(0.5)),
            "too long": request(samples=tone(40)),
            "not base64": json.dumps({"voice": "%%%", "lines": ["crash:0"]}).encode(),
        }
        for name, body in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                parse_request(body)


if __name__ == "__main__":
    unittest.main()


class HttpTest(unittest.TestCase):
    """The HTTP handler against a stub model: streaming, validation, the queue."""

    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer

        import server

        class StubVoice(server.Voice):
            def __init__(self):
                super().__init__()
                self.model = object()
                self.cloning = True
                self.release = threading.Event()
                self.release.set()

            def speak(self, samples, rate, lines):
                for line in lines:
                    self.release.wait(5)
                    yield line["id"], encode_wav(tone(0.1), RATE)

        self.server_module = server
        self.saved = server.VOICE
        server.VOICE = self.stub = StubVoice()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/api/voice"

    def tearDown(self):
        self.stub.release.set()
        self.httpd.shutdown()
        self.httpd.server_close()
        self.server_module.VOICE = self.saved

    def post(self, body: bytes):
        import urllib.error
        import urllib.request

        try:
            with urllib.request.urlopen(urllib.request.Request(f"{self.url}/lines", data=body), timeout=10) as res:
                return res.status, res.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_streams_one_json_line_per_voice_line(self):
        status, text = self.post(request(lines=["intro:0", "crash:0"]))
        self.assertEqual(status, 200)
        msgs = [json.loads(line) for line in text.splitlines()]
        self.assertEqual([m.get("id") for m in msgs], ["intro:0", "crash:0", None])
        self.assertTrue(msgs[-1]["done"])
        self.assertEqual(base64.b64decode(msgs[0]["wav"])[:4], b"RIFF")

    def test_rejects_own_text_over_http(self):
        status, text = self.post(request(lines=[{"id": "a", "text": "Say this"}]))
        self.assertEqual(status, 400)

    def test_turns_requests_away_when_the_queue_is_full(self):
        import threading
        import time
        import urllib.request

        self.stub.release.clear()
        hold = [threading.Thread(target=self.post, args=(request(),), daemon=True) for _ in range(3)]
        for t in hold:
            t.start()
        for _ in range(100):
            if self.stub.waiting == 3:
                break
            time.sleep(0.02)
        self.assertEqual(self.stub.waiting, 3)
        with urllib.request.urlopen(f"{self.url}/health", timeout=5) as res:
            self.assertTrue(json.loads(res.read())["full"])
        status, _ = self.post(request())
        self.assertEqual(status, 429)
        self.stub.release.set()
        for t in hold:
            t.join(10)
        self.assertEqual(self.stub.waiting, 0)
