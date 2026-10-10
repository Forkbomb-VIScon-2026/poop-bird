"""Voice server: the bird talks in the player's voice.

The game records the player reading a short text, sends the recording here
with the lines it wants spoken, and gets every line back in the player's voice,
one at a time as they are ready (NDJSON), so the first lines can play while
the rest are still being made.

It runs Kyutai's Pocket TTS on the CPU (no GPU, two cores). The recording
lives in memory for one request only: it is never written to disk or logged,
and the cloned voice is dropped once the lines are made.

Endpoints (Caddy routes /api/voice/* here):
  GET  /api/voice/health   {"ready": bool, "cloning": bool, "busy": bool}
  POST /api/voice/lines    JSON {"voice": base64 WAV, "lines": ["crash:0", ...]}
                           → 200 NDJSON: {"id", "wav": base64 WAV} per line,
                             then {"done": true}; or {"error": ...} with a 4xx/5xx

It speaks only the game's own lines (lines.json, by id): a caller can't make
it say anything else in someone's voice.

The cloning weights are gated on Hugging Face: accept the terms at
https://huggingface.co/kyutai/pocket-tts and pass a token as HF_TOKEN. Without
one the server still starts, but reports "cloning": false and refuses
requests, and the game plays without the voice.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import threading
import time
import wave
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

log = logging.getLogger("voice")

PORT = int(os.environ.get("PORT", "8790"))
# Two cores leave the rest of the VM to the game and the collector.
THREADS = int(os.environ.get("TORCH_THREADS", "2"))
# Dev only: speak with this built-in voice instead of cloning (e.g. "alba"),
# for testing the pipeline without the gated cloning weights.
FALLBACK_VOICE = os.environ.get("VOICE_FALLBACK_VOICE", "")

MAX_BODY = 4 * 1024 * 1024
MAX_LINES = 24
MIN_VOICE_SECONDS = 2.0
MAX_VOICE_SECONDS = 30.0
# Requests waiting behind the one being served; more get a 429.
MAX_WAITING = 2



def load_lines(path: Path = Path(__file__).with_name("lines.json")) -> dict[str, str]:
    """The game's lines by id ("crash:0"), from lines.json (shared with src/voice.ts)."""
    corpus = json.loads(path.read_text(encoding="utf-8"))
    return {
        f"{cue}:{i}": text
        for cue, texts in corpus.items()
        if not cue.startswith("_")
        for i, text in enumerate(texts)
    }


LINES = load_lines()


# --- Audio helpers (pure, unit-tested) --------------------------------------------


def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """Mono float32 samples in [-1, 1] and the sample rate, from a 16-bit PCM WAV."""
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("expected 16-bit PCM")
        channels = w.getnchannels()
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def encode_wav(samples: np.ndarray, rate: int) -> bytes:
    """16-bit PCM mono WAV."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def trim_silence(samples: np.ndarray, rate: int, threshold: float = 0.1, pad: float = 0.15) -> np.ndarray:
    """
    Cuts leading and trailing silence: everything outside the first and last
    20 ms window whose RMS reaches `threshold` × the loudest window, plus `pad` s.
    """
    win = max(1, int(rate * 0.02))
    n = len(samples) // win
    if n == 0:
        return samples
    rms = np.sqrt(np.mean(samples[: n * win].reshape(n, win) ** 2, axis=1))
    loud = np.nonzero(rms >= rms.max() * threshold)[0]
    if len(loud) == 0 or rms.max() <= 0:
        return samples
    p = int(pad * rate)
    return samples[max(0, loud[0] * win - p) : min(len(samples), (loud[-1] + 1) * win + p)]


def normalize(samples: np.ndarray, peak: float = 0.9) -> np.ndarray:
    """Scales to the given peak (a quiet laptop mic and a headset sound alike)."""
    top = float(np.max(np.abs(samples))) if len(samples) else 0.0
    return samples if top < 1e-4 else samples * (peak / top)


def parse_request(body: bytes, known: dict[str, str] = LINES) -> tuple[np.ndarray, int, list[dict[str, str]]]:
    """
    Validates a /lines request and looks up the lines' texts. Raises ValueError
    with a message for the client.
    """
    try:
        req = json.loads(body)
    except json.JSONDecodeError as e:
        raise ValueError("body must be JSON") from e
    if not isinstance(req, dict):
        raise ValueError("body must be a JSON object")
    lines = req.get("lines")
    if not isinstance(lines, list) or not 1 <= len(lines) <= MAX_LINES:
        raise ValueError(f"lines: 1 to {MAX_LINES} entries")
    if len(set(map(str, lines))) != len(lines):
        raise ValueError("lines: no duplicates")
    clean: list[dict[str, str]] = []
    for lid in lines:
        if not isinstance(lid, str) or lid not in known:
            raise ValueError("lines: ids of the game's lines (lines.json)")
        clean.append({"id": lid, "text": known[lid]})
    voice = req.get("voice")
    if not isinstance(voice, str):
        raise ValueError("voice: base64 WAV")
    try:
        samples, rate = decode_wav(base64.b64decode(voice, validate=True))
    except (ValueError, wave.Error, EOFError) as e:
        raise ValueError("voice: base64 WAV, 16-bit PCM") from e
    if not 8000 <= rate <= 48000:
        raise ValueError("voice: sample rate 8 to 48 kHz")
    seconds = len(samples) / rate
    if not MIN_VOICE_SECONDS <= seconds <= MAX_VOICE_SECONDS:
        raise ValueError(f"voice: {MIN_VOICE_SECONDS:g} to {MAX_VOICE_SECONDS:g} s of audio")
    return samples, rate, clean


# --- Model ---------------------------------------------------------------------------


class Voice:
    """The Pocket TTS model, loaded once in the background; one request at a time."""

    def __init__(self) -> None:
        self.model = None
        self.cloning = False
        self.error: str | None = None
        self.lock = threading.Lock()
        self.waiting = 0
        self.waiting_lock = threading.Lock()

    def load(self) -> None:
        try:
            import torch
            from pocket_tts import TTSModel

            torch.set_num_threads(THREADS)
            t0 = time.time()
            model = TTSModel.load_model()
            self.cloning = bool(model.has_voice_cloning)
            # The first generation is slow (allocations, kernel choice): pay it now.
            warm = model.get_state_for_audio_prompt("alba")
            model.generate_audio(warm, "Ready.")
            self.model = model
            log.info("model ready in %.1fs (voice cloning: %s)", time.time() - t0, self.cloning)
            if not self.cloning:
                log.warning("no voice cloning weights: accept the terms on huggingface.co/kyutai/pocket-tts and set HF_TOKEN")
        except Exception as e:  # noqa: BLE001 - reported on /health
            self.error = f"{type(e).__name__}: {e}"
            log.exception("model failed to load")

    @property
    def usable(self) -> bool:
        return self.model is not None and (self.cloning or bool(FALLBACK_VOICE))

    def health(self) -> dict:
        return {"ready": self.model is not None, "cloning": self.usable, "busy": self.lock.locked()}

    def speak(self, samples: np.ndarray, rate: int, lines: list[dict[str, str]]):
        """Yields (id, wav bytes) per line, in order. Call with the lock held."""
        import torch
        from pocket_tts.data.audio_utils import convert_audio

        model = self.model
        assert model is not None
        t0 = time.time()
        if FALLBACK_VOICE and not self.cloning:
            state = model.get_state_for_audio_prompt(FALLBACK_VOICE)
        else:
            audio = torch.from_numpy(normalize(trim_silence(samples, rate))).unsqueeze(0)
            audio = convert_audio(audio, rate, model.sample_rate, 1)
            state = model.get_state_for_audio_prompt(audio)
        del samples
        log.info("voice cloned in %.2fs", time.time() - t0)
        for line in lines:
            t = time.time()
            out = model.generate_audio(state, line["text"])
            wav = encode_wav(normalize(out.numpy().reshape(-1)), model.sample_rate)
            log.info("line %s: %.2fs", line["id"], time.time() - t)
            yield line["id"], wav


VOICE = Voice()


# --- HTTP ------------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "poopbird-voice"

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        log.debug("%s " + fmt, self.address_string(), *args)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.split("?")[0] == "/api/voice/health":
            return self.send_json(200, VOICE.health())
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/api/voice/lines":
            return self.send_json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.close_connection = True
            return self.send_json(413, {"error": f"body: 1 byte to {MAX_BODY // 1024 // 1024} MB"})
        body = self.rfile.read(length)
        try:
            samples, rate, lines = parse_request(body)
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        del body
        if not VOICE.usable:
            return self.send_json(503, {"error": VOICE.error or ("loading" if VOICE.model is None else "no voice cloning")})
        with VOICE.waiting_lock:
            if VOICE.waiting > MAX_WAITING:
                return self.send_json(429, {"error": "busy, try again in a moment"})
            VOICE.waiting += 1
        try:
            with VOICE.lock:
                self.stream(samples, rate, lines)
        finally:
            with VOICE.waiting_lock:
                VOICE.waiting -= 1

    def stream(self, samples: np.ndarray, rate: int, lines: list[dict[str, str]]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        # Caddy and browsers pass the chunks on as they come.
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def chunk(obj: dict) -> None:
            data = (json.dumps(obj) + "\n").encode()
            self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()

        try:
            for lid, wav in VOICE.speak(samples, rate, lines):
                chunk({"id": lid, "wav": base64.b64encode(wav).decode()})
            chunk({"done": True})
        except (BrokenPipeError, ConnectionResetError):
            # The player moved on (new recording, closed the tab): stop generating.
            log.info("client went away")
            self.close_connection = True
            return
        except Exception as e:  # noqa: BLE001
            log.exception("generation failed")
            try:
                chunk({"error": f"generation failed: {type(e).__name__}"})
            except OSError:
                self.close_connection = True
                return
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    threading.Thread(target=VOICE.load, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log.info("listening on :%d", PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
