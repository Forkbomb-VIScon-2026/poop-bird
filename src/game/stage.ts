// Stage transitions. A run alternates between stages: city → ocean → city → …
// Each stage ends at the waterfront (a Shore). In the city the street ends at
// a quay and the bird dives into the harbour by falling in; at the end of the
// ocean the far quay comes up and the fish breaks through the surface. Both
// start a StageTransition: the camera pans between the city and the sea below
// it while the creature changes.

import { initialChargeState } from "../charge";
import { config } from "../config";
import { applyWaterDrag, initialSpikeState } from "../swim";
import { bubbleTrail, splash } from "./effects";
import { updateSpring } from "./fish";
import type { Game } from "./game";
import { OCEAN_DEPTH, type Stage, SURFACE_Y, VIEW_H, WATER_Y } from "./world";

/** Ocean y where the fish settles after the dive. */
const DIVE_DEPTH = 240;

/** How far past the quay's edge the bird is when the game takes over and dives it in. */
export const DIVE_TAKEOVER = 60;

/** How far ahead the far quay is when the game takes over and leaps the fish out. */
export const EXIT_TAKEOVER = 320;

/** City y the leaping bird glides to and holds until it's over the street. */
const LEAP_HEIGHT = 230;

/**
 * The waterfront that ends a stage. "dive" (city): the quay ends at `x` and
 * the harbour begins, so land is left of `x` and water right of it; falling
 * into the water dives in. "exit" (ocean): the far quay begins at `x`, so
 * water is left of it and land right. The game takes over at each: it dives
 * the bird in once it's over the water, and leaps the fish out before the
 * wall. A shore stays around after its transition until it scrolls off, so the
 * quay wall is still there under water, and the bird leaps out over water.
 */
export interface Shore {
  x: number;
  kind: "dive" | "exit";
}

/**
 * The change between stages, animated by the game (no player control). Dive:
 * the bird hops and plunges through the surface, becomes a deflated fish
 * under water (`swapped`) and inflates while the camera follows it down.
 * Breach: the fish shoots up, becomes the bird as it breaks the surface and
 * leaps up to a safe height, gliding until it's over the street.
 */
export interface StageTransition {
  to: Stage;
  /** Seconds since the transition began. */
  t: number;
  /** The bird has hit the water (dive). */
  entered: boolean;
  /** The creature has changed and the stage switched. */
  swapped: boolean;
  /** Seconds since the swap. */
  sinceSwap: number;
}

export function startTransition(g: Game, to: Stage): void {
  const b = g.bird;
  g.transition = { to, t: 0, entered: false, swapped: false, sinceSwap: 0 };
  // Nothing from the old stage may fire during or after the transition.
  g.charge = initialChargeState();
  g.spike = initialSpikeState();
  g.pebbles = [];
  if (to === "ocean") {
    // A little hop, then the plunge.
    b.vy = Math.min(b.vy, -220);
    b.stretchV += 8;
    b.flap = 0.35;
  } else {
    b.vy = Math.min(b.vy, -300);
    b.stretchV += 10;
  }
  g.events.push({ type: "gateEntered", to });
}

export function updateTransition(g: Game, dt: number): void {
  const tr = g.transition!;
  const b = g.bird;
  tr.t += dt;
  if (tr.swapped) tr.sinceSwap += dt;
  // The world drifts on, so the dive doesn't stop dead.
  const speed = g.scrollSpeed * (g.stage === "ocean" ? config.oceanScrollScale : 1);
  g.speed = speed;
  g.distance += speed * dt;
  scrollWorld(g, dt, speed);

  if (tr.to === "ocean") updateDive(g, tr, dt);
  else updateBreach(g, tr, dt);
  updateSpring(g, dt);
  b.flap = Math.max(0, b.flap - dt);

  // The camera follows the creature through the surface, then settles on the new stage.
  const end = tr.to === "ocean" ? OCEAN_DEPTH : 0;
  const follow = Math.min(OCEAN_DEPTH, Math.max(0, b.y + g.stageOffset - VIEW_H * 0.42));
  const target = tr.swapped ? end : follow;
  g.cameraY += (target - g.cameraY) * (1 - Math.exp(-dt * (tr.swapped ? 8 : 6)));
  const arrived = Math.abs(g.cameraY - end) < 2;

  const done = tr.to === "ocean"
    ? tr.swapped && arrived && tr.sinceSwap >= Math.max(0.5, config.oceanTransformTime)
    : tr.swapped && arrived && tr.sinceSwap >= 0.6 && !g.overWater(b.x);
  if (done) {
    g.transition = null;
    g.cameraY = end;
    if (tr.to === "city") b.flap = 0.4;
    g.events.push({ type: tr.to === "ocean" ? "transformed" : "surfaced" });
  }
}

/**
 * City → ocean. Before the swap (city y): fall to the water, plunge in and
 * slow down. Once deep enough the bird becomes a deflated fish, which sinks
 * to cruising depth and inflates to the hover puff.
 */
function updateDive(g: Game, tr: StageTransition, dt: number): void {
  const b = g.bird;
  if (!tr.swapped) {
    const under = b.y > WATER_Y;
    if (under && !tr.entered) {
      tr.entered = true;
      splash(g, b.x, WATER_Y, 1);
      b.stretchV -= 10;
    }
    b.vy = under ? applyWaterDrag(b.vy, 240, dt, 0.25) : Math.min(b.vy + 1400 * dt, 900);
    b.y += b.vy * dt;
    b.rot += ((under ? 0.8 : 1.2) - b.rot) * Math.min(1, dt * 8);
    if (under) bubbleTrail(g, dt, 40);
    if (b.y >= WATER_Y + 80) swapStage(g, "ocean");
    return;
  }
  const sink = Math.min(240, Math.max(-160, (DIVE_DEPTH - b.y) * 3));
  b.vy = applyWaterDrag(b.vy, sink, dt, 0.3);
  b.y += b.vy * dt;
  b.rot += (0 - b.rot) * Math.min(1, dt * 5);
  const f = g.fish;
  const goal = tr.sinceSwap > 0.25 ? config.oceanHoverPuff : 0;
  f.puff += (goal - f.puff) * (1 - Math.exp(-dt / 0.12));
  bubbleTrail(g, dt, 12);
}

/**
 * Ocean → city. Before the swap (ocean y): the fish shoots up. As it breaks
 * the surface it becomes the bird (city y), which leaps out under gravity.
 */
function updateBreach(g: Game, tr: StageTransition, dt: number): void {
  const b = g.bird;
  const f = g.fish;
  if (!tr.swapped) {
    b.vy = applyWaterDrag(b.vy, -560, dt, 0.15);
    b.y += b.vy * dt;
    b.rot += (-0.5 - b.rot) * Math.min(1, dt * 8);
    f.puff += (0.85 - f.puff) * Math.min(1, dt * 8);
    bubbleTrail(g, dt, 50);
    if (b.y < SURFACE_Y) swapStage(g, "city");
    return;
  }
  // The leap eases into a glide at a safe height, held until the street is below.
  const glide = Math.max(-400, Math.min(400, (LEAP_HEIGHT - b.y) * 4));
  b.vy += (glide - b.vy) * Math.min(1, dt * 2.5);
  b.y += b.vy * dt;
  const targetRot = Math.max(-0.5, Math.min(0.7, b.vy / 700));
  b.rot += (targetRot - b.rot) * Math.min(1, dt * 6);
  if (b.flap <= 0 && b.vy > -150) b.flap = 0.3;
}

/** Moves everything with the scroll during a transition (nothing spawns, nothing collides). */
function scrollWorld(g: Game, dt: number, speed: number): void {
  const dx = speed * dt;
  if (g.shore) g.shore.x -= dx;
  for (const o of g.obstacles) o.x -= dx;
  for (const l of g.powerLines) l.x -= dx;
  for (const b of g.balloons) {
    b.x -= dx;
    if (b.rag) b.rag.x -= dx;
  }
  for (const t of g.targets) t.x -= dx;
  for (const j of g.jellies) j.x -= dx;
  for (const p of g.poops) p.x -= dx;
  for (const d of g.doves) d.x -= dx;
  if (g.bouquet) g.bouquet.x -= dx;
  if (g.angler) {
    g.angler.x -= dx;
    g.angler.hookX -= dx;
    g.angler.hatX -= dx;
  }
  if (g.shark) g.shark.x -= dx;
}

/**
 * The creature changes under the splash or bubbles: switch bird ↔ fish,
 * clear the old stage's world and move everything to the new stage's y.
 */
function swapStage(g: Game, to: Stage): void {
  const tr = g.transition!;
  tr.swapped = true;
  const shift = to === "ocean" ? -OCEAN_DEPTH : OCEAN_DEPTH;
  g.stage = to;
  g.stageTime = 0;
  g.stageObstacles = 0;
  g.gateSpawned = false;
  g.obstacles = [];
  g.powerLines = [];
  g.balloons = [];
  g.targets = [];
  g.pebbles = [];
  g.poops = [];
  g.decals = [];
  g.jellies = [];
  g.screenSplats = [];
  g.wedding = null;
  g.bouquet = null;
  g.doves = [];
  g.angler = null;
  g.shark = null;
  g.sharkTheme = null;
  if (to === "city") {
    g.cityStage++;
    g.weddingPlanned = Math.random() < config.weddingChance;
  } else {
    // A shark, a fisherman, both (the fisherman first) or neither.
    g.sharkPlanned = Math.random() < config.sharkChance;
    g.anglerPlanned = Math.random() < config.anglerChance;
  }
  g.message = null;
  g.lastGapCenter = 260;
  g.jellySpawnAcc = 0;
  g.targetSpawnAcc = 0.6;
  g.nextObstacleAt = g.distance + (to === "ocean" ? config.oceanFirstObstacleDelay : config.firstObstacleDelay);
  for (const p of g.particles) p.y += shift;
  for (const f of g.floaters) f.y += shift;
  const b = g.bird;
  b.y += shift;
  b.stretchV += 14;
  g.fish.spikes = 0;
  g.spike = initialSpikeState();
  // A strain held through the ocean must not fire the moment we're back in the city.
  g.charge = to === "city" ? { ...initialChargeState(), needsRelease: true } : initialChargeState();
  if (to === "ocean") {
    // The bird gulps water and turns into a deflated fish: feathers float off in a burst of bubbles.
    g.fish.puff = 0;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 160;
      const feather = i < 10;
      g.particles.push({
        x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.6 + Math.random() * 0.7, maxLife: 1.3, size: feather ? 3 + Math.random() * 3 : 2 + Math.random() * 5,
        color: feather ? "#ffd166" : Math.random() < 0.6 ? "#e0fbfc" : "#ffffff",
        gravity: feather ? -60 : -220, world: true,
      });
    }
    g.events.push({ type: "submerged" });
  } else {
    // Out of the water and back to a bird, mid-leap.
    b.vy = -950;
    b.flap = 0.5;
    splash(g, b.x, WATER_Y, 1, 50);
    g.events.push({ type: "breached" });
  }
}

/** The stage ends at the waterfront: the quay's edge (city) or the far quay (ocean) scrolls in. */
export function spawnShore(g: Game): void {
  g.gateSpawned = true;
  const x = g.width + 40;
  g.shore = { x, kind: g.stage === "city" ? "dive" : "exit" };
  // Nothing waits on the street beyond the edge (all off screen).
  if (g.stage === "city") g.targets = g.targets.filter((t) => t.x - t.w / 2 < x);
}

/** Scrolls the waterfront; it goes once the stage it ended is behind us and it's off screen. */
export function updateShore(g: Game, dt: number, speed: number): void {
  const s = g.shore;
  if (!s) return;
  s.x -= speed * dt;
  const behind = s.kind === "dive" ? g.stage === "ocean" : g.stage === "city";
  if (behind && s.x < -40) g.shore = null;
}
