// Detection variants the scoreboard compares. The first entry of each list is
// what the game does today; add an idea here and run `npm run eval` to see
// how it changes every participant's numbers.

import { buildPuffCalibration, initialPuffState, stepPuff } from "../../src/puff";
import { buildCalibration, featureStats, initialStrainState, stepStrain } from "../../src/strain";
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
];

export const PUFF_VARIANTS: PuffVariant[] = [
  {
    name: "game",
    calibrate: (neutral, puff, config) => {
      const main = buildCalibration(featureStats(neutral), featureStats(neutral), config);
      return buildPuffCalibration(main, puff, config);
    },
    detector: (calibration, config) => {
      let state = initialPuffState();
      return (f, dt) => (state = stepPuff(state, f, calibration, dt, config)).smoothed;
    },
  },
];
