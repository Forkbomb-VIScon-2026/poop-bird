// Some city obstacle slots become a hot-air balloon instead. Flying through
// (or pooping on) the envelope pops it: a gust of hot air lifts the bird, the
// basket drops, and the passengers bail out under parachutes, drifting down
// as targets. The basket is solid: flying into it ends the run. Slipping
// through the ropes between envelope and basket untouched pays a bonus.

import { config } from "../config";
import { pick } from "../random";
import { burst, splatParticles } from "./effects";
import type { Game } from "./game";
import type { Poop } from "./poops";
import { makeTarget, PERSON_COLORS, type Target } from "./street";
import { circleRect, GROUND_Y, type Rect } from "./world";

/**
 * A hot-air balloon (city). The envelope bobs around `baseY` until it pops;
 * then the basket drops to the street and the envelope flutters down as a rag.
 */
export interface Balloon {
  /** Screen x of the centre line. */
  x: number;
  /** Centre of the envelope. */
  y: number;
  baseY: number;
  phase: number;
  /** Envelope gores: main colour, stripe colour. */
  colors: [string, string];
  passengers: { color: string; seed: number }[];
  seed: number;
  popped: boolean;
  /** Set once the balloon has passed the bird (the thread-the-ropes check ran). */
  passed: boolean;
  /** After the pop: how far the basket has dropped, its fall speed, and whether it hit the street. */
  drop: number;
  dropV: number;
  landed: boolean;
  /** The deflated envelope fluttering down after the pop (screen space). */
  rag: { x: number; y: number; vy: number; landed: boolean } | null;
  /** Seconds left of the burner's blast, and until the next one. */
  burn: number;
  nextBurn: number;
}

/** A balloon passenger who bailed out: tumbling, then drifting down under a canopy. */
export interface Chute {
  open: boolean;
  /** Seconds since bailing out. */
  t: number;
  /** When the canopy opens (seconds since bailing out). */
  openAt: number;
  vy: number;
  canopy: string;
}

const BASKET_MESSAGES = ["BASKET CASE!", "Wrong end of the balloon", "Wicker 1, Bird 0", "Hot air, hard landing", "Passengers: unharmed"];

const BALLOON_COLORS: [string, string][] = [
  ["#e63946", "#ffd166"],
  ["#3a86ff", "#ffffff"],
  ["#8338ec", "#ffbe0b"],
  ["#06d6a0", "#ef476f"],
  ["#ff7f50", "#2a9d8f"],
];

const CHUTE_COLORS = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#f78c6b"];

/** Balloon envelope half-width and half-height (its centre is Balloon.x, .y). */
export const BALLOON_RX = 60;
export const BALLOON_RY = 70;
/** Gap between the bottom of the envelope and the top of the basket (the ropes). */
export const BALLOON_ROPES = 56;
export const BASKET_W = 50;
export const BASKET_H = 32;

/** The basket's collision rectangle (also its drawn body). */
export function basketRect(b: Balloon): Rect {
  return { x: b.x - BASKET_W / 2, y: b.y + BALLOON_RY + BALLOON_ROPES + b.drop, w: BASKET_W, h: BASKET_H };
}

/** True if a circle of radius `pad` at (x, y) touches the envelope (an ellipse). */
function inEnvelope(b: Balloon, x: number, y: number, pad: number): boolean {
  const dx = (x - b.x) / (BALLOON_RX + pad);
  const dy = (y - b.y) / (BALLOON_RY + pad);
  return dx * dx + dy * dy < 1;
}

/** Spawns a balloon just off-screen. Returns the extra room it needs (it's wide and drifts forward). */
export function spawnBalloon(g: Game): number {
  const n = 2 + (Math.random() < 0.5 ? 1 : 0);
  const baseY = 100 + Math.random() * 140;
  g.balloons.push({
    x: g.width + BALLOON_RX + 30, y: baseY, baseY, phase: Math.random() * Math.PI * 2,
    colors: pick(BALLOON_COLORS),
    passengers: Array.from({ length: n }, () => ({ color: pick(PERSON_COLORS), seed: Math.random() * 1000 })),
    seed: Math.random() * 1000,
    popped: false, passed: false, drop: 0, dropV: 0, landed: false, rag: null,
    burn: 0, nextBurn: 0.4 + Math.random(),
  });
  return 180;
}

export function updateBalloons(g: Game, dt: number, speed: number): void {
  const drift = config.balloonDrift;
  for (const b of g.balloons) {
    b.x -= (speed - (b.landed ? 0 : drift)) * dt;
    if (!b.popped) {
      b.y = b.baseY + Math.sin(g.time * 0.9 + b.phase) * 10;
      // Now and then the pilot fires the burner.
      b.burn = Math.max(0, b.burn - dt);
      b.nextBurn -= dt;
      if (b.nextBurn <= 0) {
        b.burn = 0.6;
        b.nextBurn = 2.2 + Math.random() * 2;
        if (b.x > 0 && b.x < g.width && g.phase === "playing") g.events.push({ type: "burner" });
      }
    } else if (!b.landed) {
      b.dropV += 1100 * dt;
      b.drop += b.dropV * dt;
      const r = basketRect(b);
      const floor = GROUND_Y + 24;
      if (r.y + r.h >= floor) {
        b.drop -= r.y + r.h - floor;
        b.landed = true;
        basketLanded(g, b);
      }
    }
    const rag = b.rag;
    if (rag) {
      rag.x -= (speed - (rag.landed ? 0 : drift * 0.5)) * dt;
      if (!rag.landed) {
        rag.vy = Math.min(110, rag.vy + 300 * dt);
        rag.y += rag.vy * dt;
        if (rag.y >= GROUND_Y + 14) {
          rag.y = GROUND_Y + 14;
          rag.landed = true;
        }
      }
    }
  }
  g.balloons = g.balloons.filter((b) => b.x > -160 || (b.rag && b.rag.x > -160));
  if (g.phase !== "playing" || g.stage !== "city" || g.transition) return;

  const bird = g.bird;
  const r = g.hitRadius;
  for (const b of g.balloons) {
    // The envelope is soft (generous hitbox: popping is the good outcome); the basket is not.
    if (!b.popped && inEnvelope(b, bird.x, bird.y, r * 0.6)) popBalloon(g, b, true);
    if (circleRect(bird.x, bird.y, r, basketRect(b))) {
      basketCrash(g);
      return;
    }
    if (!b.passed && b.x <= bird.x) {
      b.passed = true;
      // Slipped between the envelope and the basket without touching either.
      if (!b.popped && bird.y > b.y + BALLOON_RY && bird.y < basketRect(b).y) threaded(g);
    }
  }
}

function popBalloon(g: Game, b: Balloon, byBird: boolean): void {
  b.popped = true;
  b.dropV = -30;
  b.rag = { x: b.x, y: b.y + BALLOON_RY * 0.3, vy: -40, landed: false };
  g.balloonsPopped++;
  const points = g.scoreHit(config.balloonPopMultiplier);
  g.shakeAtLeast(9);
  g.floater(b.x, b.y - 20, "POP!", "#fff", 46, 0.9);
  g.floater(b.x, b.y + 22, g.scoreLabel(points), "#ffe14d", 26, 1.2);
  // Shreds of envelope.
  for (let i = 0; i < 44; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random());
    const s = 120 + Math.random() * 280;
    g.particles.push({
      x: b.x + Math.cos(a) * BALLOON_RX * d, y: b.y + Math.sin(a) * BALLOON_RY * d,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
      life: 0.6 + Math.random() * 0.6, maxLife: 1.2, size: 3 + Math.random() * 5,
      color: b.colors[i % 2], gravity: 500, world: true,
    });
  }
  // The hot air escapes upward.
  burst(g, b.x, b.y, 16, {
    spread: [BALLOON_RX, BALLOON_RY], vx: [-30, 30], vy: [-80, -200], life: [0.7, 1.2], maxLife: 1.2, size: [8, 18],
    color: "rgba(255,190,110,0.35)", gravity: -80,
  });
  // Everyone out!
  const basket = basketRect(b);
  const n = b.passengers.length;
  b.passengers.forEach((p, i) => {
    const off = i - (n - 1) / 2;
    const x = b.x + off * 12;
    g.targets.push(makeTarget({
      x, y: basket.y + 10, w: 26, h: 46, kind: "parachutist",
      speed: g.speed * config.balloonChuteWind + off * 45,
      color: p.color, seed: p.seed, facing: off < 0 ? -1 : 1,
      chute: { open: false, t: 0, openAt: 0.3 + i * 0.18 + Math.random() * 0.1, vy: -170 - Math.random() * 60, canopy: pick(CHUTE_COLORS) },
    }));
    g.floater(x + off * 20, basket.y - 30 - i * 14, "AAAH!", "#fff", 16, 0.9);
  });
  b.passengers = [];
  if (byBird) {
    // A free ride on the escaping hot air.
    const bird = g.bird;
    bird.vy = Math.min(bird.vy, -config.balloonLift);
    bird.stretchV += 8;
    bird.flap = 0.35;
    g.floater(bird.x, bird.y - 44, "HOT AIR!", "#ffb703", 22, 0.9);
  }
  g.events.push({ type: "balloonPop", points, combo: g.combo });
}

function basketLanded(g: Game, b: Balloon): void {
  const r = basketRect(b);
  g.shakeAtLeast(6);
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI * Math.random();
    const s = 60 + Math.random() * 160;
    g.particles.push({
      x: r.x + Math.random() * r.w, y: r.y + r.h,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6,
      life: 0.4 + Math.random() * 0.4, maxLife: 0.8, size: 3 + Math.random() * 5,
      color: Math.random() < 0.5 ? "rgba(200,190,170,0.7)" : "#a0703f", gravity: 400, world: true,
    });
  }
  if (b.x > -40 && b.x < g.width + 40) g.events.push({ type: "basketLanded" });
}

/** Flew into a basket: wicker everywhere, run over. */
function basketCrash(g: Game): void {
  g.crash();
  g.say(BASKET_MESSAGES);
  burst(g, g.bird.x, g.bird.y, 20, {
    speed: [100, 320], lift: -80, life: [0.6, 1], maxLife: 1, size: [2, 5], color: ["#c68b59", "#8b5a2b"], gravity: 700,
  });
}

function threaded(g: Game): void {
  const points = Math.round(config.targetPoints * config.balloonThreadMultiplier);
  g.bonus += points;
  const b = g.bird;
  g.floater(b.x, b.y - 50, "THREADED IT!", "#7ae582", 26, 1.3);
  g.floater(b.x, b.y - 22, `+${points}`, "#ffe14d", 22, 1.1);
  g.events.push({ type: "threaded", points });
}

/** Returns true if the poop hit a balloon (popping the envelope, or splatting the basket). */
export function poopHitsBalloon(g: Game, p: Poop): boolean {
  for (const b of g.balloons) {
    if (!b.popped && inEnvelope(b, p.x, p.y, p.r)) {
      popBalloon(g, b, false);
      splatParticles(g, p.x, p.y, p.r, true);
      g.events.push({ type: "splat", big: p.big });
      return true;
    }
    if (circleRect(p.x, p.y, p.r, basketRect(b))) {
      splatParticles(g, p.x, p.y, p.r, false);
      g.events.push({ type: "splat", big: p.big });
      return true;
    }
  }
  return false;
}

/** A bailed-out passenger: tumbles, pops the canopy, drifts down, then walks off as a pedestrian. */
export function updateParachutist(g: Game, t: Target, dt: number, speed: number): void {
  const c = t.chute!;
  c.t += dt;
  if (!c.open) {
    c.vy += 900 * dt;
    if (c.t >= c.openAt || t.y > GROUND_Y - 170) {
      c.open = true;
      t.w = 50;
      t.h = 100;
      g.events.push({ type: "chuteOpen" });
    }
  } else {
    c.vy += (config.balloonChuteFall - c.vy) * Math.min(1, dt * 5);
    // The wind carries them along under the bird, so there's time to aim.
    const spread = ((t.seed % 1) - 0.5) * 30;
    t.speed += (speed * config.balloonChuteWind + spread - t.speed) * Math.min(1, dt * 1.5);
  }
  t.y += c.vy * dt;
  if (t.y < GROUND_Y + 20) return;
  // Touchdown.
  const dir = Math.random() < 0.5 ? 1 : -1;
  t.y = GROUND_Y + 20;
  t.kind = "pedestrian";
  t.chute = null;
  t.w = 24;
  t.h = 52;
  t.splats = t.splats.filter((s) => s.dy > -t.h);
  t.speed = dir * (18 + Math.random() * 30);
  t.facing = dir;
}
