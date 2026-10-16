// Cars drive in two lanes, one per direction, and keep their distance.

import type { Game } from "./game";
import type { Target } from "./street";
import { GROUND_Y } from "./world";

/** Road lanes (a car's foot y): traffic keeps right, so cars heading right drive in the near lane. */
export const NEAR_LANE_Y = GROUND_Y + 74;

export const FAR_LANE_Y = GROUND_Y + 46;
/** The car models (RTX photos); the last one is the city bus. */
export const CAR_MODELS = 7;

export const BUS_MODEL = CAR_MODELS - 1;
/** Bumper-to-bumper gap (px) a car keeps to the one ahead when stopped. */
const CAR_GAP = 26;
/** On top of that, a moving car keeps this many seconds of its speed to the one ahead. */
const CAR_HEADWAY = 0.8;
/** How fast cars speed up and brake (px/s²). */
const CAR_ACCEL = 80;
const CAR_BRAKE = 280;

/** How long a car looks (px): RTX photos are drawn wider than the car's hitbox, the bus most of all. */
export function carLength(t: Pick<Target, "w" | "model">): number {
  return t.w * (t.model === BUS_MODEL ? 2.3 : 1.5);
}

export const CAR_COLORS = ["#e84a5f", "#2a9df4", "#ffb400", "#5cc96b", "#9b5de5", "#f9844a"];

/** The cars in the lane heading `dir`, front car first. */
function lane(g: Game, dir: 1 | -1): Target[] {
  return g.targets.filter((t) => t.kind === "car" && t.facing === dir).sort((a, b) => (b.x - a.x) * dir);
}

/** Bumper-to-bumper gap from car `t` to the car ahead of it in its lane. */
function carGap(ahead: Target, t: Target): number {
  return (ahead.x - t.x) * t.facing - (carLength(ahead) + carLength(t)) / 2;
}

/** Each car drives at its cruising speed, slowing down to keep a safe distance to the one ahead. */
export function driveCars(g: Game, dt: number): void {
  for (const dir of [1, -1] as const) {
    const cars = lane(g, dir);
    for (let i = 0; i < cars.length; i++) {
      const t = cars[i];
      const cruise = t.cruise ?? 0;
      const want = i === 0 ? cruise : Math.min(cruise, Math.max(0, (carGap(cars[i - 1], t) - CAR_GAP) / CAR_HEADWAY));
      const v = t.speed * dir;
      const next = want < v ? Math.max(want, v - CAR_BRAKE * dt) : Math.min(want, v + CAR_ACCEL * dt);
      t.speed = next * dir;
    }
  }
}

/** Cars never drive into each other: one that got too close stops behind the car ahead. */
export function keepCarsApart(g: Game): void {
  for (const dir of [1, -1] as const) {
    const cars = lane(g, dir);
    for (let i = 1; i < cars.length; i++) {
      const ahead = cars[i - 1];
      const t = cars[i];
      const over = CAR_GAP / 2 - carGap(ahead, t);
      if (over <= 0) continue;
      t.x -= over * dir;
      t.speed = Math.min(t.speed * dir, Math.max(0, ahead.speed * dir)) * dir;
    }
  }
}

/** The first x from `x` on where a car `len` long fits in the lane heading `dir`, with room to brake. */
export function laneRoom(g: Game, dir: 1 | -1, x: number, len: number): number {
  for (const c of lane(g, dir)) x = Math.max(x, c.x + (carLength(c) + len) / 2 + CAR_GAP + 60);
  return x;
}
