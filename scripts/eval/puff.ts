// Puff scoreboard: fit a puff calibration like the game's first dive, then
// replay the rest of the puff script and check the fish gets the levels it
// should. The game's calibration is interactive (relax, then two puff/relax
// cycles), so each script's first two hold → relax cycles are the calibration
// and only what comes after them is scored, for every variant alike.
// Two gestures are scored separately: the plain puff, and the "pufferfish
// face" (puffing the cheeks while pursing the lips) that sessions recorded
// since October 10 also have.

import type { Config } from "../../src/config";
import { FISH_PUFF_LABELS, PLAIN_PUFF_LABELS } from "../../src/session";
import type { RestingFace } from "../../src/puff";
import { buildCalibration, featureStats, type Calibration, type FeatureVector } from "../../src/strain";
import type { Frame, Recording } from "./load";

/** A puff hold and the relax step right after it, cut like the game's calibration steps. */
export interface PuffCycle {
  puff: FeatureVector[];
  relax: FeatureVector[];
}

/** What a puff calibration can be fitted from. */
export interface PuffCalibrationInput {
  /** The relaxed phase of the game's main calibration, recorded before the strain script. */
  neutral: FeatureVector[];
  /** The relaxed step right before the first hold, cut like the calibration's first relax step. */
  fresh: FeatureVector[];
  /**
   * Looking around with a relaxed face, cut like the calibration's look-around
   * step: the start of the strain script's first "look" step ([] without a
   * strain script). Those frames aren't scored.
   */
  look: FeatureVector[];
  /** The first two hold → relax cycles (the plain puff's half puff skipped). */
  cycles: PuffCycle[];
  /**
   * The next two cycles, what the game's second try would see when the first
   * fails its quality check ([] if the script runs out). They overlap the
   * scored part, so a variant that uses them is scored partly on its own data.
   */
  retry: PuffCycle[];
}

export interface PuffVariant {
  name: string;
  calibrate(input: PuffCalibrationInput, config: Config): Calibration | null;
  /**
   * A fresh detector: feed it every frame (null = no face) with its dt, get the puff level 0..1 back.
   * `rest` is the relaxed face of the game's main calibration, there even when the puff calibration failed.
   */
  detector(calibration: Calibration | null, config: Config, rest: RestingFace): (f: FeatureVector | null, dt: number) => number;
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
  /** Share of "look around" frames of the strain script (relaxed, head moving) above the hover point (ideal: 0). */
  look: number;
  /** Same for the strain script's laughing frames (ideal: 0). */
  laugh: number;
}

export type PuffGesture = "plain" | "fish";

const GESTURES: Record<PuffGesture, { holds: string[]; labels: string[] }> = {
  plain: { holds: ["fullPuff", "puffPulse"], labels: PLAIN_PUFF_LABELS },
  fish: { holds: ["fishPuff", "fishPulse"], labels: FISH_PUFF_LABELS },
};

const REACTION = 0.6;
const RELAXED = ["neutral", "relax", "puffRelax"];

/** null if the recording has no puff segment, or not enough of this gesture to calibrate on. */
export function scorePuff(rec: Recording, variant: PuffVariant, config: Config, gesture: PuffGesture = "plain"): PuffScore | null {
  const { holds, labels } = GESTURES[gesture];
  // The pufferfish face has its own segment; sessions from October 10 morning have it at the end of the puff segment.
  const segment = gesture === "fish" ? (rec.segments.fish ?? rec.segments.puff) : rec.segments.puff;
  const calib = rec.segments.calibration;
  if (!segment?.length || !calib) return null;
  const neutral = calib
    .filter((f) => f.label === "neutral" && f.f && f.since >= config.calibrationSettle && f.since < config.calibrationSeconds)
    .map((f) => f.f!);
  const all = steps(segment);
  const first = all.findIndex((s) => s.label === holds[0]);
  if (!neutral.length || first < 0) return null;

  const cut = (s: Step | undefined, seconds: number) =>
    (s?.frames ?? []).filter((f) => f.f && f.since >= config.calibrationSettle && f.since < seconds).map((f) => f.f!);
  // Hold → relax cycles from the first hold on: [hold step, relax step] index pairs.
  const pairs: [number, number][] = [];
  for (let i = first; i < all.length && pairs.length < 4; i++) {
    if (!holds.includes(all[i].label)) continue;
    const relax = all.findIndex((s, j) => j > i && RELAXED.includes(s.label));
    if (relax < 0) break;
    pairs.push([i, relax]);
    i = relax;
  }
  if (pairs.length < 2) return null;
  const cycle = ([h, r]: [number, number]): PuffCycle => ({
    puff: cut(all[h], config.oceanCalibrationSeconds),
    relax: cut(all[r], config.oceanRelaxSeconds),
  });
  const before = all.slice(0, first).reverse().find((s) => RELAXED.includes(s.label));
  const strainFrames = rec.segments.strain ?? [];
  const lookStep = steps(strainFrames).find((s) => s.label === "look");
  const lookUsed = new Set(
    (lookStep?.frames ?? []).filter((f) => f.since < config.calibrationSettle + config.oceanRelaxSeconds),
  );
  const input: PuffCalibrationInput = {
    neutral,
    fresh: cut(before, config.oceanRelaxSeconds),
    look: [...lookUsed].filter((f) => f.f && f.since >= config.calibrationSettle).map((f) => f.f!),
    cycles: pairs.slice(0, 2).map(cycle),
    retry: pairs.length >= 4 ? pairs.slice(2, 4).map(cycle) : [],
  };
  const calibration = variant.calibrate(input, config);
  const rest = buildCalibration(featureStats(neutral), featureStats(neutral), config);

  // Score what comes after the calibration cycles (the detector runs from the start, so it's warmed up).
  const scoredFrom = all[pairs[1][1] + 1]?.frames[0];
  const detect = variant.detector(calibration, config, rest);
  const levels: Record<"relaxed" | "half" | "full", number[]> = { relaxed: [], half: [], full: [] };
  let scoring = false;
  let prevT: number | null = null;
  for (const fr of segment) {
    const level = detect(fr.f, prevT === null ? 1 / 30 : Math.max(0, fr.t - prevT));
    prevT = fr.t;
    if (fr === scoredFrom) scoring = true;
    if (!scoring || fr.since < REACTION) continue;
    if (RELAXED.includes(fr.label)) levels.relaxed.push(level);
    else if (fr.label === "halfPuff" && gesture === "plain") levels.half.push(level);
    else if (labels.includes(fr.label)) levels.full.push(level);
  }
  // Looking around (the frames no calibration saw) and laughing while relaxed, from the strain script, with a fresh detector.
  const look: number[] = [];
  const laugh: number[] = [];
  const lookDetect = variant.detector(calibration, config, rest);
  prevT = null;
  for (const fr of strainFrames) {
    const level = lookDetect(fr.f, prevT === null ? 1 / 30 : Math.max(0, fr.t - prevT));
    prevT = fr.t;
    if (fr.since < REACTION) continue;
    if (fr.label === "look" && !lookUsed.has(fr)) look.push(level);
    else if (fr.label === "laugh") laugh.push(level);
  }
  const share = (v: number[], pass: (x: number) => boolean) => (v.length ? v.filter(pass).length / v.length : NaN);
  const spikes = (v: number[]) => share(v, (x) => x >= config.oceanSpikeThreshold);
  return {
    relaxed: median(levels.relaxed), half: median(levels.half), full: median(levels.full),
    sink: share(levels.relaxed, (x) => x < config.oceanHoverPuff),
    rise: share(levels.full, (x) => x > config.oceanHoverPuff),
    spikeRelaxed: spikes(levels.relaxed), spikeHalf: spikes(levels.half),
    look: share(look, (x) => x > config.oceanHoverPuff),
    laugh: share(laugh, (x) => x > config.oceanHoverPuff),
  };
}

interface Step {
  label: string;
  frames: Frame[];
}

/** Consecutive frames of one step (a new step of the same label restarts `since`). */
function steps(frames: Frame[]): Step[] {
  const out: Step[] = [];
  for (const f of frames) {
    const cur = out[out.length - 1];
    if (cur && cur.label === f.label && f.since >= cur.frames[cur.frames.length - 1].since) cur.frames.push(f);
    else out.push({ label: f.label, frames: [f] });
  }
  return out;
}

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}
