// Cosmetic effects: particles, decals, score floaters and screen splats, and the bursts that spawn them.

import { pick } from "../random";
import type { Game } from "./game";
import { SURFACE_Y } from "./world";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  /** Moves with the world (scrolls left) when true. */
  world: boolean;
}

export interface Decal {
  x: number;
  y: number;
  r: number;
  seed: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface ScreenSplat {
  x: number;
  y: number;
  r: number;
  seed: number;
  life: number;
}

/** A fixed number, or a [min, max] range picked from at random for each particle. */
export type Roll = number | readonly [number, number];

export function roll(r: Roll): number {
  return typeof r === "number" ? r : r[0] + Math.random() * (r[1] - r[0]);
}

/** Directions (radians, screen space: 0 = right, -π/2 = up). */
export const ALL_AROUND = [0, Math.PI * 2] as const;
export const UPWARD = [0, -Math.PI] as const;

/**
 * A spray of particles. Each one flies off either in a direction (`angle`,
 * default all around) at `speed`, or with velocity `vx`, `vy`; `drift` is
 * added to its vx and `lift` to its vy. `spread` scatters the start point (±
 * half, in x or in x and y).
 * `color`: one colour, a list to pick from, or a function that picks.
 */
export interface Burst {
  angle?: Roll;
  speed?: Roll;
  vx?: Roll;
  vy?: Roll;
  drift?: number;
  lift?: number;
  spread?: number | readonly [number, number];
  life: Roll;
  maxLife: number;
  size: Roll;
  color: string | readonly string[] | (() => string);
  gravity: number;
  /** Moves with the world (scrolls left); default true. */
  world?: boolean;
}

export function burst(g: Game, x: number, y: number, n: number, b: Burst): void {
  const [sx, sy] = typeof b.spread === "number" ? [b.spread, 0] : (b.spread ?? [0, 0]);
  for (let i = 0; i < n; i++) {
    let vx = 0;
    let vy = 0;
    if (b.speed !== undefined) {
      const a = roll(b.angle ?? ALL_AROUND);
      const s = roll(b.speed);
      vx = Math.cos(a) * s;
      vy = Math.sin(a) * s;
    }
    const px = sx ? x + (Math.random() - 0.5) * sx : x;
    const py = sy ? y + (Math.random() - 0.5) * sy : y;
    if (b.speed === undefined) {
      vx = roll(b.vx ?? 0);
      vy = roll(b.vy ?? 0);
    }
    g.particles.push({
      x: px, y: py, vx: vx + (b.drift ?? 0), vy: vy + (b.lift ?? 0),
      life: roll(b.life), maxLife: b.maxLife, size: roll(b.size),
      color: typeof b.color === "string" ? b.color : typeof b.color === "function" ? b.color() : pick(b.color),
      gravity: b.gravity, world: b.world ?? true,
    });
  }
}

export function bubbleAt(g: Game, x: number, y: number, n: number): void {
  burst(g, x, y, n, { spread: [10, 10], vx: [-20, 20], vy: [-30, -70], life: [0.6, 1.1], maxLife: 1.1, size: [2, 6], color: "#e0fbfc", gravity: -120 });
}

/** Bubbles and spray where the bobber or something small hits the surface. */
export function ripple(g: Game, x: number, n: number): void {
  burst(g, x, SURFACE_Y + 4, n, { spread: 10, vx: [-25, 25], vy: [20, 70], life: [0.5, 0.9], maxLife: 0.9, size: [2, 5], color: "#e0fbfc", gravity: -160 });
}

/** Water thrown up where something hits the surface; `dir` -1 throws it lower and wider. */
export function splash(g: Game, x: number, y: number, dir: 1 | -1, n = 40): void {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (dir === 1 ? 1.6 : 2.4);
    const s = 150 + Math.random() * 380;
    g.particles.push({
      x: x + (Math.random() - 0.5) * 30, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * (dir === 1 ? 1 : 0.6),
      life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 3 + Math.random() * 6,
      color: pick(["#caf0f8", "#ffffff"]), gravity: 900, world: true,
    });
  }
}

/** A trail of bubbles behind the bird or fish while it moves under water. */
export function bubbleTrail(g: Game, dt: number, rate: number): void {
  if (Math.random() > dt * rate) return;
  burst(g, g.bird.x, g.bird.y, 1, {
    spread: [20, 20], vx: [-20, 20], vy: [-40, -100], life: [0.6, 1.2], maxLife: 1.2, size: [2, 6],
    color: () => (Math.random() < 0.6 ? "#e0fbfc" : "#a8dadc"), gravity: -120,
  });
}

/** Poop flying off where it splats (with yellow sparks on a hit). */
export function splatParticles(g: Game, x: number, y: number, r: number, hit: boolean): void {
  burst(g, x, y, 8 + Math.round(r), {
    angle: UPWARD, speed: [60, 220], life: [0.4, 0.7], maxLife: 0.7, size: [2, 5],
    color: hit ? () => (Math.random() < 0.3 ? "#ffe14d" : "#6b3e14") : "#6b3e14", gravity: 700,
  });
}

export function updateEffects(g: Game, dt: number, speed: number): void {
  for (const p of g.particles) {
    p.vy += p.gravity * dt;
    p.x += (p.vx - (p.world ? speed : 0)) * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  g.particles = g.particles.filter((p) => p.life > 0);
  if (g.particles.length > 600) g.particles.splice(0, g.particles.length - 600);

  for (const d of g.decals) d.x -= speed * dt;
  g.decals = g.decals.filter((d) => d.x > -80);

  for (const f of g.floaters) {
    f.y -= 40 * dt;
    f.life -= dt;
  }
  g.floaters = g.floaters.filter((f) => f.life > 0);

  for (const s of g.screenSplats) s.life -= dt;
  g.screenSplats = g.screenSplats.filter((s) => s.life > 0);

  g.shake = Math.max(0, g.shake - dt * 40);
  g.zapFlash = Math.max(0, g.zapFlash - dt);
  g.flash = Math.max(0, g.flash - dt * 2.2);
  if (g.polaroid) {
    g.polaroid.life -= dt;
    if (g.polaroid.life <= 0) g.polaroid = null;
  }
  if (g.message) {
    g.message.life -= dt;
    if (g.message.life <= 0) g.message = null;
  }
}
