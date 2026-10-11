// The shark (ocean): its theme starts well before it shows up; it stalks in,
// winds up and lunges. Spiked, the fish sends it fleeing; otherwise it's
// eaten.

import { config } from "../config";
import { pick } from "../random";
import { anglerBusy } from "./angler";
import { bubbleAt } from "./effects";
import type { Game } from "./game";
import { GROUND_Y, SURFACE_Y } from "./world";

/**
 * The shark's state. Stalking: it swims in from ahead, drifting to the fish's
 * depth. Windup: it holds back, jaws open, a "!" over its head. Lunge: it
 * charges, homing on the fish, so swimming away doesn't help: only spikes do.
 * Chomped: it got the fish and swims off with it. Fleeing: it bit into the
 * spines and turns tail. Leaving: it missed (or the run ended) and swims on.
 */
export type SharkState = "stalking" | "windup" | "lunge" | "chomped" | "fleeing" | "leaving";

export interface Shark {
  state: SharkState;
  /** Seconds in the current state. */
  t: number;
  /** Body centre: screen x, ocean y. The nose is SHARK_NOSE ahead along `heading`. */
  x: number;
  y: number;
  /** Screen-space velocity (px/s). */
  vx: number;
  vy: number;
  /** Radians the nose points at (π = left, toward the fish). */
  heading: number;
  /** 0..1 how far the jaws are open. */
  jaw: number;
  /** Seconds to the next note of its two-note theme, and how many it's played. */
  beat: number;
  beats: number;
  seed: number;
}

/** The shark's nose (and jaws) is this far ahead of its body centre. */
export const SHARK_NOSE = 72;

/** Bite radius around the nose. */
const SHARK_JAW_R = 20;

/** Extra room after the shark swims in before the next ocean obstacle, so it attacks in open water. */
const SHARK_ROOM = 340;

/** Seconds before the shark swims in that no new obstacles spawn (the last ones scroll past before it lunges). */
const SHARK_CLEAR_TIME = 3.5;

const SHARK_SPIKED_TEXT = ["OUCH!", "NOT TODAY!", "SPIKY SNACK!", "BITE ME!", "TOO PRICKLY!"];

const CHOMP_MESSAGES = ["CHOMP!", "Snack time", "Should've puffed!", "Fish fingers", "Gulp."];

/** True while the shark is hunting (or about to show up): no jellyfish get in its way. */
export function sharkBusy(g: Game): boolean {
  const s = g.shark?.state;
  return sharkClearing(g) || s === "stalking" || s === "windup" || s === "lunge";
}

/** Seconds into its theme when the shark swims in: it's on screen for `sharkStalkTime`, then winds up, then lunges at `sharkThemeAttack`. */
function sharkSpawnAt(): number {
  return Math.max(0, config.sharkThemeAttack - config.sharkWindup - config.sharkStalkTime);
}

/** The music's playing and the shark is due soon: no new obstacles, so it attacks in open water. */
export function sharkClearing(g: Game): boolean {
  return g.sharkTheme !== null && !g.shark && g.sharkTheme >= sharkSpawnAt() - SHARK_CLEAR_TIME;
}

export function sharkThemeDue(g: Game): boolean {
  return (
    g.sharkPlanned &&
    g.sharkTheme === null &&
    !g.shark &&
    // The fisherman goes first: the shark is the stage's climax.
    !g.anglerPlanned &&
    !anglerBusy(g) &&
    g.stageObstacles >= Math.round(config.sharkSlot)
  );
}

/** The music starts; the shark follows `sharkSpawnAt` seconds later. */
export function startSharkTheme(g: Game): void {
  g.sharkPlanned = false;
  g.sharkTheme = 0;
}

export function updateSharkTheme(g: Game, dt: number): void {
  if (g.sharkTheme === null) return;
  // The clock runs on while dying too, so the music doesn't jump; main.ts stops it at game over.
  g.sharkTheme += dt;
  // The swim lesson (calm water, no spikes) came up before the shark: call it off for now, it comes back later.
  if (!g.shark && g.calmWater) {
    g.sharkTheme = null;
    g.sharkPlanned = true;
    return;
  }
  // The far quay came up first (only a late debug shark): no shark, the music fades.
  if (!g.shark && g.shore?.kind === "exit") {
    g.sharkTheme = null;
    return;
  }
  if (!g.shark && g.sharkTheme >= sharkSpawnAt() && g.swimming && g.angler?.state !== "hooked") spawnShark(g);
}

/** A shark swims in from ahead at the fish's depth. */
function spawnShark(g: Game): void {
  const y = Math.max(SURFACE_Y + 60, Math.min(GROUND_Y - 60, g.bird.y));
  g.shark = {
    state: "stalking", t: 0, x: g.width + 140, y, vx: 0, vy: 0,
    heading: Math.PI, jaw: 0, beat: 0, beats: 0, seed: Math.random() * 1000,
  };
  g.nextObstacleAt = Math.max(g.nextObstacleAt, g.distance + SHARK_ROOM + config.oceanSpacingMin);
}

function setSharkState(s: Shark, state: SharkState): void {
  s.state = state;
  s.t = 0;
}

/** Where the shark's nose (and its bite) is. */
function sharkNose(s: Shark): { x: number; y: number } {
  return { x: s.x + Math.cos(s.heading) * SHARK_NOSE, y: s.y + Math.sin(s.heading) * SHARK_NOSE };
}

export function updateShark(g: Game, dt: number): void {
  const s = g.shark;
  if (!s) return;
  s.t += dt;
  const b = g.bird;
  const hunting = g.phase === "playing" && g.stage === "ocean" && !g.transition && g.angler?.state !== "hooked";
  if (!hunting && (s.state === "stalking" || s.state === "windup" || s.state === "lunge")) {
    // The run ended some other way: it loses interest and swims on.
    setSharkState(s, "leaving");
    s.vx = -220;
    s.vy = 0;
  }
  const turnToward = (target: number, rate: number): void => {
    let d = target - s.heading;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    s.heading += Math.max(-rate * dt, Math.min(rate * dt, d));
  };
  const aimAtFish = (): number => {
    const nose = sharkNose(s);
    return Math.atan2(b.y - nose.y, Math.min(-20, b.x - nose.x));
  };
  const keepInWater = (): void => {
    s.y = Math.max(SURFACE_Y + 34, Math.min(GROUND_Y - 30, s.y));
  };

  // Its theme: low, high, low, high… slow and soft far off, faster and louder
  // as it closes in, fastest through the windup; silent once it lunges.
  if (s.state === "stalking" || s.state === "windup") {
    s.beat -= dt;
    if (s.beat <= 0) {
      const far = sharkNose(s).x - b.x - config.sharkLungeRange;
      const close = s.state === "windup" ? 1 : Math.max(0, Math.min(1, 1 - far / 550));
      s.beat = s.state === "windup" ? 0.13 : 0.55 - 0.33 * close;
      g.events.push({ type: "sharkNote", high: s.beats % 2 === 1, volume: 0.45 + 0.55 * close });
      s.beats++;
    }
  }

  switch (s.state) {
    case "stalking": {
      // Glides in, weaving lazily, drifting toward the fish's depth, timed to
      // reach its lunge range as the music gets to the windup.
      const left = config.sharkThemeAttack - config.sharkWindup - (g.sharkTheme ?? 0);
      const toGo = sharkNose(s).x - b.x - config.sharkLungeRange;
      s.vx = -Math.max(40, Math.min(600, toGo / Math.max(0.3, left)));
      const want = b.y + Math.sin(s.t * 1.7 + s.seed) * 30;
      s.vy = (want - s.y) * 1.4;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      keepInWater();
      turnToward(Math.PI + Math.max(-0.35, Math.min(0.35, s.vy / 300)), 3);
      s.jaw = Math.max(0, s.jaw - dt * 2);
      if (sharkNose(s).x - b.x < config.sharkLungeRange) {
        setSharkState(s, "windup");
        g.events.push({ type: "sharkWindup" });
      }
      break;
    }
    case "windup": {
      // Holds back a little, lines up on the fish and opens wide.
      s.vx = 50;
      s.vy = (b.y - s.y) * 3;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      keepInWater();
      turnToward(aimAtFish(), 5);
      s.jaw = Math.min(1, s.jaw + dt * 3);
      // Lunges on the music's cue (or after the windup, if the clock is gone).
      if (g.sharkTheme !== null ? g.sharkTheme >= config.sharkThemeAttack : s.t >= config.sharkWindup) {
        setSharkState(s, "lunge");
        g.shake = Math.max(g.shake, 4);
        g.events.push({ type: "sharkLunge" });
      }
      break;
    }
    case "lunge": {
      const nose = sharkNose(s);
      // Homes on the fish until it's level with it.
      if (nose.x > b.x) turnToward(aimAtFish(), config.sharkTurnRate);
      const speed = config.sharkLungeSpeed;
      s.vx = Math.cos(s.heading) * speed;
      s.vy = Math.sin(s.heading) * speed;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      keepInWater();
      s.jaw = 1;
      const r = g.hitRadius;
      const n = sharkNose(s);
      const dist = Math.hypot(n.x - b.x, n.y - b.y);
      const spiked = g.spike.spiked;
      const reach = (r + SHARK_JAW_R) * (spiked ? config.sharkSpikeReach : 1);
      if (dist < reach) {
        if (spiked) spikeShark(g, s);
        else chomp(g, s);
      } else if (n.x < b.x - r - 40) {
        setSharkState(s, "leaving");
      }
      break;
    }
    case "chomped":
      // Swims off with its meal, jaws shut, a burp of bubbles now and then.
      s.vx = -260;
      s.vy = Math.sin(s.t * 3) * 30;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      keepInWater();
      turnToward(Math.PI, 4);
      s.jaw = Math.max(0, s.jaw - dt * 8);
      if (Math.random() < dt * 6) bubbleAt(g, sharkNose(s).x, s.y - 6, 2);
      break;
    case "fleeing":
      // Turns tail and bolts off ahead, diving away.
      turnToward(0.35, 7);
      s.vx += (420 - s.vx) * Math.min(1, dt * 3);
      s.vy += (90 - s.vy) * Math.min(1, dt * 3);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.y = Math.min(GROUND_Y + 60, s.y);
      s.jaw = Math.max(0, s.jaw - dt * 6);
      if (Math.random() < dt * 14) bubbleAt(g, s.x - Math.cos(s.heading) * 60, s.y, 1);
      break;
    case "leaving":
      s.vx += (-260 - s.vx) * Math.min(1, dt * 2);
      s.vy *= Math.exp(-dt * 2);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      keepInWater();
      turnToward(Math.PI, 3);
      s.jaw = Math.max(0, s.jaw - dt * 3);
      break;
  }
  if (s.x < -240 || s.x > g.width + 260) {
    if (s.state === "fleeing" || s.state === "leaving" || s.state === "chomped") {
      // It's gone, and so is its music.
      g.shark = null;
      g.sharkTheme = null;
    }
  }
}

/** It bit into the spines: it yelps and flees, and the fish gets knocked back a little. */
function spikeShark(g: Game, s: Shark): void {
  setSharkState(s, "fleeing");
  // Beaten: its music cuts out right away.
  g.sharkTheme = null;
  s.vx = 120;
  s.vy = -60;
  g.sharksSpiked++;
  g.combo++;
  g.bestCombo = Math.max(g.bestCombo, g.combo);
  g.targetsHit++;
  const points = Math.round(config.targetPoints * config.sharkMultiplier * g.comboMultiplier);
  g.bonus += points;
  const b = g.bird;
  const n = sharkNose(s);
  g.floaters.push({ x: n.x, y: n.y - 50, text: pick(SHARK_SPIKED_TEXT), color: "#ffd60a", size: 30, life: 1.2, maxLife: 1.2 });
  const label = g.combo > 1 ? `+${points}  x${g.comboMultiplier.toFixed(1)}` : `+${points}`;
  g.floaters.push({ x: n.x, y: n.y - 20, text: label, color: "#ffe14d", size: 24, life: 1.1, maxLife: 1.1 });
  g.shake = Math.max(g.shake, 10);
  b.vy += 80 * Math.sign(b.y - s.y || 1);
  b.stretchV -= 8;
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 200;
    g.particles.push({
      x: n.x, y: n.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.3 + Math.random() * 0.4, maxLife: 0.7, size: 2 + Math.random() * 4,
      color: Math.random() < 0.5 ? "#ffd60a" : "#ffffff", gravity: 0, world: true,
    });
  }
  g.events.push({ type: "sharkSpiked", points, combo: g.combo });
}

/** Not spiked: gulp. The run is over and the shark swims off with the fish. */
function chomp(g: Game, s: Shark): void {
  setSharkState(s, "chomped");
  g.eaten = true;
  g.combo = 0;
  g.crash("chomp");
  g.message = { text: pick(CHOMP_MESSAGES), life: 2.2 };
  g.shake = 14;
}
