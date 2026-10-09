// Face blendshapes → "strain" signal. Pure functions only: no MediaPipe, no
// DOM, no global config, so everything here is unit-testable.
//
// Pipeline per detection frame:
//   blendshape scores → extractFeatures (average L/R pairs)
//   → rawStrain (normalize against the player's calibration, weighted mean)
//   → smoothStrain (time-corrected EMA)
//   → updateHysteresis (on/off thresholds → boolean "straining")

/** The features we look at. L/R pairs are averaged into one value. */
export const FEATURE_SOURCES = {
  browDownLeft: ["browDownLeft"],
  browDownRight: ["browDownRight"],
  //eyeSquintLeft: ["eyeSquintLeft"],
  //eyeSquintRight: ["eyeSquintRight"],
  // eyeBlink: ["eyeBlinkLeft"],
  // eyeBlinkRight: ["eyeBlinkRight"],
  noseSneer: ["noseSneerLeft"],
  noseSneerRight: ["noseSneerRight"],
  cheekSquint: ["cheekSquintLeft"],
  cheekSquintRight: ["cheekSquintRight"],
  mouthPress: ["mouthPressLeft"],
  mouthPressRight: ["mouthPressRight"],
  mouthRollLower: ["mouthRollLower"],
  mouthRollUpper: ["mouthRollUpper"],
  mouthShrugUpper: ["mouthShrugUpper"],
  mouthShrugLower: ["mouthShrugLower"],
} as const satisfies Record<string, readonly string[]>;

export type FeatureName = keyof typeof FEATURE_SOURCES;
export const FEATURE_NAMES = Object.keys(FEATURE_SOURCES) as FeatureName[];
export type FeatureVector = Record<FeatureName, number>;

export function zeroFeatures(): FeatureVector {
  const out = {} as FeatureVector;
  for (const f of FEATURE_NAMES) out[f] = 0;
  return out;
}

/**
 * Builds the feature vector from blendshape scores keyed by category name
 * (e.g. `{ browDownLeft: 0.3, ... }`). Missing blendshapes count as 0.
 */
export function extractFeatures(
  scores: Readonly<Record<string, number>>,
): FeatureVector {
  const out = {} as FeatureVector;
  for (const f of FEATURE_NAMES) {
    const sources = FEATURE_SOURCES[f];
    let sum = 0;
    for (const s of sources) sum += scores[s] ?? 0;
    out[f] = sum / sources.length;
  }
  return out;
}

// --- Calibration -------------------------------------------------------------

export interface FeatureStats {
  mean: FeatureVector;
  std: FeatureVector;
  count: number;
}

export function featureStats(samples: readonly FeatureVector[]): FeatureStats {
  const mean = zeroFeatures();
  const std = zeroFeatures();
  const n = samples.length;
  if (n === 0) return { mean, std, count: 0 };
  for (const s of samples) for (const f of FEATURE_NAMES) mean[f] += s[f];
  for (const f of FEATURE_NAMES) mean[f] /= n;
  for (const s of samples)
    for (const f of FEATURE_NAMES) std[f] += (s[f] - mean[f]) ** 2;
  for (const f of FEATURE_NAMES) std[f] = Math.sqrt(std[f] / n);
  return { mean, std, count: n };
}

export interface Calibration {
  neutral: FeatureVector;
  strain: FeatureVector;
  /** Non-negative weight per feature; features that didn't move get 0. */
  weights: FeatureVector;
}

export interface CalibrationParams {
  /** Mean change (strain − neutral) below this gets zero weight. */
  minFeatureDelta: number;
  /** Upper clamp for each normalized feature. */
  featureClampMax: number;
}

/**
 * Weight of one feature = how much it moved between the two phases (above a
 * dead zone), scaled down if it is noisy relative to that movement. A feature
 * that moved 0.4 cleanly beats one that moved 0.4 but jitters by ±0.3.
 */
export function featureWeight(
  delta: number,
  noise: number,
  minFeatureDelta: number,
): number {
  const change = Math.abs(delta) - minFeatureDelta;
  if (change <= 0) return 0;
  // Separation in "noise units"; ≥ 2 counts as fully reliable.
  const separation = Math.abs(delta) / (noise + 1e-3);
  const reliability = Math.min(1, separation / 2);
  return change * reliability;
}

export function buildCalibration(
  neutral: FeatureStats,
  strain: FeatureStats,
  params: Pick<CalibrationParams, "minFeatureDelta">,
): Calibration {
  const weights = zeroFeatures();
  for (const f of FEATURE_NAMES) {
    const delta = strain.mean[f] - neutral.mean[f];
    weights[f] = featureWeight(
      delta,
      neutral.std[f] + strain.std[f],
      params.minFeatureDelta,
    );
  }
  return { neutral: { ...neutral.mean }, strain: { ...strain.mean }, weights };
}

/** `(x − neutral) / (strain − neutral)`, clamped to [0, clampMax]. Handles features that decrease. */
export function normalizeFeature(
  x: number,
  neutral: number,
  strain: number,
  clampMax: number,
): number {
  const range = strain - neutral;
  if (Math.abs(range) < 1e-6) return 0;
  return clamp((x - neutral) / range, 0, clampMax);
}

/** Weighted mean of the normalized features, clamped to 0..1. Unsmoothed. */
export function rawStrain(
  features: FeatureVector,
  calib: Calibration,
  featureClampMax: number,
): number {
  let sum = 0;
  let weightSum = 0;
  for (const f of FEATURE_NAMES) {
    const w = calib.weights[f];
    if (w <= 0) continue;
    sum +=
      w *
      normalizeFeature(
        features[f],
        calib.neutral[f],
        calib.strain[f],
        featureClampMax,
      );
    weightSum += w;
  }
  if (weightSum <= 0) return 0;
  return clamp(sum / weightSum, 0, 1);
}

export interface CalibrationQuality {
  ok: boolean;
  /** Sum of feature weights; ~how many "units" of face movement we can see. */
  totalChange: number;
  /** Fraction of strain-phase samples that would turn the signal on. */
  strainHitRate: number;
  /** Fraction of neutral-phase samples that would keep the signal on. */
  neutralFalseRate: number;
  /** The features that carry the most weight, best first. */
  topFeatures: FeatureName[];
  /** Human-readable reason when not ok. */
  reason?: string;
}

export interface QualityParams extends CalibrationParams {
  minCalibrationChange: number;
  strainOn: number;
  strainOff: number;
  minSamples?: number;
  /** Minimum fraction of detection frames in each phase that must contain a face. */
  minFaceCoverage?: number;
}

/** Fraction of detection frames (0..1) in each phase that had a face. */
export interface PhaseCoverage {
  neutral: number;
  strain: number;
}

/**
 * Checks whether calibration separates the two phases well enough to play.
 * Scores every calibration sample with the resulting calibration and checks
 * how often the on/off thresholds would have fired correctly.
 */
export function assessCalibration(
  calib: Calibration,
  neutralSamples: readonly FeatureVector[],
  strainSamples: readonly FeatureVector[],
  params: QualityParams,
  coverage: PhaseCoverage = { neutral: 1, strain: 1 },
): CalibrationQuality {
  const minSamples = params.minSamples ?? 8;
  const minCoverage = params.minFaceCoverage ?? 0.6;
  const totalChange = FEATURE_NAMES.reduce((s, f) => s + calib.weights[f], 0);
  const topFeatures = FEATURE_NAMES.filter((f) => calib.weights[f] > 0)
    .sort((a, b) => calib.weights[b] - calib.weights[a])
    .slice(0, 3);
  const score = (s: FeatureVector) =>
    rawStrain(s, calib, params.featureClampMax);
  const strainHitRate = fraction(
    strainSamples,
    (s) => score(s) >= params.strainOn,
  );
  const neutralFalseRate = fraction(
    neutralSamples,
    (s) => score(s) > params.strainOff,
  );
  const base = { totalChange, strainHitRate, neutralFalseRate, topFeatures };

  if (
    neutralSamples.length < minSamples ||
    strainSamples.length < minSamples ||
    coverage.neutral < minCoverage ||
    coverage.strain < minCoverage
  ) {
    return {
      ...base,
      ok: false,
      reason:
        "I couldn't see your face for long enough. Check the lighting and stay in frame.",
    };
  }
  if (totalChange < params.minCalibrationChange) {
    return {
      ...base,
      ok: false,
      reason:
        "Your strain face looked almost the same as your relaxed face. Strain harder!",
    };
  }
  if (strainHitRate < 0.6) {
    return {
      ...base,
      ok: false,
      reason:
        "Your strain wasn't steady. Hold the strain for the whole countdown.",
    };
  }
  if (neutralFalseRate > 0.25) {
    return {
      ...base,
      ok: false,
      reason:
        "Your relaxed face was too close to your strain face. Relax completely, then strain harder.",
    };
  }
  return { ...base, ok: true };
}

// --- Smoothing & hysteresis --------------------------------------------------

/**
 * Exponential moving average, corrected for frame time so smoothing feels the
 * same at 15 or 60 detections per second. `alpha` is defined per frame at
 * `refFps` (alpha = 1 → no smoothing).
 */
export function smoothStrain(
  prev: number,
  raw: number,
  alpha: number,
  dtSeconds: number,
  refFps = 30,
): number {
  const a = clamp(alpha, 0, 1);
  const frames = Math.max(0, dtSeconds) * refFps;
  const effective = 1 - Math.pow(1 - a, frames);
  return prev + (raw - prev) * effective;
}

/** Schmitt trigger: turns on at `on`, stays on until below `off`. */
export function updateHysteresis(
  active: boolean,
  value: number,
  on: number,
  off: number,
): boolean {
  // Guard against a misconfigured off > on: then both act as one threshold.
  const offT = Math.min(off, on);
  return active ? value >= offT : value >= on;
}

// --- helpers -----------------------------------------------------------------

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function fraction<T>(items: readonly T[], pred: (t: T) => boolean): number {
  if (items.length === 0) return 0;
  let n = 0;
  for (const it of items) if (pred(it)) n++;
  return n / items.length;
}

/** Keeps the per-frame strain state for one player. Thin stateful wrapper around the pure functions. */
export interface StrainState {
  smoothed: number;
  raw: number;
  active: boolean;
  faceVisible: boolean;
  /** Seconds since the face was last seen (0 while visible). */
  missingFor: number;
}

export function initialStrainState(): StrainState {
  return {
    smoothed: 0,
    raw: 0,
    active: false,
    faceVisible: false,
    missingFor: 0,
  };
}

export interface StrainStepParams {
  featureClampMax: number;
  emaAlpha: number;
  strainOn: number;
  strainOff: number;
  /** Seconds a lost face keeps its last strain state before dropping to 0. */
  faceLossGrace: number;
}

/**
 * One detection frame. `features === null` means no face in this frame.
 *
 * Short dropouts (MediaPipe often misses a frame or two, especially on an
 * extreme grimace) hold the previous state so they don't cause an involuntary
 * release. Once the face has been gone longer than `faceLossGrace`, strain
 * drops straight to 0, so a player leaving the frame releases and can't
 * trigger an accident.
 */
export function stepStrain(
  state: StrainState,
  features: FeatureVector | null,
  calib: Calibration | null,
  dtSeconds: number,
  p: StrainStepParams,
): StrainState {
  if (features === null) {
    const missingFor = state.missingFor + Math.max(0, dtSeconds);
    if (missingFor <= p.faceLossGrace)
      return { ...state, faceVisible: false, missingFor };
    return {
      smoothed: 0,
      raw: 0,
      active: false,
      faceVisible: false,
      missingFor,
    };
  }
  const raw = calib ? rawStrain(features, calib, p.featureClampMax) : 0;
  const smoothed = smoothStrain(state.smoothed, raw, p.emaAlpha, dtSeconds);
  const active = updateHysteresis(
    state.active,
    smoothed,
    p.strainOn,
    p.strainOff,
  );
  return { smoothed, raw, active, faceVisible: true, missingFor: 0 };
}
