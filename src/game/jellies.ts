// Jellyfish (ocean): spiked, the fish pops them for points; otherwise they sting.

import { config } from "../config";
import { pick } from "../random";
import { anglerBusy } from "./angler";
import { burst } from "./effects";
import type { Game } from "./game";
import { obstacleSpan } from "./obstacles";
import { sharkBusy } from "./shark";
import { GROUND_Y, SURFACE_Y } from "./world";

export interface Jelly {
  x: number;
  /** Centre height the jellyfish bobs around. */
  baseY: number;
  y: number;
  r: number;
  phase: number;
  hue: number;
}

const JELLY_HUES = [320, 285, 200, 340];

export function updateJellies(g: Game, dt: number, speed: number): void {
  for (const j of g.jellies) {
    j.x -= speed * dt;
    j.y = j.baseY + Math.sin(g.time * 1.6 + j.phase) * 14;
  }
  g.jellies = g.jellies.filter((j) => j.x > -80);
  if (g.stage !== "ocean" || g.phase !== "playing" || g.angler?.state === "hooked") return;

  // Popping (spiked) or getting stung (not spiked).
  const r = g.hitRadius;
  const { x, y } = g.bird;
  for (const j of g.jellies) {
    const dx = j.x - x;
    const dy = j.y - y;
    // Stings use a tight hitbox to feel fair; spikes pop from further out.
    const sting = r + j.r * 0.8;
    const reach = g.spike.spiked ? sting * config.oceanJellyPopReach : sting;
    if (dx * dx + dy * dy >= reach * reach) continue;
    if (g.spike.spiked) {
      popJelly(g, j);
    } else {
      g.crash();
      return;
    }
  }
  g.jellies = g.jellies.filter((j) => j.r > 0);
  if (g.calmWater) return;

  g.jellySpawnAcc += dt * config.oceanJellyRate;
  if (g.jellySpawnAcc >= 1) {
    // Open water only: no obstacle near the spawn point, and the next one
    // (it spawns at the same x) far enough behind that it can't land on top.
    const sx = g.width + 50;
    const clear =
      g.shore?.kind !== "exit" &&
      !anglerBusy(g) &&
      !sharkBusy(g) &&
      g.obstacles.every((o) => {
        const span = obstacleSpan(o);
        return span.left > sx + 70 || span.right < sx - 70;
      }) &&
      (g.gateSpawned || g.nextObstacleAt - g.distance > 220);
    if (clear) {
      g.jellySpawnAcc = (Math.random() - 0.5) * 0.6;
      const baseY = SURFACE_Y + 70 + Math.random() * (GROUND_Y - SURFACE_Y - 140);
      g.jellies.push({
        x: sx, baseY, y: baseY, r: 18 + Math.random() * 6,
        phase: Math.random() * Math.PI * 2, hue: pick(JELLY_HUES),
      });
    }
  }
}

function popJelly(g: Game, j: Jelly): void {
  g.jelliesPopped++;
  const points = g.scoreHit(config.oceanJellyMultiplier);
  g.floater(j.x, j.y - 30, g.scoreLabel(points), "#ffe14d", 26, 1.1);
  burst(g, j.x, j.y, 18, { speed: [60, 240], life: [0.4, 0.8], maxLife: 0.8, size: [2, 6], color: `hsla(${j.hue},90%,80%,1)`, gravity: -60 });
  j.r = 0; // removed by the caller
  g.events.push({ type: "jellyPopped", points, combo: g.combo });
}
