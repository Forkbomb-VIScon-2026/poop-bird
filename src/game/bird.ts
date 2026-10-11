// The bird (city): charging and releasing, accidents, flight physics and collisions.

import { stepCharge } from "../charge";
import { config } from "../config";
import type { Game } from "./game";
import { obstacleRects, obstacleSpan } from "./obstacles";
import { spawnPoop } from "./poops";
import { poleRect, touchesWire } from "./power-lines";
import { DIVE_TAKEOVER, startTransition } from "./stage";
import { BIRD_RADIUS, circleRect, VIEW_H, WATER_Y } from "./world";

/** Upward px/s the street gives the bird back during the calm city lesson. */
const CALM_BOUNCE = 320;

const ACCIDENT_MESSAGES = [
  "CODE BROWN!",
  "Oops… that wasn't a fart",
  "TOO MUCH PRESSURE!",
  "Should've had more fiber",
  "Abort! ABORT!",
  "Sharted mid-air",
  "Push gently, they said",
  "That's going to stain",
];

export function updateCharge(g: Game, dt: number): void {
  const { state, event } = stepCharge(g.charge, g.straining, dt, config);
  g.charge = state;
  if (!event) return;
  if (event.type === "release") release(g, event.charge, event.push, event.sweetSpot);
  else accident(g);
}

function release(g: Game, charge: number, push: number, sweet: boolean): void {
  const b = g.bird;
  if (b.vy > 0) b.vy *= 1 - config.fallCancel;
  b.vy -= push;
  b.stretchV += 6 + charge * 10;
  b.relief = 0.45;
  b.flap = 0.35;
  g.poopsDropped++;
  spawnPoop(g, b.x - 4, b.y + BIRD_RADIUS * 0.8, 5 + charge * 7, 140 + charge * 260, false);
  // Fart cloud
  const n = 4 + Math.round(charge * 14);
  for (let i = 0; i < n; i++) {
    g.particles.push({
      x: b.x - 10, y: b.y + 14,
      vx: -40 - Math.random() * 90 * (0.5 + charge), vy: 20 + Math.random() * 80 - 40,
      life: 0.4 + Math.random() * 0.5 * (0.5 + charge), maxLife: 0.9,
      size: 4 + Math.random() * 8 * (0.4 + charge), color: sweet ? "#ffe066" : "#b5c99a",
      gravity: -30, world: true,
    });
  }
  if (sweet) {
    g.floaters.push({ x: b.x, y: b.y - 40, text: "PERFECT PUSH!", color: "#ffd000", size: 30, life: 1.1, maxLife: 1.1 });
  } else if (charge >= 0.95) {
    g.floaters.push({ x: b.x, y: b.y - 40, text: "BIG ONE!", color: "#fff", size: 24, life: 0.8, maxLife: 0.8 });
  } else if (charge < 0.12) {
    g.floaters.push({ x: b.x - 20, y: b.y + 10, text: "pfft", color: "#e9f5db", size: 16, life: 0.6, maxLife: 0.6 });
  }
  g.events.push({ type: "release", charge, sweet });
}

function accident(g: Game): void {
  const b = g.bird;
  g.accidents++;
  const text = ACCIDENT_MESSAGES[Math.floor(Math.random() * ACCIDENT_MESSAGES.length)];
  g.message = { text, life: 2.2 };
  g.shake = 18;
  b.stretchV -= 12;
  // A big messy blob and a spray of mess.
  spawnPoop(g, b.x, b.y + BIRD_RADIUS, 16, 60, true);
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 80 + Math.random() * 380;
    g.particles.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100,
      life: 0.6 + Math.random() * 0.8, maxLife: 1.4,
      size: 3 + Math.random() * 7, color: Math.random() < 0.7 ? "#7a4a1e" : "#5c3310",
      gravity: 900, world: true,
    });
  }
  for (let i = 0; i < 6; i++) {
    g.screenSplats.push({
      x: Math.random() * g.width, y: Math.random() * VIEW_H,
      r: 30 + Math.random() * 70, seed: Math.random() * 1000, life: 2.5 + Math.random(),
    });
  }
  g.events.push({ type: "accident", message: text });
}

export function updateBird(g: Game, dt: number): void {
  const b = g.bird;
  const charging = g.charge.charge > 0 && !g.stunned;
  const grace = config.startGrace > 0 ? Math.min(1, g.stageTime / config.startGrace) : 1;
  const dying = g.phase !== "playing";
  const grav = config.gravity * (dying ? 2.5 : grace * (charging ? config.chargeGravityScale : 1));
  const maxFall = dying ? 900 : charging ? Math.min(config.maxFallSpeed, config.chargeMaxFallSpeed) : config.maxFallSpeed;
  // While charging, a faster fall eases down to the charging cap instead of snapping to it.
  b.vy = b.vy > maxFall ? Math.max(maxFall, b.vy - grav * 3 * dt) : Math.min(b.vy + grav * dt, maxFall);
  b.y += b.vy * dt;

  // Clamp at the top of the screen.
  if (b.y < BIRD_RADIUS) {
    b.y = BIRD_RADIUS;
    if (b.vy < 0) b.vy = 0;
  }

  animateBird(g, dt);

  if (g.stunned) b.rot += dt * 14;
  else if (g.phase === "dying") b.rot += (1.4 - b.rot) * Math.min(1, dt * 6);
  else {
    const targetRot = Math.max(-0.5, Math.min(0.7, b.vy / 700));
    // Unwind tumble rotation to the nearest full turn.
    const wound = b.rot - Math.round(b.rot / (Math.PI * 2)) * Math.PI * 2;
    b.rot = wound + (targetRot - wound) * Math.min(1, dt * 10);
  }

  // Over the harbour: the game takes over and dives the bird in (right away if it touches the water).
  const s = g.shore;
  const touches = g.overWater(b.x) && b.y + BIRD_RADIUS >= WATER_Y;
  if (g.phase === "playing" && s?.kind === "dive" && (b.x - s.x >= DIVE_TAKEOVER || touches)) {
    startTransition(g, "ocean");
    return;
  }
  const floor = g.floorY();
  if (b.y + BIRD_RADIUS >= floor) {
    b.y = floor - BIRD_RADIUS;
    if (b.vy > 0) b.vy = 0;
    if (g.phase === "playing" && g.calmCity) b.vy = -CALM_BOUNCE;
    else if (g.phase === "playing") g.crash();
  }
  if (g.phase === "playing" && hitsObstacle(g)) g.crash();
  if (g.phase === "playing" && touchesWire(g)) g.zap();
  if (g.zapped && Math.random() < dt * 25) {
    g.particles.push({
      x: b.x + (Math.random() - 0.5) * 20, y: b.y - 10,
      vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 40,
      life: 0.9, maxLife: 0.9, size: 4 + Math.random() * 6, color: "rgba(90,90,90,0.6)",
      gravity: -40, world: true,
    });
  }
}

/** Squash & stretch spring, and the relief and flap timers. */
export function animateBird(g: Game, dt: number): void {
  const b = g.bird;
  const k = 220;
  const damp = 14;
  b.stretchV += (-(b.stretch - 1) * k - b.stretchV * damp) * dt;
  b.stretch = Math.max(0.6, Math.min(1.5, b.stretch + b.stretchV * dt));
  b.relief = Math.max(0, b.relief - dt);
  b.flap = Math.max(0, b.flap - dt);
}

export function hitsObstacle(g: Game): boolean {
  const { x, y } = g.bird;
  const r = g.hitRadius;
  for (const o of g.obstacles) {
    const span = obstacleSpan(o);
    if (span.left > x + 80 || span.right < x - 80) continue;
    for (const rect of obstacleRects(o)) if (circleRect(x, y, r, rect)) return true;
  }
  for (const l of g.powerLines) {
    for (let i = 0; i < l.poles; i++) if (circleRect(x, y, r, poleRect(l, i))) return true;
  }
  return false;
}
