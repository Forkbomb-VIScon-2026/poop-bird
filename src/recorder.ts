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
}

/** Relaxed → puff and hold → relaxed → quick puffs. */
export const PUFF_SCRIPT: RecorderStep[] = [
  { seconds: 3, prompt: "Recording: relax your face", label: "neutral" },
  { seconds: 5, prompt: "Puff your cheeks and HOLD", label: "hold" },
  { seconds: 3, prompt: "Relax", label: "neutral2" },
  { seconds: 5, prompt: "Puff, release, puff, release…", label: "pulses" },
];

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

  constructor(
    private script: RecorderStep[],
    private onPrompt: (prompt: string, seconds: number) => void,
  ) {}

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
      this.onPrompt(this.script[index].prompt, this.script[index].seconds);
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
    const data = { recordedAt: new Date().toISOString(), script: this.script, ...context, samples: this.samples };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `poopbird-face-${data.recordedAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
