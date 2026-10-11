// The ocean's obstacles: coral, rocks and shipwrecks on the sea floor, and
// boats with their anchor hanging down from the surface (some drop it as the
// fish comes near).

import { config, ramp } from "../config";
import { pick } from "../random";
import { burst } from "./effects";
import type { Game } from "./game";
import { pickGapCenter, type BottomKind, type Obstacle } from "./obstacles";
import { enterState, GROUND_Y, SURFACE_Y, type Rect } from "./world";

/**
 * A boat dropping its anchor. Hanging: like any anchor, until the fish comes
 * near. Warning: a "!" by the anchor, which rattles on its chain, and arrows
 * pointing down below it. Falling: the chain rips just below the hull, and
 * the anchor drops onto the coral, the rock or the sea floor, the torn-off
 * chain falling with it and piling up on it. Down: it rests there, and only a
 * stub of chain hangs from the boat, so the way through is above it now.
 */
export type AnchorDropState = "hanging" | "warning" | "falling" | "down";

export interface AnchorDrop {
  state: AnchorDropState;
  /** Seconds in the current state. */
  t: number;
  /** Where the anchor's crown is now (`gapTop` while it hangs), and where it comes to rest. */
  y: number;
  to: number;
  /** Once the chain has ripped: the top end of the piece still on the anchor (the rest is piled on it). */
  chain: number;
}

const CORAL_COLORS = ["#ff7f6e", "#ff9f43", "#f368e0", "#ee5a6f", "#ffb86b"];
const ROCK_COLORS = ["#6b7b8c", "#7d6e63", "#5f6f7a"];
/** Waterlogged timber, greyed and greened by the years. */
const WRECK_COLORS = ["#8a6440", "#7b5b3a", "#74604a"];

/** A shipwreck's hull: how high its deck stands above the sea floor. */
export const WRECK_HULL_H = 62;
/** Its broken mast's height above the deck (the mast's tip is the gap's bottom edge). */
export const WRECK_MAST_MIN = 24;
export const WRECK_MAST_MAX = 96;
/** The hull's bow and stern curve in: this much of each end doesn't count for collisions. */
export const WRECK_END_INSET = 18;
export const WRECK_MAST_W = 12;

/**
 * A shipwreck's layout: the deck height, which way the bow points (+1: right),
 * and the mast's centre, set back from the middle toward the stern.
 */
export function wreckGeometry(o: Obstacle): { deck: number; facing: 1 | -1; mastX: number } {
  const facing = Math.floor(o.seed * 7) % 2 === 0 ? 1 : -1;
  return { deck: GROUND_Y - WRECK_HULL_H, facing, mastX: o.x + o.w / 2 - facing * o.w * 0.14 };
}

/** The anchor's boat: width, and how far its hull reaches below the surface (its deck is BOAT_FREEBOARD above). */
export const BOAT_W = 150;
export const BOAT_DRAFT = 22;
export const BOAT_FREEBOARD = 18;
/** The anchor hangs with its crown at the gap's top edge. */
export const ANCHOR_W = 60;
export const ANCHOR_H = 66;
/** The shortest chain between the hull and the anchor's ring. */
const ANCHOR_MIN_CHAIN = 16;
/** The highest an anchored obstacle's gap can start. */
const ANCHOR_TOP_MIN = SURFACE_Y + BOAT_DRAFT + ANCHOR_MIN_CHAIN + ANCHOR_H;
/** A dropping anchor needs at least this many seconds of warning, or the boat doesn't drop it. */
const ANCHOR_DROP_MIN_WARN = 0.5;
/** Seconds between the clanks of a dropping anchor's chain during the warning. */
export const ANCHOR_RATTLE_EVERY = 0.22;
/** How far a dropped anchor's crown digs into the sand of the sea floor. */
const ANCHOR_SAND_DEPTH = 6;

/** Where a dropped anchor's chain rips: the stub left hanging from the hull ends here. */
export const ANCHOR_RIP_Y = SURFACE_Y + BOAT_DRAFT + 12;

/** Where an anchor's crown is: the gap's top edge, unless it's being dropped. */
export function anchorCrown(o: Obstacle): number {
  return o.drop ? o.drop.y : o.gapTop;
}

/** The chain has ripped: the anchor is falling or down, with the torn-off chain on it. */
export function anchorRipped(o: Obstacle): boolean {
  return o.drop?.state === "falling" || o.drop?.state === "down";
}

/** The length of chain torn off with a dropped anchor (from the rip to the anchor's ring). */
export function anchorChainLength(o: Obstacle): number {
  return o.gapTop - ANCHOR_H - ANCHOR_RIP_Y;
}

/**
 * Collision rectangles for an anchor and its boat: hull, chain and shank,
 * stock, arms. Once a dropped anchor's chain has ripped, the stub on the hull
 * and the piece still standing above the anchor count (the chain piled on it
 * lies inside the anchor's own rectangles).
 */
export function anchorRects(o: Obstacle): Rect[] {
  const cx = o.x + o.w / 2;
  const hullBottom = SURFACE_Y + BOAT_DRAFT;
  const crown = anchorCrown(o);
  const top = crown - ANCHOR_H;
  const ripped = anchorRipped(o);
  const chainTop = ripped && o.drop ? o.drop.chain : hullBottom;
  const rects: Rect[] = [
    // The bow and the transom curve up toward the keel: only the hull's middle counts.
    { x: cx - BOAT_W / 2 + 20, y: SURFACE_Y - BOAT_FREEBOARD, w: BOAT_W - 32, h: BOAT_FREEBOARD + BOAT_DRAFT },
    { x: cx - 5, y: chainTop, w: 10, h: crown - 12 - chainTop },
    { x: cx - 21, y: top + 15, w: 42, h: 9 },
    // The arms curve up to the flukes: a wide band above, the crown below.
    { x: cx - ANCHOR_W / 2, y: crown - 36, w: ANCHOR_W, h: 22 },
    { x: cx - 16, y: crown - 14, w: 32, h: 14 },
  ];
  if (ripped) rects.push({ x: cx - 5, y: hullBottom, w: 10, h: ANCHOR_RIP_Y - hullBottom });
  return rects;
}

/**
 * Coral or a rock from the sea floor, or a boat whose anchor hangs down from
 * the surface: over coral or a rock (a gap between them), or over open water
 * (dive under it). Now and then the sea floor holds an old shipwreck
 * instead: a long, low hull with one broken mast. Some boats drop their
 * anchor as the fish comes near (`forceDrop`: this one does). Returns the
 * extra room a wreck's long hull needs before the next obstacle.
 */
export function spawnOceanObstacle(g: Game, forceDrop = false): number {
  const gap = ramp(config.oceanGap, config.oceanGapMin, g.difficulty);
  // Not the last one: it can still be on screen when the fish leaps out, and
  // its boat would vanish from the harbour as the stage switches. Nor while a
  // fisherman is out: he rows against the scroll, so it would catch up with
  // his boat and his line.
  const last = g.stageObstacles >= Math.round(config.oceanObstacles) - 1;
  const anchor = forceDrop || (!last && !g.angler && Math.random() < config.oceanAnchorChance);
  const open = anchor && Math.random() < config.oceanAnchorOpenChance;
  // A dropping anchor needs coral, a rock or the sea floor to land on, and the screen
  // wide enough to see it coming (the whole warning, fall and lead before the fish).
  const dropRoom = g.speed > 0 && (g.width + 40 - g.bird.x) / g.speed > ANCHOR_DROP_MIN_WARN + config.oceanAnchorDropFall + config.oceanAnchorDropLead;
  const drop = anchor && (forceDrop || (dropRoom && Math.random() < config.oceanAnchorDropChance));
  const wreck = !open && !drop && Math.random() < config.oceanWreckChance;
  // The boat, the shortest chain and the anchor itself all sit above the gap.
  let top = anchor ? ANCHOR_TOP_MIN : SURFACE_Y;
  let margin = anchor ? 10 : 40;
  let bottomMargin = open ? 0 : 40;
  if (wreck) {
    // The gap's bottom is the broken mast's tip: low, so the wreck is easy to clear.
    top = Math.max(top + margin, GROUND_Y - WRECK_HULL_H - WRECK_MAST_MAX - gap);
    margin = 0;
    bottomMargin = WRECK_HULL_H + WRECK_MAST_MIN;
  }
  const center = pickGapCenter(g, gap, top, margin, config.oceanGapJump, bottomMargin);
  const bottom: BottomKind = open ? "none" : wreck ? "wreck" : pick(["coral", "coral", "rock"]);
  const w = bottom === "wreck" ? 210 + Math.random() * 50 : bottom === "rock" ? 84 + Math.random() * 20 : 70 + Math.random() * 24;
  const colors = bottom === "wreck" ? WRECK_COLORS : bottom === "rock" ? ROCK_COLORS : CORAL_COLORS;
  const gapTop = center - gap / 2;
  const gapBottom = open ? GROUND_Y : center + gap / 2;
  g.obstacles.push({
    x: g.width + 40, w, gapTop, gapBottom,
    bottom, color: pick(colors), seed: Math.random() * 1000,
    passed: false, splats: [], tabloid: null, anchor,
    // Open water: it sinks a little way into the sand.
    drop: drop ? { state: "hanging", t: 0, y: gapTop, to: open ? GROUND_Y + ANCHOR_SAND_DEPTH : gapBottom, chain: ANCHOR_RIP_Y } : null,
  });
  return bottom === "wreck" ? w - 90 : 0;
}

/**
 * Boats dropping their anchor, timed by when the fish will get there (at
 * the current speed): the warning starts `oceanAnchorDropWarn` before the
 * fall, which ends `oceanAnchorDropLead` before the fish reaches the anchor.
 * If the boat only comes on screen later, the warning is shorter.
 */
export function updateAnchorDrops(g: Game, dt: number, speed: number): void {
  const front = g.bird.x + g.hitRadius;
  for (const o of g.obstacles) {
    const d = o.drop;
    if (!d) continue;
    d.t += dt;
    const cx = o.x + o.w / 2;
    const eta = speed > 0 ? (cx - ANCHOR_W / 2 - front) / speed : Infinity;
    const fall = config.oceanAnchorDropFall;
    if (d.state === "hanging") {
      const onScreen = cx + BOAT_W / 2 < g.width;
      if (onScreen && eta <= config.oceanAnchorDropWarn + fall + config.oceanAnchorDropLead) {
        enterState(d, "warning");
        g.events.push({ type: "anchorWarn" });
      }
    } else if (d.state === "warning") {
      // The chain clanks as the anchor strains on it.
      if (d.t >= ANCHOR_RATTLE_EVERY) {
        d.t = 0;
        g.events.push({ type: "anchorRattle" });
      }
      if (eta <= fall + config.oceanAnchorDropLead) {
        enterState(d, "falling");
        d.y = o.gapTop;
        d.chain = ANCHOR_RIP_Y;
        anchorSnapped(g, cx);
      }
    } else if (d.state === "falling") {
      // The anchor and the chain torn off with it fall faster and faster, stirring up
      // bubbles. The anchor lands first; the chain keeps falling and piles up on it,
      // and it's all at rest after `fall` s.
      const anchorDrop = d.to - o.gapTop;
      const chainDrop = d.to - o.gapTop + anchorChainLength(o);
      const k = Math.min(1, d.t / Math.max(0.01, fall));
      const s = chainDrop * k * k;
      const wasUp = d.y < d.to;
      d.y = o.gapTop + Math.min(anchorDrop, s);
      d.chain = Math.min(d.y - ANCHOR_H, ANCHOR_RIP_Y + s);
      if (wasUp && Math.random() < dt * 30) {
        g.particles.push({
          x: cx + (Math.random() - 0.5) * ANCHOR_W, y: d.y - ANCHOR_H * Math.random(),
          vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 40,
          life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 2 + Math.random() * 3,
          color: "#e0fbfc", gravity: -160, world: true,
        });
      }
      if (wasUp && d.y >= d.to) anchorLanded(g, o, cx);
      if (k >= 1) {
        enterState(d, "down");
      }
    }
  }
}

/** The chain rips just below the hull: bits of rust and a burst of bubbles at the break. */
function anchorSnapped(g: Game, cx: number): void {
  burst(g, cx, ANCHOR_RIP_Y, 14, {
    speed: [60, 220], life: [0.3, 0.7], maxLife: 0.7, size: [2, 5], color: ["#56616d", "#aa5a28", "#e0fbfc"], gravity: 120,
  });
  g.shakeAtLeast(4);
  g.events.push({ type: "anchorSnapped" });
}

/** The anchor hits the bottom: a cloud of sand (or bits of coral and grit) and a thud. */
function anchorLanded(g: Game, o: Obstacle, cx: number): void {
  const y = Math.min(GROUND_Y, o.drop?.to ?? GROUND_Y);
  const sand = o.bottom === "none";
  for (let i = 0; i < 22; i++) {
    const s = Math.random() < 0.5 ? -1 : 1;
    g.particles.push({
      x: cx + s * Math.random() * 30, y: y - 4,
      vx: s * (40 + Math.random() * 110), vy: -30 - Math.random() * 90,
      life: 0.5 + Math.random() * 0.6, maxLife: 1.1, size: 3 + Math.random() * 5,
      color: sand ? pick(["#e9d8a6", "#d4c08a", "#c9b27c"]) : pick(["#e9d8a6", o.color, "#cdb4db"]),
      gravity: 140, world: true,
    });
  }
  g.shakeAtLeast(7);
  g.events.push({ type: "anchorLanded" });
}
