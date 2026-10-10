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

// Like MediaPipe (shape taken from a recorded puff): cheekPuff stays ~0 even
// when puffing. A held puff shows up in the geometry (small changes) and in
// pressed lips; pursed lips only flicker while the cheeks fill.
const FACE = { cheekWidth: 0.7, mouthWidth: 0.55, eyeMouth: 0.83, cheekPuff: 0.00001 };
const RELAXED = { ...FACE, browDown: 0.05, mouthPucker: 0.03, mouthPress: 0.03 };
const STRAINED = { ...RELAXED, browDown: 0.7, eyeSquint: 0.6 };
const PUFFED = { ...RELAXED, cheekWidth: 0.73, mouthWidth: 0.5, eyeMouth: 0.67, mouthPress: 0.2 };
/** The moment the cheeks fill: lips purse hard and the mouth corners drop. */
const FILLING = { ...RELAXED, eyeMouth: 0.93, mouthWidth: 0.41, mouthPucker: 0.95, mouthRollUpper: 0.5 };

const mainCal = buildCalibration(featureStats(samples(RELAXED, 40)), featureStats(samples(STRAINED, 40)), PARAMS);

describe("faceGeometry", () => {
  /** A crude frontal face: 478 points at the centre, the ones we measure placed explicitly. */
  function face(opts: { contour?: number; mouth?: number; mouthY?: number; scale?: number; dx?: number } = {}): LandmarkPoint[] {
    const { contour = 0.28, mouth = 0.1, mouthY = 0.65, scale = 1, dx = 0 } = opts;
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
    set(61, 0.5 - mouth / 2, mouthY);
    set(291, 0.5 + mouth / 2, mouthY);
    return lm;
  }

  it("measures distances relative to the eye distance", () => {
    const g = faceGeometry(face(), 1)!;
    expect(g.cheekWidth).toBeCloseTo((0.28 + 0.26) / 2 / 0.2 / 2);
    expect(g.mouthWidth).toBeCloseTo(0.5);
    expect(g.eyeMouth).toBeCloseTo(Math.hypot(0.05, 0.25) / 0.2);
  });

  it("doesn't depend on face size or position", () => {
    const a = faceGeometry(face(), 1)!;
    const b = faceGeometry(face({ scale: 1.6, dx: 0.1 }), 1)!;
    expect(b.cheekWidth).toBeCloseTo(a.cheekWidth);
    expect(b.mouthWidth).toBeCloseTo(a.mouthWidth);
    expect(b.eyeMouth).toBeCloseTo(a.eyeMouth);
  });

  it("doesn't depend on head rotation (pitch or yaw)", () => {
    const rotate = (lm: LandmarkPoint[], pitch: number, yaw: number) =>
      lm.map((p) => {
        const [x, y, z] = [p.x - 0.5, p.y - 0.5, p.z];
        const y1 = y * Math.cos(pitch) - z * Math.sin(pitch);
        const z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
        const x2 = x * Math.cos(yaw) + z1 * Math.sin(yaw);
        const z2 = -x * Math.sin(yaw) + z1 * Math.cos(yaw);
        return { x: x2 + 0.5, y: y1 + 0.5, z: z2 };
      });
    const a = faceGeometry(face(), 1)!;
    const b = faceGeometry(rotate(face(), 0.2, -0.3), 1)!;
    expect(b.cheekWidth).toBeCloseTo(a.cheekWidth);
    expect(b.mouthWidth).toBeCloseTo(a.mouthWidth);
    expect(b.eyeMouth).toBeCloseTo(a.eyeMouth);
  });

  it("goes up for wider cheeks and down for a narrower or raised mouth", () => {
    const relaxed = faceGeometry(face(), 1)!;
    const puffed = faceGeometry(face({ contour: 0.3, mouth: 0.09, mouthY: 0.62 }), 1)!;
    expect(puffed.cheekWidth).toBeGreaterThan(relaxed.cheekWidth);
    expect(puffed.mouthWidth).toBeLessThan(relaxed.mouthWidth);
    expect(puffed.eyeMouth).toBeLessThan(relaxed.eyeMouth);
  });

  it("corrects for the video aspect ratio", () => {
    // Same face in a 4:3 video: normalized x is squeezed, aspect undoes it.
    const square = faceGeometry(face(), 1)!;
    const squeezed = face().map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.75, y: p.y, z: p.z * 0.75 }));
    const wide = faceGeometry(squeezed, 4 / 3)!;
    expect(wide.cheekWidth).toBeCloseTo(square.cheekWidth);
    expect(wide.eyeMouth).toBeCloseTo(square.eyeMouth);
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
    expect(cal.weights.mouthWidth).toBeGreaterThan(0);
    expect(cal.weights.eyeMouth).toBeGreaterThan(0);
    expect(cal.weights.mouthPress).toBeGreaterThan(0);
    expect(cal.weights.cheekPuff).toBe(0);
  });

  it("weights by separation, so a small clean geometry change counts as much as a big blendshape change", () => {
    expect(cal.weights.cheekWidth).toBeCloseTo(cal.weights.mouthPress);
  });

  // Regression: with mean stats, the pucker blip as the cheeks filled got
  // weight, so the fish only puffed during the change and sank while held.
  it("ignores the brief pucker as the cheeks fill and keeps a held puff at full", () => {
    const puff = [...samples(FILLING, 6), ...samples(PUFFED, 34)];
    const c = buildPuffCalibration(mainCal, puff, PARAMS)!;
    expect(c.weights.mouthPucker).toBe(0);
    expect(c.weights.mouthRollUpper).toBe(0);
    expect(c.weights.eyeMouth).toBeGreaterThan(0.5);
    expect(c.weights.mouthPress).toBeGreaterThan(0.5);
    expect(rawPuff(fv(PUFFED), c, PARAMS)).toBeGreaterThan(0.9);
    expect(rawPuff(fv(RELAXED), c, PARAMS)).toBeLessThan(0.1);
    expect(assessPuffCalibration(c, puff, { strain: 1 }, PARAMS).ok).toBe(true);
  });

  it("only weights puff candidates", () => {
    for (const f of FEATURE_NAMES) if (!PUFF_FEATURES.includes(f)) expect(cal.weights[f]).toBe(0);
  });

  it("scores relaxed ~0 and full puff ~1, as a continuous value", () => {
    expect(rawPuff(fv(RELAXED), cal, PARAMS)).toBeCloseTo(0, 1);
    expect(rawPuff(fv(PUFFED), cal, PARAMS)).toBeCloseTo(1, 1);
    const half = rawPuff(fv({ ...RELAXED, cheekWidth: 0.715, mouthWidth: 0.525, eyeMouth: 0.75, mouthPress: 0.115 }), cal, PARAMS);
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
    const strainingWithPuff = { ...STRAINED, cheekWidth: 0.75, mouthWidth: 0.45, eyeMouth: 0.7, mouthPucker: 0.4, mouthFunnel: 0.3 };
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
    const puff = samples({ ...RELAXED, cheekWidth: 0.701, mouthPress: 0.032 }, 40);
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
    const big = { ...RELAXED, cheekWidth: 0.78, mouthWidth: 0.45, eyeMouth: 0.6, mouthPress: 0.4 };
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

  it("ignores pressed lips, which some people rest with", () => {
    expect(rawPuff(fv({ mouthPress: 0.9 }), null, PARAMS)).toBe(0);
  });

  it("lifts a calibrated puff to the pursed-lips level", () => {
    const cal = buildPuffCalibration(mainCal, samples(PUFFED, 40), PARAMS)!;
    expect(rawPuff(fv(RELAXED), cal, PARAMS)).toBeCloseTo(0, 1);
    // The calibration hold had no pucker; a pufferfish face still reaches the top.
    expect(rawPuff(fv({ ...RELAXED, mouthPucker: 0.6 }), cal, PARAMS)).toBe(1);
    expect(rawPuff(fv({ ...RELAXED, mouthPucker: 0.3 }), cal, PARAMS)).toBeCloseTo(0.5);
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
