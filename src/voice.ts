// The bird talks in the player's voice.
//
// Before the run the player reads VOICE_SCRIPT out loud. The recording goes to
// the voice server (voice/server.py, on our own VM; nothing leaves for a third
// party), which clones the voice and speaks a handful of lines picked from
// VOICE_LINES. They stream back one by one, earliest-needed first, so the bird
// can talk before the rest are done. During the run, game events become cues
// and VoiceDirector picks a line for each, keeping the bird from chattering.
//
// The recording is only ever in memory, and the server drops it after the
// request. The lines are kept until the player goes back to the menu.
//
// The pure parts (line picking, the director, WAV encoding, the loudness
// check) are unit-tested in voice.test.ts.

/** Game moments the bird can comment on. */
export type VoiceCue =
  | "intro" | "takeoff" | "strain" | "bigPoop" | "hit" | "accident" | "photo" | "wedding"
  | "weddingRuined" | "dive" | "pop" | "balloon" | "crash" | "newBest";

/** What the player reads out loud: about 8 s, lively, with a range of sounds. */
export const VOICE_SCRIPT =
  "Hello everyone! I'm a very proud bird, and today I'm flying over the whole city. " +
  "Watch me go. This is going to be absolutely amazing!";

/** Everything the bird might say, per cue. Each player gets a random few (pickLines). */
export const VOICE_LINES: Record<VoiceCue, readonly string[]> = {
  intro: ["Wait. Is that my voice?", "Okay. Deep breath. I can do this.", "Hello? Is this thing on?"],
  takeoff: ["Here we go!", "Up, up and away!", "Let's do this!"],
  strain: ["Push! Push harder!", "Oh, it's coming. It's coming!", "Nnngh. I think I need a doctor.", "Don't look at me!"],
  bigPoop: ["Ahh. Much better.", "Oh wow, that was a big one!", "Bombs away!"],
  hit: ["Bullseye!", "Sorry! Not sorry.", "Right on the head!", "Special delivery!"],
  accident: ["Oh no. Not in front of everyone!", "That was not supposed to happen.", "Nobody saw that. Right?"],
  photo: ["No photos, please!", "Delete that picture right now!"],
  wedding: ["Oh, a wedding! Perfect timing.", "Congratulations! I brought a gift."],
  weddingRuined: ["Best wedding ever!", "You may now kiss the bride."],
  dive: ["Wait, I can't swim!", "Why is there so much water?"],
  pop: ["I think I just popped.", "Ouch! That stings!"],
  balloon: ["Pop goes the balloon!", "Sorry about your balloon!"],
  crash: ["Mommy!", "This is the worst day of my life.", "I regret nothing.", "Tell my mom I was brave."],
  newBest: ["New record! I'm a legend!", "Did you see that? I'm the best!"],
};

/**
 * How many lines each cue gets, in the order they are needed: the intro plays
 * on the ready screen, and first runs are short, so the crash comes early.
 * Every cue's first line is generated before any cue's second.
 */
const CUE_PLAN: readonly [VoiceCue, number][] = [
  ["intro", 1], ["takeoff", 1], ["crash", 2], ["strain", 2], ["bigPoop", 2], ["hit", 2],
  ["accident", 1], ["newBest", 1], ["photo", 1], ["balloon", 1], ["wedding", 1],
  ["weddingRuined", 1], ["dive", 1], ["pop", 1],
];

export interface VoiceLine {
  id: string;
  cue: VoiceCue;
  text: string;
}

/** A random selection of lines for one player, in generation order. */
export function pickLines(random: () => number = Math.random): VoiceLine[] {
  const picked = CUE_PLAN.map(([cue, count]) => {
    const pool = [...VOICE_LINES[cue]];
    const lines: VoiceLine[] = [];
    for (let i = 0; i < count && pool.length; i++) {
      const [text] = pool.splice(Math.floor(random() * pool.length), 1);
      lines.push({ id: `${cue}-${i}`, cue, text });
    }
    return lines;
  });
  const rounds = Math.max(...picked.map((l) => l.length));
  const out: VoiceLine[] = [];
  for (let round = 0; round < rounds; round++) for (const lines of picked) if (lines[round]) out.push(lines[round]);
  return out;
}

// --- Director ------------------------------------------------------------------------

export interface DirectorParams {
  /** Seconds of quiet between two lines. */
  gap: number;
  /** Seconds before the same cue may speak again. */
  cueCooldown: number;
}

/**
 * Decides whether the bird says something for a cue, and what. One line at a
 * time with a gap after it, each cue on its own cooldown, and never the same
 * line twice in a row when the cue has another. `urgent` cues (the crash) cut
 * the current line off and ignore the gap.
 */
export class VoiceDirector {
  private busyUntil = -Infinity;
  private readonly lastCue = new Map<VoiceCue, number>();
  private readonly lastLine = new Map<VoiceCue, string>();

  constructor(private readonly params: DirectorParams, private readonly random: () => number = Math.random) {}

  /**
   * The line to say now for `cue`, or null. `available` are the lines that
   * have arrived so far; `chance` (0..1) thins out frequent cues.
   */
  choose(cue: VoiceCue, now: number, available: readonly VoiceLine[], opts: { urgent?: boolean; chance?: number } = {}): VoiceLine | null {
    if (!opts.urgent && now < this.busyUntil + this.params.gap) return null;
    if (now - (this.lastCue.get(cue) ?? -Infinity) < this.params.cueCooldown) return null;
    const lines = available.filter((l) => l.cue === cue);
    if (!lines.length) return null;
    if (opts.chance !== undefined && this.random() >= opts.chance) return null;
    const fresh = lines.length > 1 ? lines.filter((l) => l.id !== this.lastLine.get(cue)) : lines;
    const line = fresh[Math.floor(this.random() * fresh.length)];
    this.lastCue.set(cue, now);
    this.lastLine.set(cue, line.id);
    return line;
  }

  /** The chosen line started playing and lasts `seconds`. */
  speaking(now: number, seconds: number): void {
    this.busyUntil = now + seconds;
  }

  reset(): void {
    this.busyUntil = -Infinity;
    this.lastCue.clear();
    this.lastLine.clear();
  }
}

// --- Audio helpers ---------------------------------------------------------------------

/** The rate the voice model works at; recordings are sent at this rate. */
export const VOICE_RATE = 24000;

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

/** Seconds of the recording that are clearly speech: 50 ms windows louder than `threshold` RMS. */
export function voicedSeconds(samples: Float32Array, rate: number, threshold = 0.02): number {
  const win = Math.max(1, Math.round(rate * 0.05));
  let voiced = 0;
  for (let start = 0; start + win <= samples.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / win) >= threshold) voiced++;
  }
  return (voiced * win) / rate;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): ArrayBuffer {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

// --- Recording -----------------------------------------------------------------------------

/** Collects the mic's samples on the audio thread and posts them in blocks. */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(4096); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

/**
 * Records the microphone. `start()` asks for the mic; `level` is the live
 * loudness (0..1) for a meter; `stop()` returns the recording resampled to
 * VOICE_RATE and releases the mic.
 */
export class VoiceRecorder {
  level = 0;
  seconds = 0;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private chunks: Float32Array[] = [];

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      // A hackathon hall is loud: let the browser clean the signal up.
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      this.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, "capture");
      const rate = this.ctx.sampleRate;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const block = e.data;
        this.chunks.push(block);
        this.seconds += block.length / rate;
        let peak = 0;
        for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
        this.level = Math.max(peak, this.level * 0.85);
      };
      // The node must reach the destination to run; it outputs silence.
      source.connect(node).connect(this.ctx.destination);
      if (this.ctx.state === "suspended") await this.ctx.resume();
    } catch (err) {
      this.cancel();
      throw err;
    }
  }

  async stop(): Promise<Float32Array> {
    const ctx = this.ctx;
    const rate = ctx?.sampleRate ?? VOICE_RATE;
    const chunks = this.chunks;
    this.cancel();
    const n = chunks.reduce((s, c) => s + c.length, 0);
    const all = new Float32Array(n);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    return resample(all, rate, VOICE_RATE);
  }

  /** Releases the mic and drops the recording. */
  cancel(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chunks = [];
    this.level = 0;
    this.seconds = 0;
  }
}

/** The browser's resampler (properly low-passed) via an offline context. */
async function resample(samples: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const offline = new OfflineAudioContext(1, length, to);
  const buffer = offline.createBuffer(1, samples.length, from);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0);
}

// --- Server ---------------------------------------------------------------------------------

const API = `${import.meta.env.BASE_URL}api/voice`;

/** Whether the voice server is up and can clone voices (false on any error, after `timeoutMs`). */
export async function voiceAvailable(timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return false;
    const h = (await res.json()) as { ready?: boolean; cloning?: boolean };
    return h.ready === true && h.cloning === true;
  } catch {
    return false;
  }
}

/**
 * Sends the recording and the lines; calls `onLine` with each line's WAV as it
 * arrives. Resolves when all are done; rejects on an error or `signal` abort.
 */
export async function fetchLines(
  recording: Float32Array,
  lines: readonly VoiceLine[],
  onLine: (id: string, wav: ArrayBuffer) => void,
  signal: AbortSignal,
): Promise<void> {
  const body = JSON.stringify({
    voice: toBase64(encodeWav(recording, VOICE_RATE)),
    lines: lines.map(({ id, text }) => ({ id, text })),
  });
  const res = await fetch(`${API}/lines`, { method: "POST", body, signal, headers: { "Content-Type": "application/json" } });
  if (!res.ok || !res.body) {
    const detail = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
    throw new Error(`voice server: ${res.status}${detail ? ` ${detail}` : ""}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const text = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!text) continue;
      const msg = JSON.parse(text) as { id?: string; wav?: string; done?: boolean; error?: string };
      if (msg.error) throw new Error(`voice server: ${msg.error}`);
      if (msg.done) return;
      if (msg.id && msg.wav) onLine(msg.id, fromBase64(msg.wav));
    }
  }
  throw new Error("voice server: stream ended early");
}
