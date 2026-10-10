import { describe, expect, it } from "vitest";
import {
  FEATURE_NAMES,
  assessCalibration,
  buildCalibration,
  DEFAULT_STRAIN_DELTAS,
  defaultCalibration,
  neutralFaceStats,
  neutralFalseRate,
  extractFeatures,
  featureStats,
  robustFeatureStats,
  featureWeight,
  initialStrainState,
  normalizeFeature,
  rawStrain,
  separationWeight,
  restoreCalibration,
  STRAIN_FEATURES,
  smoothStrain,
  stepStrain,
  strainedness,
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

  it("passes landmark geometry through, and treats missing geometry as 0", () => {
    const f = extractFeatures({}, { cheekWidth: 0.7, mouthWidth: 0.55, eyeMouth: 0.8 });
    expect(f.cheekWidth).toBe(0.7);
    expect(f.mouthWidth).toBe(0.55);
    expect(extractFeatures({}, null).eyeMouth).toBe(0);
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

describe("robustFeatureStats", () => {
  it("uses the median and MAD, so a short spike moves neither", () => {
    const steady = [0.2, 0.21, 0.19, 0.2, 0.22, 0.18, 0.2, 0.2];
    const spiked = [...steady, 0.95, 0.9];
    const s = robustFeatureStats(spiked.map((v) => fv({ mouthPucker: v })));
    expect(s.mean.mouthPucker).toBeCloseTo(0.2, 2);
    expect(s.std.mouthPucker).toBeLessThan(0.03);
    expect(featureStats(spiked.map((v) => fv({ mouthPucker: v }))).std.mouthPucker).toBeGreaterThan(0.2);
    expect(s.count).toBe(10);
  });

  it("matches the std for normally distributed noise and handles empty input", () => {
    const s = robustFeatureStats([0.4, 0.5, 0.6].map((v) => fv({ browDown: v })));
    expect(s.mean.browDown).toBeCloseTo(0.5);
    expect(s.std.browDown).toBeCloseTo(0.14826);
    expect(robustFeatureStats([]).count).toBe(0);
  });
});

describe("separationWeight", () => {
  it("only cares about change relative to noise, not its size", () => {
    expect(separationWeight(0.03, 0.002, 1.5)).toBeCloseTo(separationWeight(0.3, 0.056, 1.5));
  });

  it("is 0 below the minimum separation and 1 from twice it", () => {
    expect(separationWeight(0.01, 0.01, 1.5)).toBe(0);
    expect(separationWeight(0.5, 0.01, 1.5)).toBe(1);
    expect(separationWeight(-0.5, 0.01, 1.5)).toBe(1);
  });

  it("can't be fooled by a feature with zero noise", () => {
    expect(separationWeight(0.001, 0, 1.5)).toBe(0);
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

describe("defaultCalibration", () => {
  const relaxed = { browDown: 0.05, eyeSquint: 0.2, eyeBlink: 0.1, noseSneer: 0.02, cheekSquint: 0.05, mouthPress: 0.1 };
  const calib = defaultCalibration(neutralFaceStats(samples(relaxed, 30)));

  it("scores the player's own relaxed face ~0", () => {
    expect(rawStrain(fv(relaxed), calib, 1.3)).toBeCloseTo(0, 1);
  });

  it("scores the relaxed face plus the typical changes ~1", () => {
    const strained = fv(relaxed);
    for (const [f, d] of Object.entries(DEFAULT_STRAIN_DELTAS)) strained[f as keyof FeatureVector] += d;
    expect(rawStrain(strained, calib, 1.3)).toBeCloseTo(1, 1);
  });

  it("turns on for a strong brow-and-eye strain alone", () => {
    const face = fv({ ...relaxed, browDown: 0.6, eyeSquint: 0.7, eyeBlink: 0.6 });
    expect(rawStrain(face, calib, 1.3)).toBeGreaterThan(PARAMS.strainOn);
  });

  it("only weights the default features", () => {
    expect(calib.weights.mouthRollLower).toBe(0);
    expect(calib.weights.eyeMouth).toBe(0);
  });

  it("gives a feature with no headroom at rest no weight, and less headroom less weight", () => {
    const squinter = defaultCalibration(neutralFaceStats(samples({ ...relaxed, eyeSquint: 0.9, browDown: 0.8 }, 30)));
    expect(squinter.weights.eyeSquint).toBe(0);
    expect(squinter.weights.browDown).toBeGreaterThan(0);
    expect(squinter.weights.browDown).toBeLessThan(calib.weights.browDown);
    expect(squinter.strain.browDown).toBeLessThanOrEqual(1);
  });

  it("scales the typical changes", () => {
    const easy = defaultCalibration(neutralFaceStats(samples(relaxed, 30)), 0.5);
    expect(easy.strain.browDown - easy.neutral.browDown).toBeCloseTo(DEFAULT_STRAIN_DELTAS.browDown! / 2, 2);
  });

  it("gives a feature that jittered at rest less weight", () => {
    const jittery = defaultCalibration(neutralFaceStats(samples({ ...relaxed, browDown: 0.3 }, 30, 0.15)));
    const still = defaultCalibration(neutralFaceStats(samples({ ...relaxed, browDown: 0.3 }, 30)));
    expect(jittery.weights.browDown).toBeLessThan(still.weights.browDown * 0.8);
  });

  it("scores a steady relaxed read as not straining, and a read that moved as straining", () => {
    const steady = samples(relaxed, 30);
    expect(neutralFalseRate(defaultCalibration(neutralFaceStats(steady)), steady, PARAMS)).toBe(0);
    // A third of the read is a full grimace: the median stays relaxed, but the meter would fire.
    const grimace = { browDown: 0.7, eyeSquint: 0.8, eyeBlink: 0.8, noseSneer: 0.5, cheekSquint: 0.5, mouthPress: 0.5 };
    const restless = [...samples(relaxed, 20), ...samples(grimace, 10)];
    expect(neutralFalseRate(defaultCalibration(neutralFaceStats(restless)), restless, PARAMS)).toBeGreaterThan(0.25);
  });

  it("keeps the neutral std for the puff calibration, and ignores a blink in the neutral window", () => {
    const window = samples(relaxed, 30);
    window[10] = fv({ ...relaxed, eyeBlink: 0.95 });
    const stats = neutralFaceStats(window);
    expect(stats.mean.eyeBlink).toBeCloseTo(relaxed.eyeBlink, 1);
    expect(defaultCalibration(stats).neutralStd?.eyeBlink).toBeGreaterThan(0.1);
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

  it("rejects when the face was visible for only part of a phase", () => {
    const neutral = samples({ browDown: 0.05, eyeSquint: 0.1, noseSneer: 0.02 }, 40);
    const strain = samples({ browDown: 0.7, eyeSquint: 0.6, noseSneer: 0.4 }, 40);
    const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);
    const q = assessCalibration(calib, neutral, strain, PARAMS, { neutral: 1, strain: 0.3 });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/couldn't see your face/i);
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
  const p = { featureClampMax: 1.3, emaAlpha: 1, strainOn: 0.45, strainOff: 0.3, faceLossGrace: 0.25 };

  it("activates on a strain face", () => {
    const s = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), calib, 1 / 30, p);
    expect(s.active).toBe(true);
    expect(s.faceVisible).toBe(true);
  });

  it("holds the strain through a short detection dropout", () => {
    const on = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), calib, 1 / 30, p);
    const blip = stepStrain(stepStrain(on, null, calib, 1 / 30, p), null, calib, 1 / 30, p);
    expect(blip.faceVisible).toBe(false);
    expect(blip.active).toBe(true);
    const back = stepStrain(blip, fv({ browDown: 0.8 }), calib, 1 / 30, p);
    expect(back.active).toBe(true);
    expect(back.missingFor).toBe(0);
  });

  it("treats a face missing for longer than the grace period as zero strain", () => {
    let s = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), calib, 1 / 30, p);
    for (let i = 0; i < 9; i++) s = stepStrain(s, null, calib, 1 / 30, p);
    expect(s.faceVisible).toBe(false);
    expect(s.smoothed).toBe(0);
    expect(s.active).toBe(false);
  });

  it("returns zero strain without a calibration", () => {
    const s = stepStrain(initialStrainState(), fv({ browDown: 0.8 }), null, 1 / 30, p);
    expect(s.smoothed).toBe(0);
  });
});

describe("restoreCalibration", () => {
  // Features added after the first saved calibrations.
  const NEW_FEATURES = FEATURE_NAMES.filter((f) => !STRAIN_FEATURES.includes(f));

  const neutral = samples({ browDown: 0.05, eyeSquint: 0.1 }, 20);
  const strain = samples({ browDown: 0.8, eyeSquint: 0.6 }, 20);
  const calib = buildCalibration(featureStats(neutral), featureStats(strain), PARAMS);

  it("round-trips a current calibration, including the neutral std", () => {
    const back = restoreCalibration(JSON.parse(JSON.stringify(calib)), STRAIN_FEATURES);
    expect(back).toEqual(calib);
    expect(back?.neutralStd).toBeDefined();
  });

  it("loads a calibration saved before the puff features existed, scoring strain identically", () => {
    const strip = (v: FeatureVector) => {
      const out: Partial<FeatureVector> = { ...v };
      for (const f of NEW_FEATURES) delete out[f];
      return out;
    };
    const legacy = { neutral: strip(calib.neutral), strain: strip(calib.strain), weights: strip(calib.weights) };
    const back = restoreCalibration(legacy, STRAIN_FEATURES);
    expect(back).not.toBeNull();
    expect(back!.neutralStd).toBeUndefined();
    for (const f of NEW_FEATURES) expect(back!.weights[f]).toBe(0);
    const face = fv({ browDown: 0.5, eyeSquint: 0.4, cheekPuff: 0.9, mouthPucker: 0.7, cheekWidth: 0.8 });
    expect(rawStrain(face, back!, 1.3)).toBeCloseTo(rawStrain(face, calib, 1.3));
  });

  it("rejects missing required features and junk", () => {
    const noBrow: Partial<FeatureVector> = { ...calib.neutral };
    delete noBrow.browDown;
    expect(restoreCalibration({ ...calib, neutral: noBrow }, STRAIN_FEATURES)).toBeNull();
    expect(restoreCalibration(null, STRAIN_FEATURES)).toBeNull();
    expect(restoreCalibration("nope", STRAIN_FEATURES)).toBeNull();
    expect(restoreCalibration({ ...calib, weights: { ...calib.weights, browDown: "x" } }, STRAIN_FEATURES)).toBeNull();
  });
});

describe("strainedness", () => {
  it("ranks a strain face above a relaxed blink, and that above a relaxed face", () => {
    const relaxed = fv({ browDown: 0.25, eyeSquint: 0.3, eyeBlink: 0.15, mouthShrugLower: 0.6 });
    const blink = fv({ ...relaxed, eyeBlink: 1 });
    const strained = fv({ browDown: 0.7, eyeSquint: 0.7, eyeBlink: 0.4 });
    expect(strainedness(relaxed)).toBeCloseTo((0.25 + 0.3 + 0.075) / 2.5);
    expect(strainedness(strained)).toBeGreaterThan(strainedness(blink));
    expect(strainedness(blink)).toBeGreaterThan(strainedness(relaxed));
  });

  it("stays within 0..1 and ignores the mouth", () => {
    expect(strainedness(zeroFeatures())).toBe(0);
    expect(strainedness(fv({ browDown: 1, eyeSquint: 1, eyeBlink: 1 }))).toBe(1);
    expect(strainedness(fv({ browDown: 2, eyeSquint: -1, mouthPress: 1, mouthRollLower: 1 }))).toBeCloseTo(1 / 2.5);
  });
});
