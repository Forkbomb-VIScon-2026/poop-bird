// Puff scoreboard: fit a puff calibration like the game's first dive (relaxed
// face from the calibration, puff samples from the first hold of the gesture),
// then replay the puff segment and check the fish gets the levels it should.
// Two gestures are scored separately: the plain puff, and the "pufferfish
// face" (puffing the cheeks while pursing the lips) that sessions recorded
// since October 10 also have.

import type { Config } from "../../src/config";
import { FISH_PUFF_LABELS, PLAIN_PUFF_LABELS } from "../../src/session";
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
  /** Share of relaxed frames below the hover point, where the fish sinks (ideal: 1). */
  sink: number;
  /** Share of puff frames (half puff aside) above the hover point, where the fish rises (ideal: 1). */
  rise: number;
  /** Share of frames at or above the spike threshold while relaxed and at half puff (ideal: 0). */
  spikeRelaxed: number;
  spikeHalf: number;
}

export type PuffGesture = "plain" | "fish";

const GESTURES: Record<PuffGesture, { hold: string; labels: string[] }> = {
  plain: { hold: "fullPuff", labels: PLAIN_PUFF_LABELS },
  fish: { hold: "fishPuff", labels: FISH_PUFF_LABELS },
};

const REACTION = 0.6;
const RELAXED = ["neutral", "relax", "puffRelax"];

/** null if the recording has no puff segment, or none of this gesture. */
export function scorePuff(rec: Recording, variant: PuffVariant, config: Config, gesture: PuffGesture = "plain"): PuffScore | null {
  const { hold, labels } = GESTURES[gesture];
  // The pufferfish face has its own segment; sessions from October 10 morning have it at the end of the puff segment.
  const frames = gesture === "fish" ? (rec.segments.fish ?? rec.segments.puff) : rec.segments.puff;
  const calib = rec.segments.calibration;
  if (!frames?.length || !calib) return null;
  const neutral = calib
    .filter((f) => f.label === "neutral" && f.f && f.since >= config.calibrationSettle && f.since < config.calibrationSeconds)
    .map((f) => f.f!);
  // The game samples the first oceanCalibrationSeconds of the dive, minus the settle time.
  const puff = frames
    .filter((f) => f.label === hold && f.f && f.since >= config.calibrationSettle && f.since < config.oceanCalibrationSeconds)
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
    else if (fr.label === "halfPuff" && gesture === "plain") levels.half.push(level);
    else if (labels.includes(fr.label)) levels.full.push(level);
  }
  const share = (v: number[], pass: (x: number) => boolean) => (v.length ? v.filter(pass).length / v.length : NaN);
  const spikes = (v: number[]) => share(v, (x) => x >= config.oceanSpikeThreshold);
  return {
    relaxed: median(levels.relaxed), half: median(levels.half), full: median(levels.full),
    sink: share(levels.relaxed, (x) => x < config.oceanHoverPuff),
    rise: share(levels.full, (x) => x > config.oceanHoverPuff),
    spikeRelaxed: spikes(levels.relaxed), spikeHalf: spikes(levels.half),
  };
}

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}
