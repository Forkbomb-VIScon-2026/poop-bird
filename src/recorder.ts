// Debug face recorder: captures a short scripted clip of raw tracker output
// (features, all blendshapes, all landmarks) and downloads it as JSON, so
// detection can be analysed and tuned offline against a real face.

import type { FaceFrame } from "./face";

export interface RecorderStep {
  /** Seconds this step lasts. */
  seconds: number;
  /** Instruction shown to the player. */
  prompt: string;
  /** Short label stored with each sample. */
  label: string;
  /** Beep when the step starts (high for "strain"), for steps done with the eyes shut. */
  cue?: "strain" | "relax";
}

/** Relaxed → puff and hold → relaxed → quick puffs. */
export const PUFF_SCRIPT: RecorderStep[] = [
  { seconds: 3, prompt: "Recording: relax your face", label: "neutral" },
  { seconds: 5, prompt: "Puff your cheeks and HOLD", label: "hold" },
  { seconds: 3, prompt: "Relax", label: "neutral2" },
  { seconds: 5, prompt: "Puff, release, puff, release…", label: "pulses" },
];

/**
 * Relaxed → strain like the calibration, then what matters in play: relaxing
 * after a strain, quick strain/relax pulses, a long hold, and relaxed faces
 * that aren't a calm stare (looking around, laughing). Every step beeps, since
 * a strain squeezes the eyes shut.
 */
export const STRAIN_SCRIPT: RecorderStep[] = [
  { seconds: 4, prompt: "Recording: relax your face", label: "neutral", cue: "relax" },
  { seconds: 4, prompt: "STRAIN and hold", label: "strain", cue: "strain" },
  { seconds: 4, prompt: "Relax", label: "relax", cue: "relax" },
  ...[1, 2, 3, 4].flatMap((): RecorderStep[] => [
    { seconds: 1.5, prompt: "STRAIN", label: "pulseStrain", cue: "strain" },
    { seconds: 1.5, prompt: "Relax", label: "pulseRelax", cue: "relax" },
  ]),
  { seconds: 5, prompt: "STRAIN and HOLD", label: "longStrain", cue: "strain" },
  { seconds: 4, prompt: "Relax", label: "relax2", cue: "relax" },
  { seconds: 6, prompt: "Stay relaxed: look around the screen, tilt your head a little", label: "look", cue: "relax" },
  { seconds: 6, prompt: "Smile, laugh, talk", label: "laugh", cue: "relax" },
];

export const RECORDER_SCRIPTS = { puff: PUFF_SCRIPT, strain: STRAIN_SCRIPT };
export type RecorderKind = keyof typeof RECORDER_SCRIPTS;

interface Sample {
  t: number;
  label: string;
  features: Record<string, number> | null;
  blendshapes: Record<string, number>;
  /** Flattened x, y, z per landmark. */
  landmarks: number[] | null;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

export class FaceRecorder {
  private samples: Sample[] = [];
  private start = 0;
  private step = -1;
  private script: RecorderStep[];

  constructor(
    private kind: RecorderKind,
    private onStep: (step: RecorderStep) => void,
  ) {
    this.script = RECORDER_SCRIPTS[kind];
  }

  /** Seconds the whole script takes. */
  get duration(): number {
    return this.script.reduce((s, x) => s + x.seconds, 0);
  }

  /** Records one frame. Returns false once the script is over. */
  push(frame: FaceFrame): boolean {
    if (!this.start) this.start = frame.time;
    const t = (frame.time - this.start) / 1000;
    let end = 0;
    let index = -1;
    for (let i = 0; i < this.script.length; i++) {
      end += this.script[i].seconds;
      if (t < end) {
        index = i;
        break;
      }
    }
    if (index < 0) return false;
    if (index !== this.step) {
      this.step = index;
      this.onStep(this.script[index]);
    }
    const blendshapes: Record<string, number> = {};
    for (const [k, v] of Object.entries(frame.blendshapes)) blendshapes[k] = round(v);
    const features = frame.features
      ? Object.fromEntries(Object.entries(frame.features).map(([k, v]) => [k, round(v)]))
      : null;
    this.samples.push({
      t: round(t),
      label: this.script[index].label,
      features,
      blendshapes,
      landmarks: frame.landmarks ? frame.landmarks.flatMap((p) => [round(p.x), round(p.y), round(p.z)]) : null,
    });
    return true;
  }

  /** The recording plus whatever context the caller adds, as a JSON download. */
  download(context: Record<string, unknown>): void {
    const data = {
      recordedAt: new Date().toISOString(), kind: this.kind, script: this.script, ...context, samples: this.samples,
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `poopbird-face-${this.kind}-${data.recordedAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
