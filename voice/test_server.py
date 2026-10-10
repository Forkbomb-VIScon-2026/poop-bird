"""Tests for the voice server's request handling and audio helpers (no model needed).

    docker run --rm poop-bird-voice python -m unittest discover -s voice
"""

import base64
import json
import unittest

import numpy as np

from server import MAX_LINES, decode_wav, encode_wav, normalize, parse_request, trim_silence

RATE = 24000


def tone(seconds: float, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def request(samples=None, lines=None) -> bytes:
    voice = base64.b64encode(encode_wav(tone(5) if samples is None else samples, RATE)).decode()
    return json.dumps({"voice": voice, "lines": lines or [{"id": "a", "text": "Hello!"}]}).encode()


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
        samples, rate, lines = parse_request(request(lines=[{"id": "x", "text": "  Push!  "}]))
        self.assertEqual(rate, RATE)
        self.assertAlmostEqual(len(samples) / rate, 5, delta=0.01)
        self.assertEqual(lines, [{"id": "x", "text": "Push!"}])

    def test_rejects(self):
        cases = {
            "not json": b"nope",
            "no lines": json.dumps({"voice": ""}).encode(),
            "too many lines": request(lines=[{"id": str(i), "text": "hi"} for i in range(MAX_LINES + 1)]),
            "empty text": request(lines=[{"id": "a", "text": "  "}]),
            "long text": request(lines=[{"id": "a", "text": "x" * 500}]),
            "too short": request(samples=tone(0.5)),
            "too long": request(samples=tone(40)),
            "not base64": json.dumps({"voice": "%%%", "lines": [{"id": "a", "text": "hi"}]}).encode(),
        }
        for name, body in cases.items():
            with self.subTest(name), self.assertRaises(ValueError):
                parse_request(body)


if __name__ == "__main__":
    unittest.main()
