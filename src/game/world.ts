// The playfield: its fixed heights and the two stages' coordinates, shared by
// the simulation and the renderer.
//
// Coordinates: the city and the ocean each have their own y (0 = top of the
// screen while playing that stage). The ocean sits OCEAN_DEPTH below the city:
// ocean y + OCEAN_DEPTH = city y, so the ocean's surface is the harbour's
// water level. `Game.cameraY` is the top of the view in city coordinates.

export const VIEW_H = 600;
export const GROUND_Y = 520;

export const BIRD_RADIUS = 22;

/** The practice perch (a street lamp) the bird sits on before a run: the bird's y when perched. */
export const PERCH_Y = 270;

/** Ocean: the water surface (a soft ceiling). The sea floor is GROUND_Y. */
export const SURFACE_Y = 36;
/** City: the harbour's water level, a step below the quay (GROUND_Y). */
export const WATER_Y = GROUND_Y + 16;
/** How far the ocean sits below the city: ocean y + OCEAN_DEPTH = city y. */
export const OCEAN_DEPTH = WATER_Y - SURFACE_Y;
/** Ocean y halfway between the surface and the sea floor. */
export const OCEAN_MID_Y = (SURFACE_Y + GROUND_Y) / 2;

export type Stage = "city" | "ocean";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Splat {
  dx: number;
  dy: number;
  r: number;
  seed: number;
  /** Game time it landed (targets only): its drips run down from then. */
  at?: number;
}

export type GamePhase = "playing" | "dying" | "over";

export function circleRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  if (rect.h <= 0 || rect.w <= 0) return false;
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Switches a state machine (shark, fisherman, anchor drop…) to `state` and restarts its clock. */
export function enterState<S>(e: { state: S; t: number }, state: S): void {
  e.state = state;
  e.t = 0;
}
