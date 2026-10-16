// Slingshot kids walk on along the sidewalk, plant their feet and take aim at
// the bird (a dotted arc shows where). A pebble that hits bonks the bird: it
// tumbles, stunned, and loses its charge and combo. Buildings block pebbles,
// a falling poop can shoot one down mid-air, and splatting the kid before he
// lets go disarms him.

import { config, ramp } from "../config";
import { pick } from "../random";
import { burst } from "./effects";
import type { Game } from "./game";
import { obstacleRects } from "./obstacles";
import type { Poop } from "./poops";
import { PIGEON_R, pigeonPos, poleRect } from "./power-lines";
import { makeTarget, PERSON_COLORS, type Target } from "./street";
import { weddingAhead } from "./wedding";
import { BIRD_RADIUS, circleRect, GROUND_Y, type Rect } from "./world";

/**
 * A slingshot kid's state. Walking: trotting toward the bird. Aiming: feet
 * planted, pulling the band back while tracking the bird; fires when `pull`
 * reaches 1. Reloading: a beat between shots. Taunting: out of shots or the
 * bird got past. Cheering: a pebble bonked the bird. Crying: a poop got him.
 */
export type KidState = "walking" | "aiming" | "reloading" | "taunting" | "cheering" | "crying";

export interface Kid {
  state: KidState;
  /** Seconds in the current state. */
  t: number;
  /** 0..1 how far the band is pulled back while aiming. */
  pull: number;
  /** Seconds the current wind-up takes. */
  windup: number;
  shots: number;
  /** Launch velocity of the next pebble (screen space, px/s), tracked while aiming. */
  aimVx: number;
  aimVy: number;
  /** Seconds of the band's snap-back after a shot. */
  twang: number;
}

/** A slingshot pebble, in screen space. */
export interface Pebble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** Closest it came to the bird so far (for the "close one" bonus). */
  closest: number;
  /** Set once it has paid the "close one" bonus (at most once per pebble). */
  dodged: boolean;
  /** The kid who shot it. */
  from: Target;
}

const BONK_MESSAGES = ["BONK!", "Right in the beak!", "Headshot!", "Ow ow ow", "Seeing stars", "Little brat!"];

/** Pebble radius (drawn and for collisions). */
export const PEBBLE_R = 5;
/** A kid stops shooting once he's this close to (or behind) the bird. */
const KID_MIN_AHEAD = 70;

/** Where a kid's slingshot pouch sits (the pebble's launch point). */
export function slingshotPos(t: Target): { x: number; y: number } {
  return { x: t.x + t.facing * 17, y: t.y - t.h * 0.64 };
}

/** True while a kid can still shoot (not crying, taunting or out of shots). */
export function kidArmed(t: Target): boolean {
  const k = t.kid;
  return !!k && (k.state === "walking" || k.state === "aiming" || (k.state === "reloading" && k.shots > 0));
}

export function kidDue(g: Game): boolean {
  return (
    !g.gateSpawned &&
    g.cityStage >= Math.round(config.kidFirstCity) &&
    g.distance >= config.kidMinDistance &&
    g.distance - g.lastKidAt >= config.kidMinGap &&
    !g.targets.some(kidArmed) &&
    !g.targets.some((t) => t.pap?.state === "watching") &&
    !weddingAhead(g)
  );
}

export function spawnKid(g: Game): void {
  g.lastKidAt = g.distance;
  // One shot in the first city with kids, one more in each city after.
  const later = Math.max(0, g.cityStage - Math.round(config.kidFirstCity));
  g.targets.push(makeTarget({
    x: g.width + 40, y: GROUND_Y + 20, w: 34, h: 62, kind: "kid", speed: -config.kidWalkSpeed,
    color: pick(PERSON_COLORS), seed: Math.random() * 1000, facing: -1,
    kid: {
      state: "walking", t: 0, pull: 0, windup: 1,
      shots: Math.min(Math.max(1, Math.round(config.kidShotsMax)), 1 + later),
      aimVx: 0, aimVy: 0, twang: 0,
    },
  }));
}

function setKidState(t: Target, state: KidState): void {
  const k = t.kid!;
  k.state = state;
  k.t = 0;
  k.pull = 0;
}

export function updateKid(g: Game, t: Target, dt: number): void {
  const k = t.kid!;
  k.t += dt;
  k.twang = Math.max(0, k.twang - dt);
  const ahead = t.x - g.bird.x;
  if (g.phase !== "playing") {
    // The bird's going down: whoever still had shots left is thrilled.
    if (k.state === "aiming" || k.state === "reloading" || k.state === "walking") {
      t.speed = 0;
      setKidState(t, "cheering");
    }
    return;
  }
  switch (k.state) {
    case "walking":
      // Plants his feet once he's on screen, in range and has a clear shot.
      if (ahead < KID_MIN_AHEAD) setKidState(t, "taunting");
      else if (ahead < config.kidRange && t.x < g.width - 30 && !kidCovered(g, t)) {
        t.speed = 0;
        startAim(g, t);
      }
      break;
    case "aiming":
      if (ahead < KID_MIN_AHEAD) {
        setKidState(t, "taunting");
        break;
      }
      aimKid(g, t);
      k.pull = Math.min(1, k.t / k.windup);
      if (k.pull >= 1) fireKid(g, t);
      break;
    case "reloading":
      if (k.t < 0.45) break;
      if (k.shots <= 0 || ahead < KID_MIN_AHEAD + 60) {
        t.speed = 0;
        setKidState(t, "taunting");
      } else if (kidCovered(g, t)) {
        t.speed = -config.kidWalkSpeed; // steps out from behind the building
      } else {
        t.speed = 0;
        startAim(g, t);
      }
      break;
    case "cheering":
      // A little victory dance, then back to it if he has pebbles left.
      if (k.t > 1.1) setKidState(t, "reloading");
      break;
    case "taunting":
    case "crying":
      break;
  }
}

/** True if a building or pole is in front of his slingshot (he'd only hit the wall). */
function kidCovered(g: Game, t: Target): boolean {
  const s = slingshotPos(t);
  for (const o of g.obstacles) for (const r of obstacleRects(o)) if (circleRect(s.x, s.y, 14, r)) return true;
  for (const l of g.powerLines) for (let i = 0; i < l.poles; i++) if (circleRect(s.x, s.y, 14, poleRect(l, i))) return true;
  return false;
}

function startAim(g: Game, t: Target): void {
  const k = t.kid!;
  setKidState(t, "aiming");
  k.windup = ramp(config.kidWindup, config.kidWindupMin, g.stageLevel(Math.round(config.kidFirstCity)));
  aimKid(g, t);
  g.events.push({ type: "slingshotDraw", windup: k.windup });
}

/**
 * Aims a lob that reaches the bird (plus a bit of lead along its current
 * vertical speed) after the flight time: plain projectile maths.
 */
function aimKid(g: Game, t: Target): void {
  const k = t.kid!;
  const T = Math.max(0.2, ramp(config.kidFlightTime, config.kidFlightTimeMin, g.stageLevel(Math.round(config.kidFirstCity))));
  const s = slingshotPos(t);
  const b = g.bird;
  const ty = Math.max(BIRD_RADIUS, Math.min(GROUND_Y - 40, b.y + b.vy * T * config.kidLead));
  k.aimVx = (b.x - s.x) / T;
  k.aimVy = (ty - s.y) / T - 0.5 * config.kidPebbleGravity * T;
}

function fireKid(g: Game, t: Target): void {
  const k = t.kid!;
  const s = slingshotPos(t);
  g.pebbles.push({ x: s.x, y: s.y, vx: k.aimVx, vy: k.aimVy, rot: 0, closest: Infinity, dodged: false, from: t });
  k.shots--;
  setKidState(t, "reloading");
  k.twang = 0.3;
  g.events.push({ type: "slingshotFire" });
}

/** A poop got him while he was armed: he drops the slingshot and runs off crying. */
export function disarmKid(g: Game, t: Target): void {
  g.kidsDisarmed++;
  setKidState(t, "crying");
  t.speed = config.kidWalkSpeed * 3;
  t.facing = 1;
  g.floater(t.x, t.y - t.h - 44, "DISARMED!", "#7ae582", 24, 1.3);
  g.events.push({ type: "kidCried" });
}

export function updatePebbles(g: Game, dt: number): void {
  const grav = config.kidPebbleGravity;
  const keep: Pebble[] = [];
  for (const p of g.pebbles) {
    p.vy += grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += dt * 14;
    if (pebbleHits(g, p)) continue;
    if (p.y > GROUND_Y + 80 || p.x < -60 || p.x > g.width + 160 || p.y < -600) continue;
    keep.push(p);
  }
  g.pebbles = keep;
}

/** Returns true if the pebble is used up. */
function pebbleHits(g: Game, p: Pebble): boolean {
  // A falling poop shoots it down.
  for (let i = 0; i < g.poops.length; i++) {
    const poop = g.poops[i];
    const reach = poop.r + PEBBLE_R + 6;
    if ((poop.x - p.x) ** 2 + (poop.y - p.y) ** 2 >= reach * reach) continue;
    g.poops.splice(i, 1);
    shootDownPebble(g, p, poop);
    return true;
  }
  const b = g.bird;
  const playing = g.phase === "playing" && g.stage === "city" && !g.transition;
  if (playing) {
    const dist = Math.hypot(p.x - b.x, p.y - b.y);
    if (dist < g.hitRadius + PEBBLE_R) {
      bonk(g, p);
      return true;
    }
    p.closest = Math.min(p.closest, dist);
    // Dodged it by a whisker.
    if (!p.dodged && p.x < b.x - 30 && p.closest < g.hitRadius + PEBBLE_R + 28) {
      p.dodged = true;
      g.bonus += Math.round(config.targetPoints * 0.5);
      g.floater(b.x, b.y - 46, "CLOSE ONE!", "#bde0fe", 20, 0.9);
    }
  }
  // Buildings and poles are cover: it pings off.
  const rects: Rect[] = [];
  for (const o of g.obstacles) if (Math.abs(o.x + o.w / 2 - p.x) < o.w) rects.push(...obstacleRects(o));
  for (const l of g.powerLines) for (let i = 0; i < l.poles; i++) rects.push(poleRect(l, i));
  for (const r of rects) {
    if (!circleRect(p.x, p.y, PEBBLE_R, r)) continue;
    // Sparks, thrown back the way it came.
    burst(g, p.x, p.y, 8, {
      speed: 160, drift: -p.vx * 0.2, life: 0.25, maxLife: 0.25, size: [1.5, 3], color: ["#fff3b0", "#adb5bd"], gravity: 500, world: false,
    });
    g.events.push({ type: "ricochet" });
    return true;
  }
  // Sitting pigeons get knocked off their wire (no points for the kid).
  for (const l of g.powerLines) {
    for (const pg of l.pigeons) {
      if (pg.flyer || pg.wreck) continue;
      const pos = pigeonPos(l, pg);
      const reach = PEBBLE_R + PIGEON_R;
      if ((pos.x - p.x) ** 2 + (pos.y - PIGEON_R - p.y) ** 2 >= reach * reach) continue;
      pg.flyer = { x: pos.x, y: pos.y, vx: 60 + Math.random() * 60, vy: -160 };
      g.floater(pos.x, pos.y - 40, "COO!", "#fff", 18, 0.8);
      g.events.push({ type: "ricochet" });
      return true;
    }
  }
  return false;
}

function shootDownPebble(g: Game, p: Pebble, poop: Poop): void {
  g.pebblesShot++;
  const points = g.scoreHit(config.kidParryMultiplier);
  g.shakeAtLeast(7);
  const x = (p.x + poop.x) / 2;
  const y = (p.y + poop.y) / 2;
  g.floater(x, y - 30, "INTERCEPTED!", "#7ae582", 26, 1.2);
  g.floater(x, y - 2, `+${points}`, "#ffe14d", 22, 1.1);
  // A mid-air burst of poop and gravel.
  burst(g, x, y, 26, {
    speed: [80, 340], lift: -60, life: [0.5, 0.9], maxLife: 0.9, size: [2, 6],
    color: ["#6b3e14", "#8b5a2b", "#ffe14d", "#adb5bd"], gravity: 800,
  });
  g.events.push({ type: "pebbleShot", points, combo: g.combo });
}

/** A pebble got the bird: knocked down, stunned, charge and combo gone. */
function bonk(g: Game, p: Pebble): void {
  const b = g.bird;
  g.bonks++;
  g.charge = { charge: 0, fullHold: 0, stun: config.kidBonkStun, needsRelease: true };
  b.vy = Math.max(b.vy, config.kidKnockback);
  b.stretchV -= 10;
  g.shakeAtLeast(12);
  g.dropCombo(b.x, b.y + 40);
  g.say(BONK_MESSAGES, 1.6);
  // Loose feathers and an impact burst.
  burst(g, b.x, b.y, 12, {
    spread: [20, 20], vx: [-80, 80], drift: p.vx * 0.15, vy: [-60, -180], life: [1, 1.6], maxLife: 1.6, size: [3, 6],
    color: () => (Math.random() < 0.6 ? "#ffd166" : "#fff"), gravity: 160,
  });
  burst(g, p.x, p.y, 10, { speed: 220, life: 0.2, maxLife: 0.2, size: 2.5, color: "#fff", gravity: 0, world: false });
  const kid = p.from.kid;
  if (kid && kid.state !== "crying") {
    p.from.speed = 0;
    setKidState(p.from, "cheering");
  }
  g.events.push({ type: "bonk" });
}
