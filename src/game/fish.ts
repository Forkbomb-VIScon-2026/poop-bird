// The pufferfish (ocean): puffing, spiking out and popping, swimming physics.

import { config } from "../config";
import { applyWaterDrag, guidePuff, stepSpike, targetSwimVelocity } from "../swim";
import { reelFish } from "./angler";
import { easeRotation, hitsObstacle, springStretch } from "./bird";
import { burst } from "./effects";
import type { Game } from "./game";
import { EXIT_TAKEOVER, startTransition } from "./stage";
import { GROUND_Y, SURFACE_Y } from "./world";

/** s a guided fish (Game.guideY) takes to close the distance to its target, at most at full speed. */
const GUIDE_TIME = 0.5;

const POP_MESSAGES = [
  "PFFFBBBT!",
  "Pop goes the puffer",
  "Too much hot air!",
  "Over-inflated!",
  "Deflate-gate",
  "Sea you later, dignity",
  "Hold your breath, they said",
  "Blub… blub…",
];

export function updateSpike(g: Game, dt: number): void {
  const { state, event } = stepSpike(g.spike, g.puffInput, dt, config);
  g.spike = state;
  if (!event) return;
  if (event.type === "spike") {
    g.fish.flare = 0.35;
    g.bird.stretchV += 8;
    g.events.push({ type: "spike" });
  } else if (event.type === "pop") {
    popAccident(g);
  }
}

function popAccident(g: Game): void {
  const b = g.bird;
  g.accidents++;
  const text = g.say(POP_MESSAGES);
  g.shake = 16;
  b.stretchV -= 14;
  b.vy = Math.min(b.vy, -60);
  // The air comes out the back in a stream of bubbles.
  burst(g, b.x - 10, b.y, 44, {
    angle: [Math.PI - 0.8, Math.PI + 0.8], speed: [120, 440], lift: -30, life: [0.5, 1.2], maxLife: 1.2, size: [2, 8],
    color: () => (Math.random() < 0.6 ? "#e0fbfc" : "#a8dadc"), gravity: -260,
  });
  g.events.push({ type: "pop", message: text });
}

export function updateFish(g: Game, dt: number): void {
  const b = g.bird;
  const f = g.fish;
  const dying = g.phase !== "playing";
  const stunned = g.stunned;
  const guided = g.guideY !== null ? guidePuff(b.y, g.guideY, GUIDE_TIME, config) : null;
  const input = dying || stunned ? 0 : (guided ?? Math.min(1, Math.max(0, g.puffInput)));
  // The displayed puff eases quickly so a pop visibly deflates instead of snapping.
  f.puff += (input - f.puff) * (1 - Math.exp(-dt / (stunned ? 0.12 : 0.06)));
  const spiked = g.spike.spiked && !dying;
  f.spikes += ((spiked ? 1 : 0) - f.spikes) * Math.min(1, dt * (spiked ? 22 : 10));
  f.flare = Math.max(0, f.flare - dt);

  const a = g.angler;
  if (a && (a.state === "hooked" || a.state === "landed")) {
    reelFish(g, a, dt);
    return;
  }
  if (g.eaten) return;

  const target = dying ? 260 : targetSwimVelocity(input, config);
  b.vy = applyWaterDrag(b.vy, target, dt, Math.max(0.02, config.oceanDragTime));
  b.y += b.vy * dt;

  const r = g.bodyRadius;
  // The far quay is coming up: once the last obstacle is behind (or the wall
  // is close regardless), the game takes over and leaps the fish out.
  const s = g.shore;
  if (s?.kind === "exit" && !dying) {
    const ahead = s.x - b.x;
    if ((ahead < EXIT_TAKEOVER && g.obstacles.every((o) => o.passed)) || ahead < r + 60) {
      startTransition(g, "city");
      return;
    }
  }
  // The surface is a soft ceiling: clamp and bump back down.
  if (b.y - r < SURFACE_Y) {
    b.y = SURFACE_Y + r;
    if (b.vy < 0) {
      if (b.vy < -80) {
        b.stretchV -= 5;
        burst(g, b.x, SURFACE_Y, 6, { spread: r, vx: [-60, 60], vy: [-60, -140], life: 0.4, maxLife: 0.4, size: [2, 5], color: "#e0fbfc", gravity: 500 });
      }
      b.vy = config.oceanSurfaceBump;
    }
  }

  springStretch(g, dt);
  b.flap = Math.max(0, b.flap - dt);

  if (stunned) b.rot += dt * 9;
  else if (dying) b.rot += (Math.PI - b.rot) * Math.min(1, dt * 3);
  else easeRotation(g, Math.max(-0.35, Math.min(0.35, b.vy / 500)), dt * 6);

  if (b.y + r >= GROUND_Y) {
    b.y = GROUND_Y - r;
    if (b.vy > 0) b.vy = 0;
    if (g.phase === "playing" && !g.calmWater && g.floorGrace <= 0) g.crash();
  }
  if (g.phase === "playing" && hitsObstacle(g)) g.crash();
}
