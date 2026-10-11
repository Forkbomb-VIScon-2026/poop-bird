// Now and then a fisherman rows across the ocean's surface and casts his hook
// down to the fish's depth. The hook always catches: he reels the fish in and
// the run ends with his trophy photo. Crossing his line above the hook while
// spiked snags it on the spines: he hauls on it until it parts, and with the
// pull suddenly gone he topples backwards into his boat.

import { config } from "../config";
import { pick } from "../random";
import { initialSpikeState } from "../swim";
import { bubbleTrail, ripple, splash } from "./effects";
import { updateSpring } from "./fish";
import type { Game } from "./game";
import { GROUND_Y, SURFACE_Y } from "./world";

/**
 * The fisherman's state. Rowing: his boat comes in along the surface. Casting:
 * a "!" and the bobber plops in. Fishing: the hook sinks to the depth the fish
 * was at when he cast, and he jigs it gently there. Leaving: the hook went
 * past and he reels in. Hooked: the fish bit and he's reeling it up. Landed: he
 * got it (the run is over). Tugging: the line snagged on the spines and he's
 * hauling on it. Snapped: it parted; he tumbled backwards into his boat, his
 * hat flew off, and the cut-off end sinks away with the hook.
 */
export type AnglerState = "rowing" | "casting" | "fishing" | "leaving" | "hooked" | "landed" | "tugging" | "snapped";

export interface Angler {
  state: AnglerState;
  /** Seconds in the current state. */
  t: number;
  /** Screen x of the boat's centre. His rod tip is ANGLER_TIP_DX ahead (left) of it. */
  x: number;
  /** The hook, in ocean y. */
  hookX: number;
  hookY: number;
  hookVy: number;
  /** The depth he cast the hook to (the fish's depth when he cast). */
  target: number;
  /** Closest the hook came to the fish (for the "close one" bonus). */
  closest: number;
  dodged: boolean;
  /** Hooked: where the fish bit; it's reeled up from there. */
  fromY: number;
  /** 0..1 how far the hooked fish has been reeled in. */
  reel: number;
  /** Tugging: where the line is snagged on the fish. Snapped: the cut-off end, sinking away with the hook. */
  cutX: number;
  cutY: number;
  /** Snapped: the cut end of the line still on his rod, whipping back up (ocean y). */
  stubY: number;
  /** His sou'wester once it's flown off into the water, drifting on the surface (screen x). */
  hatX: number;
  /** Seconds until the next click of the reel's ratchet. */
  click: number;
  seed: number;
}

const CAUGHT_MESSAGES = ["CATCH OF THE DAY!", "REELED IN!", "Fish and chips!", "Hook, line and sinker", "Dinner is served", "Should've puffed!"];

const SNAPPED_TEXT = ["LINE CUT!", "SNAPPED!", "SNIP!"];

/** The fisherman's rod tip is this far ahead (left) of his boat's centre. */
export const ANGLER_TIP_DX = 117;

/** Hook radius for collisions. */
export const HOOK_R = 7;

/** Seconds he hauls on a line snagged on the spines before it parts. */
export const ANGLER_TUG_TIME = 0.35;

/** Seconds the fisherman lies on his back in the boat after the line snaps, before he sits up again. */
export const ANGLER_TOPPLE_TIME = 1.4;

/** How far behind (right of) the boat's centre his hat lands in the water. */
export const ANGLER_HAT_DX = 110;

/** Extra room after the fisherman's slot before the next ocean obstacle. */
export const ANGLER_ROOM = 320;

/** True while the fisherman is a threat: no jellyfish crowd his hook. */
export function anglerBusy(g: Game): boolean {
  const s = g.angler?.state;
  return s === "rowing" || s === "casting" || s === "fishing" || s === "tugging" || s === "hooked";
}

export function anglerDue(g: Game): boolean {
  return (
    g.anglerPlanned &&
    !g.angler &&
    g.stageObstacles >= Math.round(config.anglerSlot) &&
    !g.shark &&
    g.sharkTheme === null
  );
}

/** His boat rows in from the right. Returns the extra room it needs before the next obstacle. */
export function spawnAngler(g: Game): number {
  g.anglerPlanned = false;
  g.angler = {
    state: "rowing", t: 0, x: g.width + ANGLER_TIP_DX + 60,
    hookX: 0, hookY: SURFACE_Y, hookVy: 0, target: SURFACE_Y,
    closest: Infinity, dodged: false, fromY: 0, reel: 0, cutX: 0, cutY: 0, stubY: 0,
    hatX: 0, click: 0, seed: Math.random() * 1000,
  };
  return ANGLER_ROOM;
}

function setAnglerState(a: Angler, state: AnglerState): void {
  a.state = state;
  a.t = 0;
}

export function updateAngler(g: Game, dt: number, speed: number): void {
  const a = g.angler;
  if (!a) return;
  a.t += dt;
  const b = g.bird;
  // He rows against the scroll (but slower), so his line sweeps toward the fish.
  const rowing = a.state === "rowing" || a.state === "casting" || a.state === "fishing" || a.state === "leaving";
  a.x -= (speed - (rowing ? config.anglerRow : 0)) * dt;
  const tipX = a.x - ANGLER_TIP_DX;
  const playing = g.phase === "playing" && g.stage === "ocean" && !g.transition;
  const r = g.hitRadius;

  switch (a.state) {
    case "rowing":
      a.hookX = tipX;
      if (!playing) break;
      if (tipX - b.x < 160) setAnglerState(a, "leaving");
      else if (tipX - b.x < config.anglerCastRange && tipX < g.width - 20) setAnglerState(a, "casting");
      break;
    case "casting":
      a.hookX = tipX;
      // The rod whips forward, then the bobber plops in and the hook sinks to where the fish is now.
      if (a.t >= 0.5) {
        setAnglerState(a, "fishing");
        a.hookY = SURFACE_Y;
        a.hookVy = 0;
        a.target = Math.max(SURFACE_Y + 60, Math.min(GROUND_Y - 40, b.y));
        ripple(g, tipX, 5);
        g.events.push({ type: "anglerCast" });
      }
      break;
    case "fishing": {
      a.hookX = tipX + Math.sin(g.time * 2 + a.seed) * 3;
      // Sinks to his depth, then he jigs it gently up and down there.
      const jig = a.target + Math.sin(a.t * 1.6 + a.seed) * config.anglerJig;
      a.hookY = Math.min(SURFACE_Y + config.anglerSinkSpeed * a.t, jig);
      if (!playing) break;
      const dist = Math.hypot(a.hookX - b.x, a.hookY - b.y);
      // The hook always catches, spikes or not.
      if (dist < r + HOOK_R) {
        hookFish(g, a);
        break;
      }
      // Spines snag the line above it.
      const reach = r * config.oceanJellyPopReach * 0.8;
      if (g.spike.spiked && Math.abs(a.hookX - b.x) < reach && b.y < a.hookY - 14 && b.y + reach > SURFACE_Y) {
        setAnglerState(a, "tugging");
        a.cutX = b.x;
        a.cutY = b.y;
        a.click = 0;
        break;
      }
      a.closest = Math.min(a.closest, dist);
      if (a.hookX < b.x - r - 20) {
        if (!a.dodged && a.closest < r + HOOK_R + 26) {
          a.dodged = true;
          g.bonus += Math.round(config.targetPoints * config.anglerCloseMultiplier);
          g.floaters.push({ x: b.x, y: b.y - 46, text: "CLOSE ONE!", color: "#bde0fe", size: 20, life: 0.9, maxLife: 0.9 });
        }
        setAnglerState(a, "leaving");
      }
      break;
    }
    case "leaving":
      // Reels the empty hook back in.
      a.hookX = tipX;
      a.hookY = Math.max(SURFACE_Y, a.hookY - 260 * dt);
      break;
    case "hooked": {
      a.reel = Math.min(1, a.reel + dt / Math.max(0.3, config.anglerReelTime));
      // The boat swings round over the fish.
      a.x += (a.hookX + ANGLER_TIP_DX - a.x) * Math.min(1, dt * 4);
      a.click -= dt;
      if (a.click <= 0) {
        a.click = 0.09 - a.reel * 0.04;
        g.events.push({ type: "anglerReel" });
      }
      if (a.reel >= 1) landFish(g, a);
      break;
    }
    case "landed":
      a.x += (a.hookX + ANGLER_TIP_DX - a.x) * Math.min(1, dt * 4);
      // The camera flash: he takes his trophy photo.
      if (g.trophy !== null && a.t >= 0.8 && !g.polaroid) {
        g.flash = 0.7;
        g.polaroid = { photoId: g.trophy, life: 2.4, maxLife: 2.4, trophy: true };
        g.events.push({ type: "anglerPhoto" });
      }
      break;
    case "tugging": {
      // The line's snagged on the fish: he hauls on it, the hook dangling below, until it parts.
      a.cutX = b.x;
      a.cutY = b.y;
      a.hookX += (b.x - a.hookX) * Math.min(1, dt * 6);
      a.hookY = Math.max(a.hookY, b.y + 30);
      a.click -= dt;
      if (a.click <= 0) {
        a.click = 0.05;
        g.events.push({ type: "anglerReel" });
      }
      if (a.t >= ANGLER_TUG_TIME) snapLine(g, a);
      break;
    }
    case "snapped": {
      // The end on his rod whips back up; the cut-off end, hook and all, sinks and drifts away.
      a.stubY = Math.max(SURFACE_Y, a.stubY - 900 * dt);
      a.hookVy = Math.min(110, a.hookVy + 200 * dt);
      a.hookY = Math.min(GROUND_Y + 60, a.hookY + a.hookVy * dt);
      a.cutY = Math.min(a.hookY - 20, a.cutY + a.hookVy * 0.8 * dt);
      a.hookX -= speed * dt;
      a.cutX += (a.hookX - a.cutX) * Math.min(1, dt * 1.5) - speed * dt;
      a.hatX -= (speed - 14) * dt;
      if (a.t - dt < 0.5 && a.t >= 0.5) ripple(g, a.hatX + ANGLER_HAT_DX, 6);
      break;
    }
  }
  if (a.x < -220 && a.hatX + ANGLER_HAT_DX < -60 && a.hookX < -40 && a.cutX < -40) g.angler = null;
}

/** The fish touched the hook: the world holds still and he reels it in. */
function hookFish(g: Game, a: Angler): void {
  setAnglerState(a, "hooked");
  a.reel = 0;
  a.click = 0;
  a.fromY = g.bird.y;
  g.combo = 0;
  g.shake = 8;
  g.bird.stretchV -= 8;
  g.floaters.push({ x: g.bird.x, y: g.bird.y - 50, text: "HOOKED!", color: "#ff595e", size: 26, life: 0.9, maxLife: 0.9 });
  g.events.push({ type: "anglerHooked" });
}

/**
 * Hooked: the fish is reeled up from where it bit toward the surface, slowly
 * at first, thrashing on the line. Landed: it's yanked out of the water.
 */
export function reelFish(g: Game, a: Angler, dt: number): void {
  const b = g.bird;
  const r = g.bodyRadius;
  if (a.state === "hooked") {
    const k = a.reel * a.reel;
    const y = a.fromY + (SURFACE_Y + r * 0.5 - a.fromY) * k;
    b.vy = (y - b.y) / Math.max(1e-3, dt);
    b.y = y;
    b.rot = -0.5 + Math.sin(g.time * 24) * 0.25;
    bubbleTrail(g, dt, 30);
  } else {
    const wasUnder = b.y > SURFACE_Y;
    b.vy = Math.max(-900, b.vy - 2400 * dt);
    b.y += b.vy * dt;
    b.rot += (-1.3 - b.rot) * Math.min(1, dt * 6);
    if (wasUnder && b.y <= SURFACE_Y) splash(g, b.x, SURFACE_Y, 1, 40);
  }
  a.hookX = b.x + r * 0.9;
  a.hookY = b.y;
  updateSpring(g, dt);
}

/** He got it: out of the water it goes, and the run is over. */
function landFish(g: Game, a: Angler): void {
  setAnglerState(a, "landed");
  g.phase = "dying";
  g.dyingTime = 0;
  g.spike = initialSpikeState();
  g.shake = 10;
  g.bird.vy = -200;
  g.message = { text: pick(CAUGHT_MESSAGES), life: 2.6 };
  const photoId = g.nextPhotoId++;
  g.trophy = photoId;
  g.events.push({ type: "anglerLanded", photoId });
}

/**
 * The snagged line parts. He was hauling on it, so with the pull suddenly
 * gone he topples backwards into his boat, and his hat flies off.
 */
function snapLine(g: Game, a: Angler): void {
  setAnglerState(a, "snapped");
  a.hookVy = 0;
  a.stubY = a.cutY;
  a.hatX = a.x;
  g.anglersSnapped++;
  g.combo++;
  g.bestCombo = Math.max(g.bestCombo, g.combo);
  g.targetsHit++;
  const points = Math.round(config.targetPoints * config.anglerSnapMultiplier * g.comboMultiplier);
  g.bonus += points;
  const b = g.bird;
  g.floaters.push({ x: b.x, y: b.y - 60, text: pick(SNAPPED_TEXT), color: "#ffd60a", size: 28, life: 1.2, maxLife: 1.2 });
  const label = g.combo > 1 ? `+${points}  x${g.comboMultiplier.toFixed(1)}` : `+${points}`;
  g.floaters.push({ x: b.x, y: b.y - 30, text: label, color: "#ffe14d", size: 24, life: 1.1, maxLife: 1.1 });
  g.shake = Math.max(g.shake, 6);
  g.events.push({ type: "lineSnapped", points });
}
