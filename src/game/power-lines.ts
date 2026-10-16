// In the city, some obstacle slots become power lines instead of buildings:
// poles with sagging wires. Touching a wire zaps the bird; pigeons sitting on
// the wires are targets (and some turn out to be drones).

import { config, ramp } from "../config";
import { burst, splatParticles } from "./effects";
import type { Game } from "./game";
import type { Poop } from "./poops";
import { GROUND_Y, type Rect } from "./world";

/**
 * A run of wooden poles (city) with wires sagging between them. Poles stand
 * `span` px apart; every wire hangs from all poles at the same height.
 */
export interface PowerLine {
  /** Screen x of the first pole. */
  x: number;
  span: number;
  poles: number;
  /** Height of the pole tops (above the top wire). */
  topY: number;
  /** Top wire first: attach height at the poles, and the sag of each span. */
  wires: { y: number; sags: number[] }[];
  pigeons: Pigeon[];
  seed: number;
}

export interface Pigeon {
  wire: number;
  span: number;
  /** 0..1 along the span. */
  t: number;
  facing: 1 | -1;
  seed: number;
  /** Seconds of a startled hop (a neighbour got hit). */
  startle: number;
  /** Set once it's hit: it flies off, splattered (screen space). */
  flyer: { x: number; y: number; vx: number; vy: number } | null;
  /** Set when a hit downs it instead: it was a surveillance drone all along. */
  wreck: DroneWreck | null;
}

/** A downed pigeon drone: it tumbles off its wire, then lies broken on the street, sparking. */
export interface DroneWreck {
  /** Screen space; y is the street once it's landed. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  /** Seconds since it hit the street, or -1 while it's still falling. */
  landed: number;
}

export const ZAP_MESSAGES = [
  "ZZZAP!",
  "Shocking!",
  "Extra crispy",
  "Fried chicken… almost",
  "Watt were you thinking?",
  "Current situation: bad",
];

/** Wire half-thickness for collisions (the bird's hit radius is added). */
const WIRE_HIT = 2;
/** Pigeon hit radius for poops. */
export const PIGEON_R = 16;

export function poleX(l: PowerLine, i: number): number {
  return l.x + i * l.span;
}

/** A pole's collision rectangle (also its drawn trunk). */
export function poleRect(l: PowerLine, i: number): Rect {
  return { x: poleX(l, i) - 6, y: l.topY, w: 12, h: GROUND_Y - l.topY };
}

/** Height and slope of wire `w` at screen x, or null outside the line. Spans sag as parabolas. */
export function wireAt(l: PowerLine, w: number, x: number): { y: number; slope: number } | null {
  const rel = x - l.x;
  const last = l.poles - 1;
  if (rel < 0 || rel > l.span * last) return null;
  const s = Math.min(last - 1, Math.floor(rel / l.span));
  const t = (rel - s * l.span) / l.span;
  const wire = l.wires[w];
  const sag = wire.sags[s];
  return { y: wire.y + 4 * sag * t * (1 - t), slope: (4 * sag * (1 - 2 * t)) / l.span };
}

/** Where a sitting pigeon's feet touch its wire. */
export function pigeonPos(l: PowerLine, p: Pigeon): { x: number; y: number } {
  const wire = l.wires[p.wire];
  return { x: l.x + (p.span + p.t) * l.span, y: wire.y + 4 * wire.sags[p.span] * p.t * (1 - p.t) };
}

export function powerLinesAllowed(g: Game): boolean {
  return g.cityStage >= Math.round(config.powerLineFirstCity);
}

export function touchesWire(g: Game): boolean {
  const { x, y } = g.bird;
  const r = g.hitRadius;
  for (const l of g.powerLines) {
    for (let w = 0; w < l.wires.length; w++) {
      const wire = wireAt(l, w, x);
      if (!wire) continue;
      // Distance to the wire, measured perpendicular to its slope.
      const dist = Math.abs(y - wire.y) / Math.sqrt(1 + wire.slope * wire.slope);
      if (dist < r + WIRE_HIT) return true;
    }
  }
  return false;
}

/** Spawns a power line just off-screen. Returns its length (first to last pole). */
export function spawnPowerLine(g: Game): number {
  const first = Math.round(config.powerLineFirstCity);
  const d = g.stageLevel(first);
  const poles = 3 + Math.floor(Math.random() * 3);
  const span = config.powerLineSpan * (0.9 + Math.random() * 0.2);
  const r = Math.random();
  // The wires stack up (and the top one climbs higher) city by city: one wire, then one or two, then two or three.
  const later = g.cityStage - first;
  const count = later <= 0 ? 1 : later === 1 ? (r < 0.4 ? 1 : 2) : r < 0.5 ? 2 : 3;
  // Room to fly over the pole tops and under the lowest wire, even where it
  // sags most: stacked wires squeeze closer together if they'd go too high.
  const highestTop = 160;
  const lowestMax = 370;
  const gap = count > 1
    ? Math.min(ramp(config.powerLineWireGap, config.powerLineWireGapMin, d), (lowestMax - highestTop) / (count - 1))
    : 0;
  const lowestMin = Math.max(250, highestTop + (count - 1) * gap);
  const lowest = lowestMin + Math.random() * (lowestMax - lowestMin);
  const wires = Array.from({ length: count }, (_, i) => ({
    y: lowest - (count - 1 - i) * gap,
    sags: Array.from({ length: poles - 1 }, () => config.powerLineSag * (0.7 + Math.random() * 0.6)),
  }));
  const line: PowerLine = {
    x: g.width + 60, span, poles, topY: wires[0].y - 16, wires, pigeons: [], seed: Math.random() * 1000,
  };
  // Pigeons, spread out along the spans.
  for (let s = 0; s < poles - 1; s++) {
    const n = Math.floor(config.pigeonsPerSpan + Math.random());
    const taken: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = 0.15 + Math.random() * 0.7;
      if (taken.some((u) => Math.abs(u - t) < 0.12)) continue;
      taken.push(t);
      line.pigeons.push({
        wire: Math.floor(Math.random() * count), span: s, t,
        facing: Math.random() < 0.5 ? 1 : -1, seed: Math.random() * 1000, startle: 0, flyer: null, wreck: null,
      });
    }
  }
  g.powerLines.push(line);
  return span * (poles - 1);
}

export function updatePowerLines(g: Game, dt: number, speed: number): void {
  for (const l of g.powerLines) {
    l.x -= speed * dt;
    for (const p of l.pigeons) {
      p.startle = Math.max(0, p.startle - dt);
      if (p.wreck) updateWreck(g, p.wreck, dt, speed);
      const f = p.flyer;
      if (!f) continue;
      // Flies off forward and up, flapping harder as it goes.
      f.vy -= 120 * dt;
      f.x += (f.vx - speed) * dt;
      f.y += f.vy * dt;
    }
  }
  g.powerLines = g.powerLines.filter((l) => l.x + l.span * (l.poles - 1) > -80);
}

function updateWreck(g: Game, w: DroneWreck, dt: number, speed: number): void {
  if (w.landed < 0) {
    w.vy += 900 * dt;
    w.x += (w.vx - speed) * dt;
    w.y += w.vy * dt;
    w.rot += w.spin * dt;
    // Trails smoke and sparks on the way down.
    if (Math.random() < dt * 40) {
      const spark = Math.random() < 0.5;
      g.particles.push({
        x: w.x + (Math.random() - 0.5) * 10, y: w.y - 14, vx: (Math.random() - 0.5) * 60, vy: spark ? -80 : -30,
        life: 0.5, maxLife: 0.5, size: spark ? 1.5 : 3 + Math.random() * 3, color: spark ? "#fff3b0" : "#6c757d",
        gravity: spark ? 400 : -60, world: true,
      });
    }
    if (w.y < GROUND_Y - 2) return;
    w.y = GROUND_Y - 2;
    w.landed = 0;
    crashDrone(g, w);
    return;
  }
  w.x -= speed * dt;
  w.landed += dt;
  // The exposed wires keep shorting out.
  if (Math.random() < dt * 4) {
    burst(g, w.x + 2, w.y - 14, 4, {
      angle: [-Math.PI * 0.2, -Math.PI * 0.8], speed: 120, life: 0.3, maxLife: 0.3, size: [1.2, 2.2], color: ["#fff3b0", "#9bf6ff"], gravity: 600,
    });
  }
}

/** A falling drone hits the street: it breaks open in a shower of sparks and parts. */
function crashDrone(g: Game, w: DroneWreck): void {
  g.shakeAtLeast(6);
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI * Math.random();
    const s = 80 + Math.random() * 220;
    const part = i % 3 === 0;
    g.particles.push({
      x: w.x, y: w.y - 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.4 + Math.random() * 0.5, maxLife: 0.9, size: part ? 2 + Math.random() * 2 : 1.2 + Math.random() * 1.3,
      color: part ? (Math.random() < 0.5 ? "#2d6a4f" : "#adb5bd") : Math.random() < 0.6 ? "#fff3b0" : "#9bf6ff",
      gravity: 800, world: true,
    });
  }
  g.floater(w.x, w.y - 60, "BIRDS AREN'T REAL!", "#9bf6ff", 22, 1.6);
  g.events.push({ type: "droneCrashed" });
}

/** Returns true if the poop hit a pigeon. */
export function poopHitsPigeon(g: Game, p: Poop): boolean {
  for (const l of g.powerLines) {
    for (const pg of l.pigeons) {
      if (pg.flyer || pg.wreck) continue;
      const pos = pigeonPos(l, pg);
      const dx = p.x - pos.x;
      const dy = p.y - (pos.y - PIGEON_R);
      const reach = p.r + PIGEON_R;
      if (dx * dx + dy * dy >= reach * reach) continue;
      if (Math.random() < config.droneChance) {
        const spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
        pg.wreck = { x: pos.x, y: pos.y, vx: 20 + Math.random() * 40, vy: -120, rot: 0, spin, landed: -1 };
        g.events.push({ type: "droneDown" });
      } else {
        pg.flyer = { x: pos.x, y: pos.y, vx: 40 + Math.random() * 80, vy: -140 };
      }
      for (const other of l.pigeons) if (other !== pg && other.span === pg.span && !other.flyer && !other.wreck) other.startle = 0.35;
      const points = g.scoreHit(config.pigeonMultiplier, p.big ? 2 : 1);
      g.floater(pos.x, pos.y - 40, g.scoreLabel(points), "#ffe14d", 26, 1.1);
      splatParticles(g, p.x, p.y, p.r, true);
      g.events.push({ type: "hit", points, combo: g.combo, kind: "pigeon" });
      g.events.push({ type: "splat", big: p.big });
      return true;
    }
  }
  return false;
}
