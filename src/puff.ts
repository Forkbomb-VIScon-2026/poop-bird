// Face (or Space) → "puff" signal for the ocean stage. Pure functions only,
// like strain.ts, whose calibration machinery this reuses: a second
// Calibration is fitted from the main calibration's relaxed phase (neutral)
// vs. a full-puff phase, restricted to PUFF_FEATURES.
//
// MediaPipe's cheekPuff blendshape stays ~0 (google-ai-edge/mediapipe#4436),
// so puff is mostly read from landmark geometry (faceGeometry: cheek width,
// cheek bulge, mouth width) plus mouth blendshapes. Their units differ, so
// the puff calibration weights by separation (signal / noise), not raw change.
//
// Unlike strain there is no hysteresis: the fish needs the analog value.
//   features → rawPuff (weighted, normalized; or the fallback range)
//   → stepPuff (time-corrected EMA, face-loss grace)
//   → max(face puff, key puff) → Game.puffInput

import {
  PUFF_FEATURES,
  buildCalibration,
  clamp,
  featureStats,
  rawStrain,
  separationWeight,
  smoothStrain,
  type Calibration,
  type FeatureVector,
  type GeometryFeatureName,
  type PhaseCoverage,
} from "./strain";

// --- Landmark geometry ---------------------------------------------------------

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe Face Mesh indices used for the puff geometry. */
export const PUFF_LANDMARKS = {
  /** Outer eye corners: the scale reference (barely moves with expression). */
  eyeOuter: [33, 263],
  /** Face-contour pairs at mouth level, where puffed cheeks widen the face. */
  cheekContour: [[132, 361], [58, 288]],
  /** Points on the cheek surface, which move toward the camera when puffed. */
  cheekSurface: [50, 280, 205, 425],
  mouthCorners: [61, 291],
} as const;

/**
 * Cheek and mouth shape from the 478 normalized landmarks (x by image width,
 * y by image height, z roughly on the x scale). `aspect` = video width /
 * height makes the space isotropic. Everything is divided by the eye-corner
 * distance, so it doesn't depend on face size or distance to the camera.
 *
 * - cheekWidth: face width at mouth level / eye distance / 2 (≈0.7)
 * - cheekBulge: how far the cheek surface sits in front of the eye corners
 * - mouthWidth: mouth-corner distance / eye distance (≈0.55; pursing narrows it)
 */
export function faceGeometry(
  lm: readonly LandmarkPoint[],
  aspect: number,
): Record<GeometryFeatureName, number> | null {
  if (lm.length < 468 || !(aspect > 0)) return null;
  const P = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y, z: lm[i].z * aspect });
  const dist = (a: number, b: number) => {
    const p = P(a);
    const q = P(b);
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };
  const [eyeR, eyeL] = PUFF_LANDMARKS.eyeOuter;
  const eye = dist(eyeR, eyeL);
  if (!(eye > 1e-4)) return null;
  const widths = PUFF_LANDMARKS.cheekContour.map(([a, b]) => dist(a, b));
  const cheekWidth = widths.reduce((s, w) => s + w, 0) / widths.length / eye / 2;
  const zRef = (P(eyeR).z + P(eyeL).z) / 2;
  const zCheek = PUFF_LANDMARKS.cheekSurface.reduce((s, i) => s + P(i).z, 0) / PUFF_LANDMARKS.cheekSurface.length;
  // Smaller z = closer to the camera, so a cheek pushed forward raises this.
  const cheekBulge = (zRef - zCheek) / eye;
  const mouthWidth = dist(PUFF_LANDMARKS.mouthCorners[0], PUFF_LANDMARKS.mouthCorners[1]) / eye;
  return { cheekWidth, cheekBulge, mouthWidth };
}

// --- Calibration ------------------------------------------------------------------

/**
 * Builds the puff calibration from the main calibration's neutral stats and
 * the full-puff samples. Returns null if the main calibration has no neutral
 * std for every feature (saved before these features existed).
 */
export function buildPuffCalibration(
  main: Calibration,
  puffSamples: readonly FeatureVector[],
  params: { oceanPuffMinSeparation: number },
): Calibration | null {
  if (!main.neutralStd) return null;
  return buildCalibration(
    { mean: main.neutral, std: main.neutralStd },
    featureStats(puffSamples),
    { minFeatureDelta: 0 },
    PUFF_FEATURES,
    (delta, noise) => separationWeight(delta, noise, params.oceanPuffMinSeparation),
  );
}

export interface PuffQualityParams {
  featureClampMax: number;
  oceanHoverPuff: number;
  oceanMinPuffChange: number;
  minFaceCoverage?: number;
  minSamples?: number;
  /** Fraction of puff samples that must score at or above the hover point. */
  minHitRate?: number;
}

export interface PuffQuality {
  ok: boolean;
  /** Sum of the puff feature weights (each 0..1, so ~"how many features clearly moved"). */
  totalChange: number;
  /** Fraction of puff-phase samples scoring at or above the hover point. */
  hitRate: number;
  reason?: string;
}

/** Checks that the puff phase was visible, clearly different from neutral, and steady. */
export function assessPuffCalibration(
  calib: Calibration,
  puffSamples: readonly FeatureVector[],
  coverage: Pick<PhaseCoverage, "strain">,
  p: PuffQualityParams,
): PuffQuality {
  const minSamples = p.minSamples ?? 8;
  const minCoverage = p.minFaceCoverage ?? 0.6;
  const minHitRate = p.minHitRate ?? 0.6;
  const totalChange = PUFF_FEATURES.reduce((s, f) => s + calib.weights[f], 0);
  let hits = 0;
  for (const s of puffSamples) if (rawStrain(s, calib, p.featureClampMax) >= p.oceanHoverPuff) hits++;
  const hitRate = puffSamples.length ? hits / puffSamples.length : 0;
  const base = { totalChange, hitRate };
  if (puffSamples.length < minSamples || coverage.strain < minCoverage) {
    return { ...base, ok: false, reason: "couldn't see your face" };
  }
  if (totalChange < p.oceanMinPuffChange) return { ...base, ok: false, reason: "puff looked like your relaxed face" };
  if (hitRate < minHitRate) return { ...base, ok: false, reason: "puff wasn't held steadily" };
  return { ...base, ok: true };
}

/** A raw blendshape score mapped linearly through a fixed range, for when there's no puff calibration. */
export function fallbackPuff(score: number, min: number, max: number): number {
  if (max - min < 1e-6) return score >= max ? 1 : 0;
  return clamp((score - min) / (max - min), 0, 1);
}

/**
 * The fallback's input: pursed lips (mouthPucker), which MediaPipe tracks,
 * or cheekPuff should a future model make it work. Geometry isn't used here
 * because its neutral values differ from face to face.
 */
export function fallbackPuffScore(features: FeatureVector): number {
  return Math.max(features.cheekPuff, features.mouthPucker);
}

export interface RawPuffParams {
  featureClampMax: number;
  oceanFallbackMin: number;
  oceanFallbackMax: number;
}

/** Unsmoothed puff 0..1: the weighted puff calibration if there is one, else the fallback range. */
export function rawPuff(features: FeatureVector, calib: Calibration | null, p: RawPuffParams): number {
  if (calib) return rawStrain(features, calib, p.featureClampMax);
  return fallbackPuff(fallbackPuffScore(features), p.oceanFallbackMin, p.oceanFallbackMax);
}

export interface PuffState {
  raw: number;
  smoothed: number;
  faceVisible: boolean;
  /** Seconds since the face was last seen (0 while visible). */
  missingFor: number;
}

export function initialPuffState(): PuffState {
  return { raw: 0, smoothed: 0, faceVisible: false, missingFor: 0 };
}

export interface PuffStepParams extends RawPuffParams {
  emaAlpha: number;
  faceLossGrace: number;
}

/**
 * One detection frame. `features === null` means no face. Short dropouts keep
 * the last value; after `faceLossGrace` the puff drops to 0, so the fish sinks.
 */
export function stepPuff(
  state: PuffState,
  features: FeatureVector | null,
  calib: Calibration | null,
  dtSeconds: number,
  p: PuffStepParams,
): PuffState {
  if (features === null) {
    const missingFor = state.missingFor + Math.max(0, dtSeconds);
    if (missingFor <= p.faceLossGrace) return { ...state, faceVisible: false, missingFor };
    return { raw: 0, smoothed: 0, faceVisible: false, missingFor };
  }
  const raw = rawPuff(features, calib, p);
  const smoothed = smoothStrain(state.smoothed, raw, p.emaAlpha, dtSeconds);
  return { raw, smoothed, faceVisible: true, missingFor: 0 };
}

/**
 * Turns a held/not-held input (Space, mouse, touch) into an analog puff:
 * inflates toward 1 while held, deflates toward 0 otherwise. Rates are puff/s.
 */
export function stepKeyPuff(puff: number, held: boolean, dt: number, inflateRate: number, deflateRate: number): number {
  const next = held ? puff + Math.max(0, inflateRate) * dt : puff - Math.max(0, deflateRate) * dt;
  return clamp(next, 0, 1);
}
