// Detection variants the scoreboard compares. The first entry of each list is
// what the game does today; add an idea here and run `npm run eval` to see
// how it changes every participant's numbers.

import type { Config } from "../../src/config";
import { assessPuffCalibration, buildPuffCalibration, fallbackPuff, initialPuffState, stepPuff } from "../../src/puff";
import {
  PUFF_FEATURES,
  buildCalibration,
  defaultCalibration,
  featureStats,
  initialStrainState,
  neutralFaceStats,
  rawStrain,
  robustFeatureStats,
  separationWeight,
  smoothStrain,
  stepStrain,
  type Calibration,
  type FeatureStats,
  type FeatureVector,
} from "../../src/strain";
import type { PuffVariant } from "./puff";
import type { StrainVariant } from "./strain";

function strainDetector(): StrainVariant["detector"] {
  return (calibration, config) => {
    let state = initialStrainState();
    return (f, dt) => (state = stepStrain(state, f, calibration, dt, config)).active;
  };
}

export const STRAIN_VARIANTS: StrainVariant[] = [
  {
    name: "game",
    calibrate: (c, config) => buildCalibration(featureStats(c.neutral), featureStats(c.strain), config),
    detector: strainDetector(),
  },
  {
    // Example idea: also learn the relaxed face from after the strain.
    name: "relaxed before + after",
    calibrate: (c, config) => buildCalibration(featureStats([...c.neutral, ...c.relaxAgain]), featureStats(c.strain), config),
    detector: strainDetector(),
  },
  {
    // What players who skip the calibration get, fitted to the calibration's relaxed phase.
    name: "default calibration (skipped calibration)",
    calibrate: (c, config) => defaultCalibration(neutralFaceStats(c.neutral), config.defaultStrainScale),
    detector: strainDetector(),
  },
  {
    // noseSneer and cheekSquint never move in the dataset (MediaPipe reports ~0), and
    // mouthPress drops for some people. These are the median and lower-quartile changes
    // of the features that moved the same way for everyone.
    name: "default calibration, deltas from the dataset",
    calibrate: (c, config) =>
      defaultCalibration(neutralFaceStats(c.neutral), config.defaultStrainScale, {
        browDown: 0.35, eyeSquint: 0.3, eyeBlink: 0.15, mouthShrugLower: 0.1,
      }),
    detector: strainDetector(),
  },
];

/** Like the game: a calibration that fails the quality check isn't used. */
function checked(cal: Calibration | null, puff: FeatureVector[], config: Config): Calibration | null {
  return cal && assessPuffCalibration(cal, puff, { strain: 1 }, config).ok ? cal : null;
}

/** The game's puff calibration: the calibration's relaxed face vs. the first hold. */
function gamePuffCalibration(neutral: FeatureVector[], puff: FeatureVector[], config: Config): Calibration | null {
  const main = buildCalibration(featureStats(neutral), featureStats(neutral), config);
  return checked(buildPuffCalibration(main, puff, config), puff, config);
}

/** The puff calibration fitted against another relaxed face. */
function puffCalibrationFrom(neutral: Pick<FeatureStats, "mean" | "std">, puff: FeatureVector[], config: Config): Calibration | null {
  const cal = buildCalibration(neutral, robustFeatureStats(puff), { minFeatureDelta: 0 }, PUFF_FEATURES, (delta, noise) =>
    separationWeight(delta, noise, config.oceanPuffMinSeparation),
  );
  return checked(cal, puff, config);
}

const puffDetector: PuffVariant["detector"] = (calibration, config) => {
  let state = initialPuffState();
  return (f, dt) => (state = stepPuff(state, f, calibration, dt, config)).smoothed;
};

/**
 * The puff before the pufferfish face: the calibration alone, and without one
 * max(mouthPress, cheekPuff) mapped from 0.06 to 0.22.
 */
const previousPuffDetector: PuffVariant["detector"] = (calibration, config) => {
  let smoothed = 0;
  let missing = 0;
  return (f, dt) => {
    if (!f) {
      missing += dt;
      if (missing > config.faceLossGrace) smoothed = 0;
      return smoothed;
    }
    missing = 0;
    const raw = calibration
      ? rawStrain(f, calibration, config.featureClampMax)
      : fallbackPuff(Math.max(f.cheekPuff, f.mouthPress), 0.06, 0.22);
    smoothed = smoothStrain(smoothed, raw, config.emaAlpha, dt);
    return smoothed;
  };
};

export const PUFF_VARIANTS: PuffVariant[] = [
  {
    name: "game",
    calibrate: (c, config) => gamePuffCalibration(c.neutral, c.puff, config),
    detector: puffDetector,
  },
  {
    name: "previous game: calibration alone, mouthPress fallback",
    calibrate: (c, config) => gamePuffCalibration(c.neutral, c.puff, config),
    detector: previousPuffDetector,
  },
  {
    // Great on some faces, but people who purse their lips less never get far up.
    name: "no calibration: the pucker range alone",
    calibrate: () => null,
    detector: puffDetector,
  },
  {
    // The relaxed face drifts between the calibration and the dive; a short read right
    // before the puff fixes that for most, but its noise estimate is too small.
    name: "fresh relaxed read before the puff",
    calibrate: (c, config) => puffCalibrationFrom(neutralFaceStats(c.fresh), c.puff, config),
    detector: puffDetector,
  },
];
