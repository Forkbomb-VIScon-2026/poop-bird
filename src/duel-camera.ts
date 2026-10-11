// The duel's pinhole camera: pure projection maths (duel-render.ts draws with it).
// It looks straight down the avenue (+z), so the vanishing point is at (cx, horizon).

export interface DuelCamera {
  x: number;
  y: number;
  z: number;
  /** Focal length in logical pixels. */
  f: number;
  /** Screen x of the vanishing point. */
  cx: number;
  /** Screen y of the vanishing point (the horizon). */
  horizon: number;
  /** Points closer than this (in z) are culled. */
  near: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Pixels per world unit at this depth. */
  s: number;
  /** Depth (z distance from the camera). */
  dz: number;
}

/** Projects a world point to the screen, or null if it's behind the camera or nearer than `near`. */
export function project(cam: DuelCamera, x: number, y: number, z: number): Projected | null {
  const dz = z - cam.z;
  if (!(dz > cam.near) || !Number.isFinite(dz)) return null;
  const s = cam.f / dz;
  return { x: cam.cx + (x - cam.x) * s, y: cam.horizon - (y - cam.y) * s, s, dz };
}

export interface CameraFit {
  /** Logical size of the canvas (height is always 600). */
  width: number;
  height: number;
  back: number;
  camHeight: number;
  ceiling: number;
  halfWidth: number;
}

/**
 * Fits the focal length so the street under the birds, a bird at the ceiling
 * and the avenue's edges at the birds' depth are all on screen.
 */
export function fitCamera(birdZ: number, fit: CameraFit): DuelCamera {
  const horizon = fit.height * 0.36;
  const back = Math.max(50, fit.back);
  const camY = fit.camHeight;
  // The street right under the birds stays above the bottom edge (with room for the shadows).
  const fStreet = ((fit.height * 0.86 - horizon) * back) / Math.max(1, camY);
  // A bird at the ceiling stays below the timer.
  const fCeiling = ((horizon - 70) * back) / Math.max(1, fit.ceiling - camY);
  // The avenue's edges at the birds' depth stay on screen.
  const fSides = ((fit.width / 2 - 24) * back) / Math.max(1, fit.halfWidth);
  const f = Math.max(60, Math.min(fStreet, fit.ceiling > camY ? fCeiling : Infinity, fSides));
  return { x: 0, y: camY, z: birdZ - back, f, cx: fit.width / 2, horizon, near: 20 };
}
