// Renders public/assets/audio/button_click.wav: `node scripts/make-button-click.mjs`.
// A toggle-switch click: two tiny bursts of band-passed noise 12 ms apart, the second softer.
import fs from "fs";

const rate = 44100;
const len = Math.round(rate * 0.04);

// RBJ band-pass (constant 0 dB peak gain).
function bandPass(f, q) {
  const w = (2 * Math.PI * f) / rate;
  const a = Math.sin(w) / (2 * q);
  const a0 = 1 + a;
  const b0 = a / a0, b2 = -a / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - a) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const bp = bandPass(1400, 3);
const burst = (t, t0) => (t >= t0 ? Math.exp(-(t - t0) / 0.0018) : 0);
const out = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / rate;
  out[i] = bp(Math.random() * 2 - 1) * (burst(t, 0) + 0.6 * burst(t, 0.012));
}
for (let i = len - 200; i < len; i++) out[i] *= (len - i) / 200;

// Level: RMS 0.08 over the first 30 ms, peak capped below full scale.
let sum = 0;
const n = Math.round(rate * 0.03);
for (let i = 0; i < n; i++) sum += out[i] ** 2;
const peak = Math.max(...out.map(Math.abs));
const gain = Math.min(0.08 / Math.sqrt(sum / n), 0.95 / peak);

const wav = Buffer.alloc(44 + len * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + len * 2, 4); wav.write("WAVE", 8);
wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(len * 2, 40);
for (let i = 0; i < len; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * gain)) * 32767), 44 + i * 2);
fs.writeFileSync(new URL("../public/assets/audio/button_click.wav", import.meta.url), wav);
