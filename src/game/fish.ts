// The pufferfish (ocean): puffing, spiking out and popping, swimming physics.

import { config } from "../config";
import { applyWaterDrag, guidePuff, stepSpike, targetSwimVelocity } from "../swim";
import { reelFish } from "./angler";
import { hitsObstacle } from "./bird";
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
  const text = POP_MESSAGES[Math.floor(Math.random() * POP_MESSAGES.length)];
  g.message = { text, life: 2.2 };
  g.shake = 16;
  b.stretchV -= 14;
  b.vy = Math.min(b.vy, -60);
  // The air comes out the back in a stream of bubbles.
  for (let i = 0; i < 44; i++) {
    const a = Math.PI + (Math.random() - 0.5) * 1.6;
    const s = 120 + Math.random() * 320;
    g.particles.push({
      x: b.x - 10, y: b.y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
      life: 0.5 + Math.random() * 0.7, maxLife: 1.2,
      size: 2 + Math.random() * 6, color: Math.random() < 0.6 ? "#e0fbfc" : "#a8dadc",
      gravity: -260, world: true,
    });
  }
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
        for (let i = 0; i < 6; i++) {
          g.particles.push({
            x: b.x + (Math.random() - 0.5) * r, y: SURFACE_Y,
            vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 80,
            life: 0.4, maxLife: 0.4, size: 2 + Math.random() * 3, color: "#e0fbfc", gravity: 500, world: true,
          });
        }
      }
      b.vy = config.oceanSurfaceBump;
    }
  }

  updateSpring(g, dt);
  b.flap = Math.max(0, b.flap - dt);

  if (stunned) b.rot += dt * 9;
  else if (dying) b.rot += (Math.PI - b.rot) * Math.min(1, dt * 3);
  else {
    const targetRot = Math.max(-0.35, Math.min(0.35, b.vy / 500));
    const wound = b.rot - Math.round(b.rot / (Math.PI * 2)) * Math.PI * 2;
    b.rot = wound + (targetRot - wound) * Math.min(1, dt * 6);
  }

  if (b.y + r >= GROUND_Y) {
    b.y = GROUND_Y - r;
    if (b.vy > 0) b.vy = 0;
    if (g.phase === "playing" && !g.calmWater && g.floorGrace <= 0) g.crash();
  }
  if (g.phase === "playing" && hitsObstacle(g)) g.crash();
}

export function updateSpring(g: Game, dt: number): void {
  const b = g.bird;
  const k = 220;
  const damp = 14;
  b.stretchV += (-(b.stretch - 1) * k - b.stretchV * damp) * dt;
  b.stretch = Math.max(0.6, Math.min(1.5, b.stretch + b.stretchV * dt));
}
