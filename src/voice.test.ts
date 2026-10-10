import { describe, expect, it } from "vitest";
import {
  VOICE_LINES,
  VoiceDirector,
  encodeWav,
  fromBase64,
  pickLines,
  toBase64,
  voicedSeconds,
  type VoiceLine,
} from "./voice";

/** Deterministic random numbers in [0, 1). */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("pickLines", () => {
  it("picks distinct lines per cue, intro first, with unique ids", () => {
    const lines = pickLines(seeded(3));
    expect(lines[0].cue).toBe("intro");
    // Every cue's first line comes before any second line.
    const firstSecond = lines.findIndex((l) => l.id.endsWith("-1"));
    expect(new Set(lines.slice(0, firstSecond).map((l) => l.cue)).size).toBe(firstSecond);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    for (const l of lines) expect(VOICE_LINES[l.cue]).toContain(l.text);
    const strain = lines.filter((l) => l.cue === "strain");
    expect(strain).toHaveLength(2);
    expect(strain[0].text).not.toBe(strain[1].text);
  });

  it("keeps the request small enough for the server", () => {
    const lines = pickLines();
    expect(lines.length).toBeLessThanOrEqual(24);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(160);
  });
});

describe("VoiceDirector", () => {
  const lines: VoiceLine[] = [
    { id: "hit-0", cue: "hit", text: "Bullseye!" },
    { id: "hit-1", cue: "hit", text: "Sorry! Not sorry." },
    { id: "crash-0", cue: "crash", text: "Mommy!" },
  ];
  const make = () => new VoiceDirector({ gap: 3, cueCooldown: 10 }, seeded(7));

  it("waits for the gap after a line, and the cue's cooldown", () => {
    const d = make();
    expect(d.choose("hit", 0, lines)).not.toBeNull();
    d.speaking(0, 1);
    expect(d.choose("crash", 2, lines)).toBeNull(); // still in the gap (1 s line + 3 s)
    expect(d.choose("crash", 4.5, lines)).not.toBeNull();
    d.speaking(4.5, 1);
    expect(d.choose("hit", 9, lines)).toBeNull(); // hit's cooldown runs until 10
    expect(d.choose("hit", 10, lines)).not.toBeNull();
  });

  it("lets urgent cues interrupt, but not repeat within their cooldown", () => {
    const d = make();
    d.choose("hit", 0, lines);
    d.speaking(0, 2);
    expect(d.choose("crash", 0.5, lines, { urgent: true })?.text).toBe("Mommy!");
    expect(d.choose("crash", 1, lines, { urgent: true })).toBeNull();
  });

  it("doesn't say the same line twice in a row when the cue has another", () => {
    const d = make();
    let prev = "";
    for (let t = 0; t < 200; t += 20) {
      const line = d.choose("hit", t, lines)!;
      expect(line.id).not.toBe(prev);
      prev = line.id;
    }
  });

  it("stays quiet without a line for the cue, or when chance says no", () => {
    const d = make();
    expect(d.choose("wedding", 0, lines)).toBeNull();
    expect(d.choose("hit", 0, lines, { chance: 0 })).toBeNull();
    expect(d.choose("hit", 0, lines, { chance: 1 })).not.toBeNull();
  });
});

describe("audio helpers", () => {
  it("writes a 16-bit mono WAV header", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 24000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32767);
  });

  it("counts only the loud parts as speech", () => {
    const rate = 24000;
    const x = new Float32Array(rate * 3);
    for (let i = rate; i < rate * 2; i++) x[i] = 0.3 * Math.sin((i / rate) * 2 * Math.PI * 200);
    expect(voicedSeconds(x, rate)).toBeCloseTo(1, 1);
  });

  it("round-trips base64", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(new Uint8Array(fromBase64(toBase64(bytes)))).toEqual(bytes);
  });
});
