// Start-screen attract mode: the autopilot that flies the bird and lands every poop on someone.

import { config } from "../config";
import type { Game } from "./game";
import { POOP_DRAG } from "./poops";
import type { Target } from "./street";
import { BIRD_RADIUS } from "./world";

/** Fastest climb (px/s) in attract mode, so the bird stays in the middle of the screen. */
export const DEMO_MAX_RISE = 300;

/** Attract mode: how far (screen vx, px/s) off a poop's natural fall the autopilot still lets go for a target. */
const DEMO_RELEASE_SLACK = 25;
/** Attract mode: the most a falling poop gets nudged (px/s) toward its target. */
export const DEMO_MAX_NUDGE = 40;

/** Strain while sinking, let go over a target (or before the bird gets too low). */
export function autopilot(g: Game): boolean {
  const b = g.bird;
  const c = g.charge.charge;
  if (c > 0) {
    const vy = 140 + c * 260 + Math.max(0, b.vy * 0.2); // as in release()
    const onTarget = c >= 0.15 && aimPoop(g, b.x - 4, b.y + BIRD_RADIUS * 0.8, vy, 0, DEMO_RELEASE_SLACK) !== null;
    return !onTarget && g.charge.fullHold < 0.85 && b.y < 390;
  }
  return b.y > 210 && b.vy > 0;
}

/**
 * The target a poop at (x, y) falling at vy would hit with the least change
 * to its screen vx, and the vx that gets it there; null if that change is
 * more than `maxChange`. Follows updatePoops(): the poop's world vx decays
 * with POOP_DRAG, so its screen vx drifts from vx toward -speed.
 */
export function aimPoop(g: Game, x: number, y: number, vy: number, vx: number, maxChange: number): { target: Target; vx: number } | null {
  const grav = config.poopGravity;
  const s = g.speed;
  let best: { target: Target; vx: number } | null = null;
  for (const t of g.targets) {
    const dy = t.y - t.h * 0.5 - y;
    if (dy <= 0) continue;
    const time = (-vy + Math.sqrt(vy * vy + 2 * grav * dy)) / grav;
    // Screen x after `time`: x + (vx + s)(1 - e^(-k·time))/k - s·time; the target is at t.x + (t.speed - s)·time.
    const glide = (1 - Math.exp(-POOP_DRAG * time)) / POOP_DRAG;
    const need = (t.x + t.speed * time - x) / glide - s;
    if (Math.abs(need - vx) > maxChange) continue;
    if (!best || Math.abs(need - vx) < Math.abs(best.vx - vx)) best = { target: t, vx: need };
  }
  return best;
}
