// Puff scoreboard: fit a puff calibration like the game's first dive (relaxed
// face from the calibration, puff samples from the first hold of the gesture),
// then replay the puff segment and check the fish gets the levels it should.
// Two gestures are scored separately: the plain puff, and the "pufferfish
// face" (puffing the cheeks while pursing the lips) that sessions recorded
// since October 10 also have.

import type { Config } from "../../src/config";
import { FISH_PUFF_LABELS, PLAIN_PUFF_LABELS } from "../../src/session";
import type { RestingFace } from "../../src/puff";
import { buildCalibration, featureStats, type Calibration, type FeatureVector } from "../../src/strain";
import type { Frame, Recording } from "./load";

/** What a puff calibration can be fitted from. */
export interface PuffCalibrationInput {
  /** The relaxed phase of the game's calibration, recorded before the strain script. */
  neutral: FeatureVector[];
  /**
   * A short relaxed read right before the puff: the last relaxed step before
   * the first hold, cut like a read at the dive would be (settle time
   * skipped, defaultNeutralSeconds long).
   */
  fresh: FeatureVector[];
  /** The first hold of the gesture, cut like the game's puff phase. */
  puff: FeatureVector[];
  /**
   * The next hold of the gesture (a pulse), cut the same way: what the game's
   * second try sees when the first hold fails the quality check. Empty if none.
   */
  retry: FeatureVector[];
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
  const inWindow = (f: Frame) => f.f && f.since >= config.calibrationSettle && f.since < config.oceanCalibrationSeconds;
  const puff = frames.filter((f) => f.label === hold && inWindow(f)).map((f) => f.f!);
  if (!neutral.length || !puff.length) return null;
  const fresh = freshRelaxed(frames, hold, config);
  const retry = nextHold(frames, hold, labels.filter((l) => l !== "halfPuff")).filter(inWindow).map((f) => f.f!);
  const calibration = variant.calibrate({ neutral, fresh, puff, retry }, config);
  const rest = buildCalibration(featureStats(neutral), featureStats(neutral), config);
  const detect = variant.detector(calibration, config, rest);

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
  // Looking around and laughing while relaxed, from the strain script, with a fresh detector.
  const look: number[] = [];
  const laugh: number[] = [];
  const lookDetect = variant.detector(calibration, config, rest);
  prevT = null;
  for (const fr of rec.segments.strain ?? []) {
    const level = lookDetect(fr.f, prevT === null ? 1 / 30 : Math.max(0, fr.t - prevT));
    prevT = fr.t;
    if (fr.since < REACTION) continue;
    if (fr.label === "look") look.push(level);
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

/** The frames of the first gesture step after the first hold (see PuffCalibrationInput.retry). */
function nextHold(frames: Frame[], hold: string, labels: string[]): Frame[] {
  let i = frames.findIndex((f) => f.label === hold);
  if (i < 0) return [];
  while (i < frames.length && frames[i].label === hold) i++;
  while (i < frames.length && !labels.includes(frames[i].label)) i++;
  const out: Frame[] = [];
  for (let j = i; j < frames.length && frames[j].label === frames[i].label; j++) {
    if (j > i && frames[j].since < frames[j - 1].since) break;
    out.push(frames[j]);
  }
  return out;
}

/** The relaxed read right before the first hold (see PuffCalibrationInput.fresh). */
function freshRelaxed(frames: Frame[], hold: string, config: Config): FeatureVector[] {
  const first = frames.findIndex((f) => f.label === hold);
  let end = first;
  while (end > 0 && !RELAXED.includes(frames[end - 1].label)) end--;
  // Back to the start of that step (a new step of the same label restarts `since`).
  let start = end;
  while (start > 0 && frames[start - 1].label === frames[end - 1].label && (start === end || frames[start - 1].since <= frames[start].since)) {
    start--;
  }
  const from = config.calibrationSettle;
  const to = from + config.defaultNeutralSeconds;
  return frames.slice(start, end).filter((f) => f.f && f.since >= from && f.since < to).map((f) => f.f!);
}

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}
