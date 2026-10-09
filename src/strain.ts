// Face blendshapes → "strain" signal. Pure functions only: no MediaPipe, no
// DOM, no global config, so everything here is unit-testable.
//
// Pipeline per detection frame:
//   blendshape scores → extractFeatures (average L/R pairs)
//   → rawStrain (normalize against the player's calibration, weighted mean)
//   → smoothStrain (time-corrected EMA)
//   → updateTrigger (on/off thresholds plus a relative release → boolean "straining")
//
// The ocean stage's puff signal (puff.ts) reuses the calibration machinery
// here with its own feature subset, PUFF_FEATURES.

/** The features we look at. L/R pairs are averaged into one value. */
export const FEATURE_SOURCES = {
  browDown: ["browDownLeft", "browDownRight"],
  eyeSquint: ["eyeSquintLeft", "eyeSquintRight"],
  eyeBlink: ["eyeBlinkLeft", "eyeBlinkRight"],
  noseSneer: ["noseSneerLeft", "noseSneerRight"],
  cheekSquint: ["cheekSquintLeft", "cheekSquintRight"],
  mouthPress: ["mouthPressLeft", "mouthPressRight"],
  mouthRollLower: ["mouthRollLower"],
  mouthRollUpper: ["mouthRollUpper"],
  mouthShrugUpper: ["mouthShrugUpper"],
  mouthShrugLower: ["mouthShrugLower"],
  // Puff features (ocean stage). MediaPipe's cheekPuff is known to stay ~0
  // (google-ai-edge/mediapipe#4436); it's kept in case a future model fixes it.
  cheekPuff: ["cheekPuff"],
  mouthPucker: ["mouthPucker"],
  mouthFunnel: ["mouthFunnel"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Features measured from the face landmarks rather than blendshapes (see
 * puff.ts faceGeometry), all relative to the eye-corner distance.
 */
export const GEOMETRY_FEATURE_NAMES = ["cheekWidth", "mouthWidth", "eyeMouth"] as const;
export type GeometryFeatureName = (typeof GEOMETRY_FEATURE_NAMES)[number];
type BlendshapeFeatureName = keyof typeof FEATURE_SOURCES;

export type FeatureName = BlendshapeFeatureName | GeometryFeatureName;
export const FEATURE_NAMES = [...Object.keys(FEATURE_SOURCES), ...GEOMETRY_FEATURE_NAMES] as FeatureName[];
export type FeatureVector = Record<FeatureName, number>;

/** Features the strain calibration may weight. Puff features always get strain weight 0. */
export const STRAIN_FEATURES: readonly FeatureName[] = [
  "browDown", "eyeSquint", "eyeBlink", "noseSneer", "cheekSquint", "mouthPress",
  "mouthRollLower", "mouthRollUpper", "mouthShrugUpper", "mouthShrugLower",
];

/**
 * Features the puff calibration may weight: the face geometry, plus mouth
 * shapes that come with puffed cheeks (closed, pressed, pursed lips).
 * It may share mouth features with strain; the puff-only ones never get strain weight.
 */
export const PUFF_FEATURES: readonly FeatureName[] = [
  "cheekWidth", "mouthWidth", "eyeMouth",
  "cheekPuff", "mouthPucker", "mouthFunnel", "mouthPress", "mouthRollLower", "mouthRollUpper",
];

export function zeroFeatures(): FeatureVector {
  const out = {} as FeatureVector;
  for (const f of FEATURE_NAMES) out[f] = 0;
  return out;
}

/**
 * Builds the feature vector from blendshape scores keyed by category name
 * (e.g. `{ browDownLeft: 0.3, ... }`) and optional landmark geometry.
 * Missing blendshapes and geometry count as 0.
 */
export function extractFeatures(
  scores: Readonly<Record<string, number>>,
  geometry?: Readonly<Record<GeometryFeatureName, number>> | null,
): FeatureVector {
  const out = {} as FeatureVector;
  for (const f of Object.keys(FEATURE_SOURCES) as BlendshapeFeatureName[]) {
    const sources = FEATURE_SOURCES[f];
    let sum = 0;
    for (const s of sources) sum += scores[s] ?? 0;
    out[f] = sum / sources.length;
  }
  for (const f of GEOMETRY_FEATURE_NAMES) out[f] = geometry?.[f] ?? 0;
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
  for (const s of samples) for (const f of FEATURE_NAMES) std[f] += (s[f] - mean[f]) ** 2;
  for (const f of FEATURE_NAMES) std[f] = Math.sqrt(std[f] / n);
  return { mean, std, count: n };
}

/**
 * Like featureStats, but the median and a robust spread (MAD × 1.4826, which
 * equals the std for normal noise). A short spike, such as the lips pursing
 * for a moment as the cheeks fill, doesn't move either one, so only what was
 * held through most of the phase counts.
 */
export function robustFeatureStats(samples: readonly FeatureVector[]): FeatureStats {
  const mean = zeroFeatures();
  const std = zeroFeatures();
  const n = samples.length;
  if (n === 0) return { mean, std, count: 0 };
  for (const f of FEATURE_NAMES) {
    const med = median(samples.map((s) => s[f]));
    mean[f] = med;
    std[f] = 1.4826 * median(samples.map((s) => Math.abs(s[f] - med)));
  }
  return { mean, std, count: n };
}

function median(values: number[]): number {
  const v = values.slice().sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface Calibration {
  neutral: FeatureVector;
  /** Mean of the active phase (the strain face), or for a puff calibration the median full puff. */
  strain: FeatureVector;
  /** Non-negative weight per feature; features that didn't move get 0. */
  weights: FeatureVector;
  /**
   * Std of the neutral phase, kept so the puff calibration can reuse the
   * relaxed phase. Missing on calibrations saved before the ocean stage.
   */
  neutralStd?: FeatureVector;
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
export function featureWeight(delta: number, noise: number, minFeatureDelta: number): number {
  const change = Math.abs(delta) - minFeatureDelta;
  if (change <= 0) return 0;
  // Separation in "noise units"; ≥ 2 counts as fully reliable.
  const separation = Math.abs(delta) / (noise + 1e-3);
  const reliability = Math.min(1, separation / 2);
  return change * reliability;
}

/** Noise floor for separationWeight, so a feature that sat perfectly still can't look infinitely clean. */
export const SEPARATION_NOISE_FLOOR = 0.004;

/**
 * Scale-free weight for mixing features with different units (blendshape
 * scores vs. small geometry ratios): only how far the feature moved relative
 * to its own noise counts. 0 below `minSeparation`, 1 from 2 × minSeparation.
 */
export function separationWeight(delta: number, noise: number, minSeparation: number): number {
  const separation = Math.abs(delta) / (noise + SEPARATION_NOISE_FLOOR);
  const min = Math.max(1e-3, minSeparation);
  return clamp((separation - min) / min, 0, 1);
}

/** Weight of one feature from its mean change between phases and its summed noise. */
export type WeightFn = (delta: number, noise: number) => number;

/**
 * Fits a calibration from a neutral and an active phase. Only `features` can
 * get weight; every other feature is ignored by rawStrain. `weigh` defaults
 * to the strain weighting (featureWeight).
 */
export function buildCalibration(
  neutral: Pick<FeatureStats, "mean" | "std">,
  strain: Pick<FeatureStats, "mean" | "std">,
  params: Pick<CalibrationParams, "minFeatureDelta">,
  features: readonly FeatureName[] = STRAIN_FEATURES,
  weigh: WeightFn = (delta, noise) => featureWeight(delta, noise, params.minFeatureDelta),
): Calibration {
  const weights = zeroFeatures();
  for (const f of features) {
    const delta = strain.mean[f] - neutral.mean[f];
    weights[f] = weigh(delta, neutral.std[f] + strain.std[f]);
  }
  return { neutral: { ...neutral.mean }, strain: { ...strain.mean }, weights, neutralStd: { ...neutral.std } };
}

/**
 * Validates a calibration loaded from storage. `required` features must be
 * present; features added since it was saved are filled with 0 (they then
 * have weight 0, so scoring is unchanged). A partial `neutralStd` is dropped.
 */
export function restoreCalibration(data: unknown, required: readonly FeatureName[]): Calibration | null {
  if (typeof data !== "object" || data === null) return null;
  const c = data as Partial<Record<keyof Calibration, unknown>>;
  const vector = (v: unknown, need: readonly FeatureName[]): FeatureVector | null => {
    if (typeof v !== "object" || v === null) return null;
    const src = v as Partial<Record<string, unknown>>;
    if (!need.every((f) => typeof src[f] === "number" && Number.isFinite(src[f]))) return null;
    const out = zeroFeatures();
    for (const f of FEATURE_NAMES) if (typeof src[f] === "number" && Number.isFinite(src[f])) out[f] = src[f];
    return out;
  };
  const neutral = vector(c.neutral, required);
  const strain = vector(c.strain, required);
  const weights = vector(c.weights, required);
  if (!neutral || !strain || !weights) return null;
  const neutralStd = vector(c.neutralStd, FEATURE_NAMES);
  return neutralStd ? { neutral, strain, weights, neutralStd } : { neutral, strain, weights };
}

/** `(x − neutral) / (strain − neutral)`, clamped to [0, clampMax]. Handles features that decrease. */
export function normalizeFeature(x: number, neutral: number, strain: number, clampMax: number): number {
  const range = strain - neutral;
  if (Math.abs(range) < 1e-6) return 0;
  return clamp((x - neutral) / range, 0, clampMax);
}

/** Weighted mean of the normalized features, clamped to 0..1. Unsmoothed. */
export function rawStrain(features: FeatureVector, calib: Calibration, featureClampMax: number): number {
  let sum = 0;
  let weightSum = 0;
  for (const f of FEATURE_NAMES) {
    const w = calib.weights[f];
    if (w <= 0) continue;
    sum += w * normalizeFeature(features[f], calib.neutral[f], calib.strain[f], featureClampMax);
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
  const score = (s: FeatureVector) => rawStrain(s, calib, params.featureClampMax);
  const strainHitRate = fraction(strainSamples, (s) => score(s) >= params.strainOn);
  const neutralFalseRate = fraction(neutralSamples, (s) => score(s) > params.strainOff);
  const base = { totalChange, strainHitRate, neutralFalseRate, topFeatures };

  if (
    neutralSamples.length < minSamples ||
    strainSamples.length < minSamples ||
    coverage.neutral < minCoverage ||
    coverage.strain < minCoverage
  ) {
    return { ...base, ok: false, reason: "I couldn't see your face for long enough. Check the lighting and stay in frame." };
  }
  if (totalChange < params.minCalibrationChange) {
    return { ...base, ok: false, reason: "Your strain face looked almost the same as your relaxed face. Strain harder!" };
  }
  if (strainHitRate < 0.6) {
    return { ...base, ok: false, reason: "Your strain wasn't steady. Hold the strain for the whole countdown." };
  }
  if (neutralFalseRate > 0.25) {
    return { ...base, ok: false, reason: "Your relaxed face was too close to your strain face. Relax completely, then strain harder." };
  }
  return { ...base, ok: true };
}

// --- Smoothing & hysteresis --------------------------------------------------

/**
 * Exponential moving average, corrected for frame time so smoothing feels the
 * same at 15 or 60 detections per second. `alpha` is defined per frame at
 * `refFps` (alpha = 1 → no smoothing).
 */
export function smoothStrain(prev: number, raw: number, alpha: number, dtSeconds: number, refFps = 30): number {
  const a = clamp(alpha, 0, 1);
  const frames = Math.max(0, dtSeconds) * refFps;
  const effective = 1 - Math.pow(1 - a, frames);
  return prev + (raw - prev) * effective;
}

/** Schmitt trigger: turns on at `on`, stays on until below `off`. */
export function updateHysteresis(active: boolean, value: number, on: number, off: number): boolean {
  // Guard against a misconfigured off > on: then both act as one threshold.
  const offT = Math.min(off, on);
  return active ? value >= offT : value >= on;
}

export interface TriggerParams {
  strainOn: number;
  strainOff: number;
  /** Also turn off once the signal falls this far below its peak (0 = off threshold only). */
  strainReleaseDrop: number;
}

/**
 * Hysteresis plus a relative release. While on, the signal also turns off
 * once it falls `strainReleaseDrop` below its peak in this strain, so a
 * release counts as soon as the face starts to relax, even when the relaxed
 * face no longer gets below the off threshold (the relaxed baseline drifts
 * with head pose and lighting during play). To turn on again it must also
 * rise that far above its lowest point since, so the tail of the relax can't
 * retrigger. `extreme` is the peak while on and the low point while off.
 */
export function updateTrigger(
  active: boolean,
  extreme: number,
  value: number,
  p: TriggerParams,
): { active: boolean; extreme: number } {
  if (active) {
    const peak = Math.max(extreme, value);
    return value >= releaseLevel(peak, p) ? { active: true, extreme: peak } : { active: false, extreme: value };
  }
  const low = Math.min(extreme, value);
  const starts = updateHysteresis(false, value, p.strainOn, p.strainOff) && value >= low + Math.max(0, p.strainReleaseDrop);
  return starts ? { active: true, extreme: value } : { active: false, extreme: low };
}

/** The level an active signal with this peak releases below: the off threshold or peak − drop, whichever is higher. */
export function releaseLevel(peak: number, p: TriggerParams): number {
  // Guard against a misconfigured off > on, as in updateHysteresis.
  const off = Math.min(p.strainOff, p.strainOn);
  return p.strainReleaseDrop > 0 ? Math.max(off, peak - p.strainReleaseDrop) : off;
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
  /** Peak smoothed strain while active, the low point since the release while not (see updateTrigger). */
  extreme: number;
  faceVisible: boolean;
  /** Seconds since the face was last seen (0 while visible). */
  missingFor: number;
}

export function initialStrainState(): StrainState {
  return { smoothed: 0, raw: 0, active: false, extreme: 0, faceVisible: false, missingFor: 0 };
}

export interface StrainStepParams extends TriggerParams {
  featureClampMax: number;
  emaAlpha: number;
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
    if (missingFor <= p.faceLossGrace) return { ...state, faceVisible: false, missingFor };
    return { ...initialStrainState(), missingFor };
  }
  const raw = calib ? rawStrain(features, calib, p.featureClampMax) : 0;
  const smoothed = smoothStrain(state.smoothed, raw, p.emaAlpha, dtSeconds);
  const { active, extreme } = updateTrigger(state.active, state.extreme, smoothed, p);
  return { smoothed, raw, active, extreme, faceVisible: true, missingFor: 0 };
}
