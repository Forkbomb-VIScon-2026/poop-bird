import { describe, expect, it } from "vitest";
import {
  PROBE_ANCHORS,
  auc,
  faceAxes,
  findEdge,
  fromFace,
  measureOutline,
  meshProbes,
  ncc,
  patchVector,
  toFace,
  type RgbaImage,
} from "./outline";

const W = 320;
const H = 240;

/** A skin-coloured ellipse (the face) on a dark background, optionally rotated by `angle`. */
function faceImage(cx: number, cy: number, rx: number, ry: number, angle = 0): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * c + dy * s) / rx;
      const v = (-dx * s + dy * c) / ry;
      const inside = u * u + v * v <= 1;
      const i = (y * W + x) * 4;
      data[i] = inside ? 210 : 40;
      data[i + 1] = inside ? 160 : 50;
      data[i + 2] = inside ? 130 : 60;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** Landmarks for that face: eye corners 40 px apart, contour anchors on the ellipse. */
function landmarks(cx: number, cy: number, rx: number, ry: number, angle = 0) {
  const lm = Array.from({ length: 478 }, () => ({ x: cx / W, y: cy / H }));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const put = (i: number, dx: number, dy: number) => {
    lm[i] = { x: (cx + dx * c - dy * s) / W, y: (cy + dx * s + dy * c) / H };
  };
  put(33, -20, -20);
  put(263, 20, -20);
  PROBE_ANCHORS.forEach(([l, r], k) => {
    const dy = -10 + k * 12;
    const half = rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2));
    put(l, -half, dy);
    put(r, half, dy);
  });
  return lm;
}

describe("face axes", () => {
  it("round-trips between pixels and face coordinates", () => {
    const f = faceAxes(landmarks(160, 120, 50, 70, 0.3), W, H)!;
    const p = fromFace(f, 0.4, 1.1);
    const q = toFace(f, p);
    expect(q.u).toBeCloseTo(0.4);
    expect(q.v).toBeCloseTo(1.1);
    expect(f.s).toBeCloseTo(40);
  });
});

describe("findEdge", () => {
  it("finds the silhouette to within a pixel", () => {
    const img = faceImage(160, 120, 50, 70);
    const f = faceAxes(landmarks(160, 120, 50, 70), W, H)!;
    // At the eye line height (v = 0 is 20 px above the centre), the ellipse edge is at 50·sqrt(1 − (20/70)²).
    const expected = (50 * Math.sqrt(1 - (20 / 70) ** 2)) / 40;
    const right = findEdge(img, f, 0, expected + 0.1)!;
    const left = findEdge(img, f, 0, -expected - 0.1)!;
    expect(right.u).toBeCloseTo(expected, 1);
    expect(left.u).toBeCloseTo(-expected, 1);
    expect(right.strength).toBeGreaterThan(50);
  });
});

describe("measureOutline", () => {
  it("gets wider when the cheeks widen, with the probes frozen", () => {
    const relaxedLm = landmarks(160, 120, 50, 70);
    const f = faceAxes(relaxedLm, W, H)!;
    const probes = meshProbes(relaxedLm, f, W, H);
    const relaxed = measureOutline(faceImage(160, 120, 50, 70), f, probes);
    const puffed = measureOutline(faceImage(160, 120, 55, 70), f, probes);
    for (let k = 0; k < probes.length; k++) expect(puffed.width[k] - relaxed.width[k]).toBeGreaterThan(0.15);
  });

  it("doesn't change when the head moves or tilts", () => {
    const relaxedLm = landmarks(160, 120, 50, 70);
    const f0 = faceAxes(relaxedLm, W, H)!;
    const probes = meshProbes(relaxedLm, f0, W, H);
    const a = measureOutline(faceImage(160, 120, 50, 70), f0, probes);
    const f1 = faceAxes(landmarks(150, 115, 50, 70, 0.25), W, H)!;
    const b = measureOutline(faceImage(150, 115, 50, 70, 0.25), f1, probes);
    for (let k = 0; k < probes.length; k++) expect(b.width[k]).toBeCloseTo(a.width[k], 1);
  });
});

describe("patchVector / ncc", () => {
  it("is 1 for the same patch and ignores brightness", () => {
    const img = faceImage(160, 120, 50, 70);
    const f = faceAxes(landmarks(160, 120, 50, 70), W, H)!;
    const a = patchVector(img, f, 1.1, 0.3, 0.4)!;
    const bright = { ...img, data: img.data.map((x, i) => (i % 4 === 3 ? x : Math.min(255, x + 20))) };
    const b = patchVector(bright, f, 1.1, 0.3, 0.4)!;
    expect(ncc(a, a)).toBeCloseTo(1);
    expect(ncc(a, b)).toBeGreaterThan(0.99);
  });
});

describe("auc", () => {
  it("is 1 for separated, 0.5 for identical and NaN for empty sets", () => {
    expect(auc([1, 2, 3], [4, 5])).toBe(1);
    expect(auc([1, 1], [1, 1])).toBe(0.5);
    expect(auc([4, 5], [1, 2])).toBe(0);
    expect(auc([], [1])).toBeNaN();
  });
});
