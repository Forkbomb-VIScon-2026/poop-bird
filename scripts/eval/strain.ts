// Strain scoreboard: fit a calibration from a recording's calibration segment
// (like the game), then replay its strain segment through a detector and
// measure what a player would feel.

import type { Config } from "../../src/config";
import { STRAIN_LABELS } from "../../src/session";
import type { Calibration, FeatureVector } from "../../src/strain";
import type { Frame, Recording } from "./load";

/** The calibration phases, cut like main.ts does (settle time skipped, phase length kept). */
export interface StrainCalibrationInput {
  neutral: FeatureVector[];
  strain: FeatureVector[];
  /** The relax-again phase after the strain (not used by the game yet). */
  relaxAgain: FeatureVector[];
}

export interface StrainVariant {
  name: string;
  calibrate(input: StrainCalibrationInput, config: Config): Calibration | null;
  /** A fresh detector: feed it every frame (null = no face) with its dt, get "straining?" back. */
  detector(calibration: Calibration | null, config: Config): (f: FeatureVector | null, dt: number) => boolean;
}

export interface StrainScore {
  /** Share of strain-step frames detected as straining. */
  hit: number;
  /** Share of frames wrongly detected as straining while relaxed, looking around, laughing. */
  falseRelaxed: number;
  falseLook: number;
  falseLaugh: number;
  /** Share of light-strain frames detected (no right answer; for information). */
  light: number;
  /** Releases in the middle of a strain step: a poop the player didn't ask for. */
  early: number;
  /** Seconds from the cue to detection, per strain step (Infinity = never). */
  press: number[];
  /** Seconds from the relax cue to release, per relax after a strain (Infinity = never). */
  release: number[];
}

const REACTION = 0.6;
const RELAXED = ["neutral", "relax", "pulseRelax", "relax2"];

export function calibrationInput(rec: Recording, config: Config): StrainCalibrationInput | null {
  const frames = rec.segments.calibration;
  if (!frames) return null;
  const phase = (label: string) =>
    frames
      .filter((f) => f.label === label && f.f && f.since >= config.calibrationSettle && f.since < config.calibrationSeconds)
      .map((f) => f.f!);
  const input = { neutral: phase("neutral"), strain: phase("strain"), relaxAgain: phase("relaxAgain") };
  return input.neutral.length && input.strain.length ? input : null;
}

export function scoreStrain(rec: Recording, variant: StrainVariant, config: Config): StrainScore | null {
  const input = calibrationInput(rec, config);
  const frames = rec.segments.strain;
  if (!input || !frames?.length) return null;
  const detect = variant.detector(variant.calibrate(input, config), config);

  const counts = new Map<string, [number, number]>();
  const count = (key: string, on: boolean) => {
    const c = counts.get(key) ?? [0, 0];
    counts.set(key, [c[0] + (on ? 1 : 0), c[1] + 1]);
  };
  const press: number[] = [];
  const release: number[] = [];
  let early = 0;
  let pending: { kind: "press" | "release"; start: number } | null = null;
  let active = false;
  let prev: Frame | null = null;
  const settle = () => {
    if (pending) (pending.kind === "press" ? press : release).push(Infinity);
    pending = null;
  };

  for (const fr of frames) {
    const was = active;
    active = detect(fr.f, prev ? Math.max(0, fr.t - prev.t) : 1 / 30);
    const strainStep = STRAIN_LABELS.includes(fr.label);
    if (!prev || prev.label !== fr.label || fr.since < prev.since) {
      settle();
      if (strainStep) pending = { kind: "press", start: fr.t };
      else if (prev && STRAIN_LABELS.includes(prev.label)) pending = { kind: "release", start: fr.t };
    }
    if (pending && (pending.kind === "press" ? active : !active)) {
      (pending.kind === "press" ? press : release).push(fr.t - pending.start);
      pending = null;
    }
    prev = fr;
    if (fr.since < REACTION) continue;
    if (strainStep && was && !active) early++;
    if (strainStep) count("hit", active);
    else if (RELAXED.includes(fr.label)) count("relaxed", active);
    else count(fr.label, active);
  }
  settle();
  const share = (key: string) => {
    const c = counts.get(key);
    return c && c[1] ? c[0] / c[1] : NaN;
  };
  return {
    hit: share("hit"), falseRelaxed: share("relaxed"), falseLook: share("look"), falseLaugh: share("laugh"),
    light: share("lightStrain"), early, press, release,
  };
}
