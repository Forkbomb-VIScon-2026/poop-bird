import { describe, expect, it } from "vitest";
import {
  FEATURE_NAMES,
  assessCalibration,
  buildCalibration,
  extractFeatures,
  featureStats,
  featureWeight,
  initialStrainState,
  normalizeFeature,
  rawStrain,
  smoothStrain,
  stepStrain,
  updateHysteresis,
  zeroFeatures,
  type Calibration,
  type FeatureVector,
} from "./strain";

const PARAMS = {
  minFeatureDelta: 0.04,
  featureClampMax: 1.3,
  minCalibrationChange: 0.25,
  strainOn: 0.45,
  strainOff: 0.3,
};

function fv(values: Partial<FeatureVector>): FeatureVector {
  return { ...zeroFeatures(), ...values };
}

/** Deterministic pseudo-noise so tests are stable. */
function jitter(i: number, amp: number): number {
  return Math.sin(i * 12.9898) * amp;
}

function samples(base: Partial<FeatureVector>, n: number, noise = 0.01): FeatureVector[] {
  return Array.from({ length: n }, (_, i) => {
    const v = fv(base);
    for (const f of FEATURE_NAMES) v[f] = Math.max(0, v[f] + jitter(i + f.length, noise));
    return v;
  });
}

describe("extractFeatures", () => {
  it("averages left/right pairs and passes single features through", () => {
    const f = extractFeatures({ browDownLeft: 0.2, browDownRight: 0.6, mouthRollLower: 0.5 });
    expect(f.browDown).toBeCloseTo(0.4);
    expect(f.mouthRollLower).toBeCloseTo(0.5);
  });

  it("treats missing blendshapes as 0", () => {
    const f = extractFeatures({});
    for (const name of FEATURE_NAMES) expect(f[name]).toBe(0);
  });
});

describe("normalizeFeature", () => {
  it("maps neutral to 0 and strain to 1", () => {
    expect(normalizeFeature(0.1, 0.1, 0.5, 1.3)).toBe(0);
    expect(normalizeFeature(0.5, 0.1, 0.5, 1.3)).toBeCloseTo(1);
    expect(normalizeFeature(0.3, 0.1, 0.5, 1.3)).toBeCloseTo(0.5);
  });

  it("clamps below neutral and above clampMax", () => {
    expect(normalizeFeature(0.0, 0.1, 0.5, 1.3)).toBe(0);
    expect(normalizeFeature(2.0, 0.1, 0.5, 1.3)).toBe(1.3);
  });

  it("handles features that decrease when straining", () => {
    expect(normalizeFeature(0.2, 0.6, 0.2, 1.3)).toBeCloseTo(1);
    expect(normalizeFeature(0.4, 0.6, 0.2, 1.3)).toBeCloseTo(0.5);
  });

  it("returns 0 when calibration has no range", () => {
    expect(normalizeFeature(0.9, 0.3, 0.3, 1.3)).toBe(0);
  });
});

describe("featureWeight", () => {
  it("is zero for changes inside the dead zone", () => {
    expect(featureWeight(0.03, 0.0, 0.04)).toBe(0);
    expect(featureWeight(-0.03, 0.0, 0.04)).toBe(0);
  });

  it("grows with the change", () => {
    expect(featureWeight(0.5, 0.01, 0.04)).toBeGreaterThan(featureWeight(0.2, 0.01, 0.04));
  });

  it("penalizes noisy features", () => {
    expect(featureWeight(0.3, 0.3, 0.04)).toBeLessThan(featureWeight(0.3, 0.01, 0.04));
  });
});

describe("calibration weighting", () => {
  const neutral = samples({ browDown: 0.05, eyeSquint: 0.1, mouthPress: 0.1, eyeBlink: 0.1 }, 40);
  const strain = samples({ browDown: 0.7, eyeSquint: 0.6, mouthPress: 0.1, eyeBlink: 0.11 }, 40);
  const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);

  it("gives features that didn't move ~zero weight", () => {
    expect(calib.weights.mouthPress).toBe(0);
    expect(calib.weights.eyeBlink).toBe(0);
    expect(calib.weights.noseSneer).toBe(0);
  });

  it("gives features that moved most the most weight", () => {
    expect(calib.weights.browDown).toBeGreaterThan(calib.weights.eyeSquint);
    expect(calib.weights.eyeSquint).toBeGreaterThan(0);
  });

  it("scores the neutral face ~0 and the strain face ~1", () => {
    expect(rawStrain(fv({ browDown: 0.05, eyeSquint: 0.1 }), calib, 1.3)).toBeCloseTo(0, 1);
    expect(rawStrain(fv({ browDown: 0.7, eyeSquint: 0.6 }), calib, 1.3)).toBeCloseTo(1, 1);
  });

  it("ignores unweighted features entirely", () => {
    const a = rawStrain(fv({ browDown: 0.4, eyeSquint: 0.3 }), calib, 1.3);
    const b = rawStrain(fv({ browDown: 0.4, eyeSquint: 0.3, mouthPress: 1, noseSneer: 1 }), calib, 1.3);
    expect(a).toBeCloseTo(b);
  });

  it("clamps the result to 0..1 even with feature overshoot", () => {
    expect(rawStrain(fv({ browDown: 1, eyeSquint: 1 }), calib, 1.3)).toBe(1);
  });

  it("returns 0 when no feature has weight", () => {
    const flat: Calibration = { neutral: zeroFeatures(), strain: zeroFeatures(), weights: zeroFeatures() };
    expect(rawStrain(fv({ browDown: 1 }), flat, 1.3)).toBe(0);
  });
});

describe("assessCalibration", () => {
  it("accepts a clearly separated calibration", () => {
    const neutral = samples({ browDown: 0.05, eyeSquint: 0.1, noseSneer: 0.02 }, 40);
    const strain = samples({ browDown: 0.7, eyeSquint: 0.6, noseSneer: 0.4 }, 40);
    const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);
    const q = assessCalibration(calib, neutral, strain, PARAMS);
    expect(q.ok).toBe(true);
    expect(q.strainHitRate).toBeGreaterThan(0.9);
    expect(q.neutralFalseRate).toBeLessThan(0.1);
    expect(q.topFeatures[0]).toBe("browDown");
  });

  it("rejects a calibration where the faces barely differ", () => {
    const neutral = samples({ browDown: 0.1, eyeSquint: 0.1 }, 40);
    const strain = samples({ browDown: 0.16, eyeSquint: 0.13 }, 40);
    const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);
    const q = assessCalibration(calib, neutral, strain, PARAMS);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/strain harder/i);
  });

  it("rejects when too few samples were captured (no face)", () => {
    const neutral = samples({ browDown: 0.05 }, 3);
    const strain = samples({ browDown: 0.8 }, 3);
    const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);
    expect(assessCalibration(calib, neutral, strain, PARAMS).ok).toBe(false);
  });

  it("rejects an unsteady strain (only held for part of the phase)", () => {
    const neutral = samples({ browDown: 0.05, eyeSquint: 0.05 }, 40);
    const strain = [
      ...samples({ browDown: 0.9, eyeSquint: 0.9 }, 12),
      ...samples({ browDown: 0.08, eyeSquint: 0.08 }, 28),
    ];
    const calib = buildCalibration(featureStats(neutral), featureStats(strain), { minFeatureDelta: 0.04 });
    const q = assessCalibration(calib, neutral, strain, PARAMS);
    expect(q.ok).toBe(false);
  });
});

describe("smoothStrain", () => {
  it("moves toward the target by alpha per reference frame", () => {
    expect(smoothStrain(0, 1, 0.5, 1 / 30)).toBeCloseTo(0.5);
  });

  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 2; i++) a = smoothStrain(a, 1, 0.5, 1 / 60);
    expect(a).toBeCloseTo(smoothStrain(0, 1, 0.5, 1 / 30));
  });

  it("alpha = 1 means no smoothing", () => {
    expect(smoothStrain(0.2, 0.9, 1, 1 / 30)).toBeCloseTo(0.9);
  });
});

describe("updateHysteresis", () => {
  const on = 0.45;
  const off = 0.3;

  it("turns on only at the on threshold", () => {
    expect(updateHysteresis(false, 0.44, on, off)).toBe(false);
    expect(updateHysteresis(false, 0.45, on, off)).toBe(true);
  });

  it("stays on between the thresholds and turns off below off", () => {
    expect(updateHysteresis(true, 0.35, on, off)).toBe(true);
    expect(updateHysteresis(true, 0.29, on, off)).toBe(false);
  });

  it("does not flicker on a noisy signal hovering around the on threshold", () => {
    const signal = [0.44, 0.46, 0.43, 0.47, 0.42, 0.46, 0.44, 0.45];
    let active = false;
    let toggles = 0;
    for (const v of signal) {
      const next = updateHysteresis(active, v, on, off);
      if (next !== active) toggles++;
      active = next;
    }
    expect(toggles).toBe(1);
  });

  it("survives misconfigured thresholds (off > on)", () => {
    expect(updateHysteresis(true, 0.5, 0.4, 0.6)).toBe(true);
    expect(updateHysteresis(true, 0.39, 0.4, 0.6)).toBe(false);
  });
});

describe("stepStrain", () => {
  const neutral = samples({ browDown: 0.05 }, 20);
  const strain = samples({ browDown: 0.8 }, 20);
  const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);
  const p = { featureClampMax: 1.3, emaAlpha: 1, strainOn: 0.45, strainOff: 0.3 };

  it("activates on a strain face", () => {
    const s = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), calib, 1 / 30, p);
    expect(s.active).toBe(true);
    expect(s.faceVisible).toBe(true);
  });

  it("treats a missing face as zero strain", () => {
    const on = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), calib, 1 / 30, p);
    const lost = stepStrain(on, null, calib, 1 / 30, p);
    expect(lost.faceVisible).toBe(false);
    expect(lost.smoothed).toBe(0);
    expect(lost.active).toBe(false);
  });

  it("returns zero strain without a calibration", () => {
    const s = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), null, 1 / 30, p);
    expect(s.smoothed).toBe(0);
  });
});
