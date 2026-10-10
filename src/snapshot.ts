// "Finest strain" snapshot: keeps a cropped copy of the video frame where the
// face looked most strained during the run (strain.ts `strainedness`, the
// leaderboard's face ranking). The crop lives in an in-memory canvas and is
// only encoded to JPEG at game over. It leaves the device only if the player
// submits the run to the leaderboard with their face.
//
// captureFace() uses the same crop for the paparazzi's in-game photos, which
// only ever live in memory for the current run.

import type { FaceBox } from "./face";

const WIDTH = 200;

export class StrainSnapshot {
  private canvas = document.createElement("canvas");
  private peak = 0;
  private has = false;

  reset(): void {
    this.peak = 0;
    this.has = false;
  }

  /** Strainedness (0..1) of the captured face; 0 if none. */
  get peakStrain(): number {
    return this.has ? this.peak : 0;
  }

  /** Call on every detection while the player strains. Grabs the frame when strainedness hits a new peak. */
  offer(video: HTMLVideoElement, box: FaceBox | null, strain: number): void {
    if (!box || strain <= this.peak + 0.002 || strain < 0.15) return;
    if (!cropFace(video, box, this.canvas, WIDTH)) return;
    this.peak = strain;
    this.has = true;
  }

  /** JPEG data URL of the peak frame, or null if none was captured. */
  toDataURL(): string | null {
    if (!this.has) return null;
    try {
      return this.canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    }
  }
}

/** A fresh canvas holding the face crop of the current video frame (the paparazzi's photo), or null. */
export function captureFace(video: HTMLVideoElement, box: FaceBox | null): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  return box && cropFace(video, box, canvas, WIDTH) ? canvas : null;
}

/** Draws the padded, mirrored face crop into `canvas` (resized to `width`). False if there's nothing to crop. */
function cropFace(video: HTMLVideoElement, box: FaceBox, canvas: HTMLCanvasElement, width: number): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  // Pad the landmark box so the whole face (and some forehead) fits.
  const padX = box.w * 0.25;
  const padY = box.h * 0.3;
  const sx = Math.max(0, (box.x - padX) * vw);
  const sy = Math.max(0, (box.y - padY) * vh);
  const sw = Math.min(vw - sx, (box.w + padX * 2) * vw);
  const sh = Math.min(vh - sy, (box.h + padY * 2) * vh);
  if (sw < 8 || sh < 8) return false;
  const height = Math.round((width * sh) / sw);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  // Mirror so it matches what the player saw in the preview.
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  ctx.restore();
  return true;
}
