import { describe, expect, it } from "vitest";
import {
  assessPuffCalibration,
  buildPuffCalibration,
  faceGeometry,
  fallbackPuff,
  initialPuffState,
  rawPuff,
  stepKeyPuff,
  stepPuff,
  type LandmarkPoint,
} from "./puff";
import {
  FEATURE_NAMES,
  PUFF_FEATURES,
  STRAIN_FEATURES,
  buildCalibration,
  featureStats,
  zeroFeatures,
  type FeatureVector,
} from "./strain";

const PARAMS = {
  minFeatureDelta: 0.04,
  featureClampMax: 1.3,
  oceanHoverPuff: 0.4,
  oceanPuffMinSeparation: 1.5,
  oceanMinPuffChange: 0.5,
  oceanFallbackMin: 0.1,
  oceanFallbackMax: 0.5,
  emaAlpha: 1,
  faceLossGrace: 0.25,
};

function fv(values: Partial<FeatureVector>): FeatureVector {
  return { ...zeroFeatures(), ...values };
}

function samples(base: Partial<FeatureVector>, n: number, noise = 0.003): FeatureVector[] {
  return Array.from({ length: n }, (_, i) => {
    const v = fv(base);
    for (const f of FEATURE_NAMES) v[f] = Math.max(0, v[f] + Math.sin((i + f.length) * 12.9898) * noise);
    return v;
  });
}

// Like MediaPipe: cheekPuff stays ~0 even when puffing. The puff shows up in
// the cheek geometry (small changes) and in pursed lips (blendshapes).
const FACE = { cheekWidth: 0.7, cheekBulge: 0.2, mouthWidth: 0.55, cheekPuff: 0.00001 };
const RELAXED = { ...FACE, browDown: 0.05, mouthPucker: 0.05 };
const STRAINED = { ...RELAXED, browDown: 0.7, eyeSquint: 0.6 };
const PUFFED = { ...RELAXED, cheekWidth: 0.73, cheekBulge: 0.24, mouthWidth: 0.5, mouthPucker: 0.3 };

const mainCal = buildCalibration(featureStats(samples(RELAXED, 40)), featureStats(samples(STRAINED, 40)), PARAMS);

describe("faceGeometry", () => {
  /** A crude frontal face: 478 points at the centre, the ones we measure placed explicitly. */
  function face(opts: { contour?: number; bulge?: number; mouth?: number; scale?: number; dx?: number } = {}): LandmarkPoint[] {
    const { contour = 0.28, bulge = 0.02, mouth = 0.1, scale = 1, dx = 0 } = opts;
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const set = (i: number, x: number, y: number, z = 0) => {
      lm[i] = { x: 0.5 + (x - 0.5) * scale + dx, y: 0.5 + (y - 0.5) * scale, z: z * scale };
    };
    set(33, 0.4, 0.4);
    set(263, 0.6, 0.4);
    set(132, 0.5 - contour / 2, 0.6);
    set(361, 0.5 + contour / 2, 0.6);
    set(58, 0.5 - (contour - 0.02) / 2, 0.65);
    set(288, 0.5 + (contour - 0.02) / 2, 0.65);
    for (const i of [50, 280, 205, 425]) set(i, 0.5, 0.55, -bulge);
    set(61, 0.5 - mouth / 2, 0.65);
    set(291, 0.5 + mouth / 2, 0.65);
    return lm;
  }

  it("measures widths and bulge relative to the eye distance", () => {
    const g = faceGeometry(face(), 1)!;
    expect(g.cheekWidth).toBeCloseTo((0.28 + 0.26) / 2 / 0.2 / 2);
    expect(g.mouthWidth).toBeCloseTo(0.5);
    expect(g.cheekBulge).toBeCloseTo(0.1);
  });

  it("doesn't depend on face size or position", () => {
    const a = faceGeometry(face(), 1)!;
    const b = faceGeometry(face({ scale: 1.6, dx: 0.1 }), 1)!;
    expect(b.cheekWidth).toBeCloseTo(a.cheekWidth);
    expect(b.cheekBulge).toBeCloseTo(a.cheekBulge);
    expect(b.mouthWidth).toBeCloseTo(a.mouthWidth);
  });

  it("goes up for wider, more forward cheeks and down for a narrower mouth", () => {
    const relaxed = faceGeometry(face(), 1)!;
    const puffed = faceGeometry(face({ contour: 0.3, bulge: 0.03, mouth: 0.09 }), 1)!;
    expect(puffed.cheekWidth).toBeGreaterThan(relaxed.cheekWidth);
    expect(puffed.cheekBulge).toBeGreaterThan(relaxed.cheekBulge);
    expect(puffed.mouthWidth).toBeLessThan(relaxed.mouthWidth);
  });

  it("corrects for the video aspect ratio", () => {
    // Same face in a 4:3 video: normalized x is squeezed, aspect undoes it.
    const square = faceGeometry(face(), 1)!;
    const squeezed = face().map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.75, y: p.y, z: p.z * 0.75 }));
    const wide = faceGeometry(squeezed, 4 / 3)!;
    expect(wide.cheekWidth).toBeCloseTo(square.cheekWidth);
    expect(wide.cheekBulge).toBeCloseTo(square.cheekBulge);
  });

  it("returns null for missing or degenerate landmarks", () => {
    expect(faceGeometry([], 1)).toBeNull();
    expect(faceGeometry(Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })), 1)).toBeNull();
  });
});

describe("buildPuffCalibration", () => {
  const cal = buildPuffCalibration(mainCal, samples(PUFFED, 40), PARAMS)!;

  it("reuses the main calibration's neutral phase", () => {
    expect(cal.neutral.cheekWidth).toBeCloseTo(mainCal.neutral.cheekWidth);
  });

  it("finds the puff in geometry and lips although cheekPuff never moves", () => {
    expect(cal.weights.cheekWidth).toBeGreaterThan(0);
    expect(cal.weights.cheekBulge).toBeGreaterThan(0);
    expect(cal.weights.mouthWidth).toBeGreaterThan(0);
    expect(cal.weights.mouthPucker).toBeGreaterThan(0);
    expect(cal.weights.cheekPuff).toBe(0);
  });

  it("weights by separation, so a small clean geometry change counts as much as a big blendshape change", () => {
    expect(cal.weights.cheekWidth).toBeCloseTo(cal.weights.mouthPucker);
  });

  it("only weights puff candidates", () => {
    for (const f of FEATURE_NAMES) if (!PUFF_FEATURES.includes(f)) expect(cal.weights[f]).toBe(0);
  });

  it("scores relaxed ~0 and full puff ~1, as a continuous value", () => {
    expect(rawPuff(fv(RELAXED), cal, PARAMS)).toBeCloseTo(0, 1);
    expect(rawPuff(fv(PUFFED), cal, PARAMS)).toBeCloseTo(1, 1);
    const half = rawPuff(fv({ ...RELAXED, cheekWidth: 0.715, cheekBulge: 0.22, mouthWidth: 0.525, mouthPucker: 0.175 }), cal, PARAMS);
    expect(half).toBeGreaterThan(0.35);
    expect(half).toBeLessThan(0.65);
  });

  it("ignores features that moved less than their noise", () => {
    const wobbly = buildPuffCalibration(mainCal, samples({ ...PUFFED, mouthFunnel: 0.002 }, 40), PARAMS)!;
    expect(wobbly.weights.mouthFunnel).toBe(0);
  });

  it("returns null without neutral std (calibration saved before the ocean stage)", () => {
    const legacy = { ...mainCal };
    delete legacy.neutralStd;
    expect(buildPuffCalibration(legacy, samples(PUFFED, 40), PARAMS)).toBeNull();
  });
});

describe("strain is unaffected by the puff features", () => {
  it("gives puff-only features exactly zero strain weight, even if they moved while straining", () => {
    const strainingWithPuff = { ...STRAINED, cheekWidth: 0.75, cheekBulge: 0.26, mouthWidth: 0.45, mouthPucker: 0.4, mouthFunnel: 0.3 };
    const cal = buildCalibration(featureStats(samples(RELAXED, 40)), featureStats(samples(strainingWithPuff, 40)), PARAMS);
    for (const f of FEATURE_NAMES) if (!STRAIN_FEATURES.includes(f)) expect(cal.weights[f]).toBe(0);
  });
});

describe("assessPuffCalibration", () => {
  it("accepts a clear, steady puff", () => {
    const puff = samples(PUFFED, 40);
    const cal = buildPuffCalibration(mainCal, puff, PARAMS)!;
    const q = assessPuffCalibration(cal, puff, { strain: 1 }, PARAMS);
    expect(q.ok).toBe(true);
    expect(q.hitRate).toBeGreaterThan(0.9);
  });

  it("rejects a puff that barely differs from neutral", () => {
    const puff = samples({ ...RELAXED, cheekWidth: 0.701, mouthPucker: 0.052 }, 40);
    const cal = buildPuffCalibration(mainCal, puff, PARAMS)!;
    const q = assessPuffCalibration(cal, puff, { strain: 1 }, PARAMS);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/relaxed/);
  });

  it("rejects low face coverage or too few samples", () => {
    const puff = samples(PUFFED, 40);
    const cal = buildPuffCalibration(mainCal, puff, PARAMS)!;
    expect(assessPuffCalibration(cal, puff, { strain: 0.3 }, PARAMS).ok).toBe(false);
    expect(assessPuffCalibration(cal, puff.slice(0, 3), { strain: 1 }, PARAMS).ok).toBe(false);
  });

  it("rejects a puff held for only part of the phase", () => {
    const big = { ...RELAXED, cheekWidth: 0.78, cheekBulge: 0.3, mouthWidth: 0.45, mouthPucker: 0.6 };
    const puff = [...samples(big, 12), ...samples(RELAXED, 28)];
    const cal = buildPuffCalibration(mainCal, puff, PARAMS)!;
    const q = assessPuffCalibration(cal, puff, { strain: 1 }, PARAMS);
    expect(q.ok).toBe(false);
  });
});

describe("fallbackPuff", () => {
  it("maps a raw score through the fixed range", () => {
    expect(fallbackPuff(0.05, 0.05, 0.45)).toBe(0);
    expect(fallbackPuff(0.25, 0.05, 0.45)).toBeCloseTo(0.5);
    expect(fallbackPuff(0.9, 0.05, 0.45)).toBe(1);
    expect(fallbackPuff(0, 0.05, 0.45)).toBe(0);
  });

  it("survives an empty range", () => {
    expect(fallbackPuff(0.3, 0.3, 0.3)).toBe(1);
    expect(fallbackPuff(0.2, 0.3, 0.3)).toBe(0);
  });

  it("is used by rawPuff when there is no calibration, reading pursed lips (cheekPuff is dead)", () => {
    expect(rawPuff(fv({ mouthPucker: 0.3, cheekPuff: 0.00001 }), null, PARAMS)).toBeCloseTo(0.5);
    expect(rawPuff(fv({ mouthPucker: 0.05, cheekPuff: 0.3 }), null, PARAMS)).toBeCloseTo(0.5);
  });
});

describe("stepPuff", () => {
  const cal = buildPuffCalibration(mainCal, samples(PUFFED, 40), PARAMS)!;

  it("smooths without hysteresis (analog output)", () => {
    const p = { ...PARAMS, emaAlpha: 0.5 };
    const s = stepPuff(initialPuffState(), fv(PUFFED), cal, 1 / 30, p);
    expect(s.smoothed).toBeGreaterThan(0.4);
    expect(s.smoothed).toBeLessThan(0.6);
    expect(s.faceVisible).toBe(true);
  });

  it("holds the value through a short dropout, then drops to 0", () => {
    let s = stepPuff(initialPuffState(), fv(PUFFED), cal, 1 / 30, PARAMS);
    s = stepPuff(s, null, cal, 1 / 30, PARAMS);
    expect(s.smoothed).toBeGreaterThan(0.9);
    for (let i = 0; i < 9; i++) s = stepPuff(s, null, cal, 1 / 30, PARAMS);
    expect(s.smoothed).toBe(0);
    expect(s.faceVisible).toBe(false);
  });
});

describe("stepKeyPuff", () => {
  it("inflates while held and deflates when released, clamped to 0..1", () => {
    expect(stepKeyPuff(0.4, true, 0.5, 1, 0.8)).toBeCloseTo(0.9);
    expect(stepKeyPuff(0.4, false, 0.25, 1, 0.8)).toBeCloseTo(0.2);
    expect(stepKeyPuff(0.95, true, 1, 1, 0.8)).toBe(1);
    expect(stepKeyPuff(0.1, false, 1, 1, 0.8)).toBe(0);
  });

  it("turns a binary hold into a gradual ramp", () => {
    let p = 0;
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      p = stepKeyPuff(p, true, 1 / 120, 1.1, 0.9);
      seen.push(p);
    }
    expect(seen[0]).toBeLessThan(0.02);
    expect(p).toBeCloseTo(0.55, 2);
  });
});
