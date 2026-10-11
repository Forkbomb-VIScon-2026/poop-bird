// Poops: falling, and what they hit (targets, pigeons, balloons, obstacles, water, the street).

import { config } from "../config";
import { poopHitsBalloon } from "./balloons";
import { splash, splatParticles } from "./effects";
import type { Game } from "./game";
import { disarmKid, kidArmed } from "./kids";
import { obstacleRects } from "./obstacles";
import { smashCamera } from "./paparazzi";
import { poopHitsPigeon } from "./power-lines";
import { provoke, targetRect } from "./street";
import { ruinWedding, weddingHit } from "./wedding";
import { circleRect, GROUND_Y, WATER_Y } from "./world";

/** How fast a poop loses its forward world speed (1/s). */
export const POOP_DRAG = 0.6;

export interface Poop {
  x: number;
  y: number;
  vx: number; // screen space
  vy: number;
  r: number;
  big: boolean;
  trail: number;
  rot: number;
}

export function spawnPoop(g: Game, x: number, y: number, r: number, vy: number, big: boolean): void {
  // Poops inherit the bird's forward speed (world vx = scroll speed, i.e.
  // screen vx = 0) and slowly lose it to drag.
  g.poops.push({ x, y, vx: 0, vy: vy + Math.max(0, g.bird.vy * 0.2), r, big, trail: 0, rot: Math.random() * 6 });
}

export function updatePoops(g: Game, dt: number, speed: number): void {
  const keep: Poop[] = [];
  for (const p of g.poops) {
    // World velocity decays from `speed` toward 0 → screen vx drifts back.
    const worldVx = (p.vx + speed) * Math.exp(-POOP_DRAG * dt);
    p.vx = worldVx - speed;
    p.vy += config.poopGravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += dt * 4;
    p.trail -= dt;
    if (p.trail <= 0) {
      p.trail = 0.025;
      g.particles.push({
        x: p.x + (Math.random() - 0.5) * p.r, y: p.y - p.r * 0.5,
        vx: (Math.random() - 0.5) * 20, vy: -10,
        life: 0.35, maxLife: 0.35, size: 1.5 + Math.random() * p.r * 0.35,
        color: "#8b5a2b", gravity: 0, world: true,
      });
    }
    if (poopHits(g, p)) continue;
    keep.push(p);
  }
  g.poops = keep;
}

/** Returns true if the poop was consumed. */
function poopHits(g: Game, p: Poop): boolean {
  if (poopHitsPigeon(g, p)) return true;
  if (poopHitsBalloon(g, p)) return true;
  // Targets
  for (const t of g.targets) {
    const rect = targetRect(t);
    if (!circleRect(p.x, p.y, p.r, rect)) continue;
    t.splats.push({ dx: p.x - t.x, dy: Math.max(-t.h, p.y - t.y), r: p.r * 1.3, seed: Math.random() * 1000 });
    t.hitFlash = 0.3;
    const camera = t.pap?.state === "watching";
    if (camera) smashCamera(g, t);
    const armed = kidArmed(t);
    if (armed) disarmKid(g, t);
    const wed = t.wedding ? weddingHit(g, t, t.wedding) : null;
    const kindMult = wed
      ? wed.mult
      : camera
        ? config.paparazziMultiplier
        : armed
          ? config.kidMultiplier
          : t.kind === "parachutist"
            ? config.balloonPassengerMultiplier
            : t.kind === "car" ? 1 : t.kind === "statue" ? 2 : 1.5;
    const points = g.scoreHit(kindMult, p.big ? 2 : 1);
    if (wed?.ruin && t.wedding) ruinWedding(g, t.wedding, points);
    g.floater(p.x, t.y - t.h - 10, g.scoreLabel(points), "#ffe14d", 26, 1.1);
    splatParticles(g, p.x, p.y, p.r, true);
    g.events.push({ type: "hit", points, combo: g.combo, kind: t.kind });
    g.events.push({ type: "splat", big: p.big });
    provoke(g, t);
    return true;
  }
  // Obstacles
  for (const o of g.obstacles) {
    for (const r of obstacleRects(o)) {
      if (!circleRect(p.x, p.y, p.r, r)) continue;
      o.splats.push({ dx: p.x - o.x, dy: p.y, r: p.r * 1.2, seed: Math.random() * 1000 });
      splatParticles(g, p.x, p.y, p.r, false);
      g.events.push({ type: "splat", big: p.big });
      return true;
    }
  }
  // Harbour water: a plop and a ring of spray, nothing to splat.
  if (g.overWater(p.x) && p.y >= WATER_Y + 4) {
    splash(g, p.x, WATER_Y, -1, 6 + Math.round(p.r));
    g.dropCombo(p.x, WATER_Y - 30, g.phase === "playing");
    g.events.push({ type: "splat", big: false });
    return true;
  }
  // Ground: poops land mid-road, below every target's top edge, so a poop
  // over a target always reaches the target first.
  const groundHit = GROUND_Y + 55;
  if (p.y + p.r >= groundHit) {
    g.decals.push({ x: p.x, y: groundHit - 4 + Math.random() * 14, r: p.r * 1.6, seed: Math.random() * 1000 });
    if (g.decals.length > 60) g.decals.shift();
    splatParticles(g, p.x, groundHit, p.r, false);
    g.dropCombo(p.x, groundHit - 30, g.phase === "playing");
    g.events.push({ type: "splat", big: p.big });
    return true;
  }
  return false;
}
