// Puff scoreboard: fit a puff calibration like the game's first dive (relaxed
// face from the calibration, puff samples from the first full-puff hold), then
// replay the puff segment and check the fish gets the levels it should.

import type { Config } from "../../src/config";
import { PUFF_LABELS } from "../../src/session";
import type { Calibration, FeatureVector } from "../../src/strain";
import type { Recording } from "./load";

export interface PuffVariant {
  name: string;
  calibrate(neutral: FeatureVector[], puff: FeatureVector[], config: Config): Calibration | null;
  /** A fresh detector: feed it every frame (null = no face) with its dt, get the puff level 0..1 back. */
  detector(calibration: Calibration | null, config: Config): (f: FeatureVector | null, dt: number) => number;
}

export interface PuffScore {
  /** Median puff level while relaxed, at half puff and at full puff (ideal: 0, ~0.5, 1). */
  relaxed: number;
  half: number;
  full: number;
  /** Share of frames at or above the spike threshold while relaxed and at half puff (ideal: 0). */
  spikeRelaxed: number;
  spikeHalf: number;
}

const REACTION = 0.6;
const RELAXED = ["neutral", "relax", "puffRelax"];

export function scorePuff(rec: Recording, variant: PuffVariant, config: Config): PuffScore | null {
  const frames = rec.segments.puff;
  const calib = rec.segments.calibration;
  if (!frames?.length || !calib) return null;
  const neutral = calib
    .filter((f) => f.label === "neutral" && f.f && f.since >= config.calibrationSettle && f.since < config.calibrationSeconds)
    .map((f) => f.f!);
  // The game samples the first oceanCalibrationSeconds of the dive, minus the settle time.
  const puff = frames
    .filter((f) => f.label === "fullPuff" && f.f && f.since >= config.calibrationSettle && f.since < config.oceanCalibrationSeconds)
    .map((f) => f.f!);
  if (!neutral.length || !puff.length) return null;
  const detect = variant.detector(variant.calibrate(neutral, puff, config), config);

  const levels: Record<"relaxed" | "half" | "full", number[]> = { relaxed: [], half: [], full: [] };
  let prevT: number | null = null;
  for (const fr of frames) {
    const level = detect(fr.f, prevT === null ? 1 / 30 : Math.max(0, fr.t - prevT));
    prevT = fr.t;
    if (fr.since < REACTION) continue;
    if (RELAXED.includes(fr.label)) levels.relaxed.push(level);
    else if (fr.label === "halfPuff") levels.half.push(level);
    else if (PUFF_LABELS.includes(fr.label)) levels.full.push(level);
  }
  const spikes = (v: number[]) => (v.length ? v.filter((x) => x >= config.oceanSpikeThreshold).length / v.length : NaN);
  return {
    relaxed: median(levels.relaxed), half: median(levels.half), full: median(levels.full),
    spikeRelaxed: spikes(levels.relaxed), spikeHalf: spikes(levels.half),
  };
}

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}
