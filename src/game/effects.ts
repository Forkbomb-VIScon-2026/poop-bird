// Cosmetic effects: particles, decals, score floaters and screen splats, and the bursts that spawn them.

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

export function bubbleAt(g: Game, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    g.particles.push({
      x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 40,
      life: 0.6 + Math.random() * 0.5, maxLife: 1.1, size: 2 + Math.random() * 4,
      color: "#e0fbfc", gravity: -120, world: true,
    });
  }
}

/** Bubbles and spray where the bobber or something small hits the surface. */
export function ripple(g: Game, x: number, n: number): void {
  for (let i = 0; i < n; i++) {
    g.particles.push({
      x: x + (Math.random() - 0.5) * 10, y: SURFACE_Y + 4,
      vx: (Math.random() - 0.5) * 50, vy: 20 + Math.random() * 50,
      life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 2 + Math.random() * 3,
      color: "#e0fbfc", gravity: -160, world: true,
    });
  }
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
      color: Math.random() < 0.5 ? "#caf0f8" : "#ffffff", gravity: 900, world: true,
    });
  }
}

/** A trail of bubbles behind the bird or fish while it moves under water. */
export function bubbleTrail(g: Game, dt: number, rate: number): void {
  const b = g.bird;
  if (Math.random() > dt * rate) return;
  g.particles.push({
    x: b.x + (Math.random() - 0.5) * 20, y: b.y + (Math.random() - 0.5) * 20,
    vx: (Math.random() - 0.5) * 40, vy: -40 - Math.random() * 60,
    life: 0.6 + Math.random() * 0.6, maxLife: 1.2, size: 2 + Math.random() * 4,
    color: Math.random() < 0.6 ? "#e0fbfc" : "#a8dadc", gravity: -120, world: true,
  });
}

export function splatParticles(g: Game, x: number, y: number, r: number, hit: boolean): void {
  const n = 8 + Math.round(r);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * Math.random();
    const s = 60 + Math.random() * 160;
    g.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.3, maxLife: 0.7, size: 2 + Math.random() * 3,
      color: hit && Math.random() < 0.3 ? "#ffe14d" : "#6b3e14", gravity: 700, world: true,
    });
  }
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
