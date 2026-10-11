// Obstacles (buildings, billboards, the church, coral, rocks, wrecks and
// anchors) and the scheduler that decides what takes each obstacle slot of a
// stage: a regular obstacle, a set piece (power line, balloon, wedding,
// fisherman) or the waterfront.

import { config, ramp } from "../config";
import { pick } from "../random";
import { anglerBusy, anglerDue, spawnAngler } from "./angler";
import { spawnBalloon } from "./balloons";
import type { Game } from "./game";
import { anchorRects, BOAT_W, spawnOceanObstacle, updateAnchorDrops, WRECK_END_INSET, WRECK_MAST_W, wreckGeometry, type AnchorDrop } from "./ocean-obstacles";
import type { Tabloid } from "./paparazzi";
import { powerLinesAllowed, spawnPowerLine } from "./power-lines";
import { sharkClearing, sharkThemeDue, startSharkTheme } from "./shark";
import { spawnShore } from "./stage";
import { CHURCH_SPIRE_H, CHURCH_TOWER_W, churchGeometry, spawnWedding, weddingDue } from "./wedding";
import { BIRD_RADIUS, GROUND_Y, type Rect, type Splat } from "./world";

/** Top fraction of the gap-centre range that makes a tall building (see pickGapCenter). */
const TALL_FRACTION = 0.4;

/** "none": open water down to the sea floor (only under an anchor). */
export type BottomKind = "billboard" | "building" | "tower" | "church" | "coral" | "rock" | "wreck" | "none";

export interface Obstacle {
  x: number;
  w: number;
  gapTop: number;
  gapBottom: number;
  bottom: BottomKind;
  color: string;
  seed: number;
  passed: boolean;
  splats: Splat[];
  /** Set when `bottom` is "billboard": the published front page it shows. */
  tabloid: Tabloid | null;
  /** Ocean: a boat floats at the surface with its anchor hanging down to `gapTop`. */
  anchor: boolean;
  /** Set when the boat drops its anchor as the fish comes near. */
  drop: AnchorDrop | null;
}

const BUILDING_COLORS = ["#c8553d", "#588b8b", "#8e7dbe", "#d4a373", "#6d8a96", "#b56576"];

/** The roadside billboard: a board at the bottom of the gap on steel legs (see obstacleRects). */
export const BILLBOARD_W = 230;
export const BILLBOARD_H = 140;
const BILLBOARD_MIN_LEGS = 40;
/** The legs' frame covers the middle of the board's width; the board overhangs on both sides. */
export const BILLBOARD_LEGS_INSET = 0.16;

/** Horizontal extent of an obstacle, including an anchor's boat (which is wider than the column). */
export function obstacleSpan(o: Obstacle): { left: number; right: number } {
  if (!o.anchor) return { left: o.x, right: o.x + o.w };
  const cx = o.x + o.w / 2;
  return { left: Math.min(o.x, cx - BOAT_W / 2), right: Math.max(o.x + o.w, cx + BOAT_W / 2) };
}

/**
 * Collision rectangles for an obstacle, shared by rendering and physics. The
 * bottom part comes first (rendering takes it as the column), then an anchor's.
 */
export function obstacleRects(o: Obstacle): Rect[] {
  const rects: Rect[] = [];
  if (o.bottom !== "none") rects.push(...bottomRects(o));
  if (o.anchor) rects.push(...anchorRects(o));
  return rects;
}

function bottomRects(o: Obstacle): Rect[] {
  const rects: Rect[] = [];
  if (o.bottom === "church") {
    const { cx, towerTop, naveTop } = churchGeometry(o);
    // The spire is a triangle: a narrow box at the tip and a wider one at the base.
    rects.push({ x: cx - 9, y: o.gapBottom, w: 18, h: CHURCH_SPIRE_H / 2 });
    rects.push({ x: cx - 20, y: o.gapBottom + CHURCH_SPIRE_H / 2, w: 40, h: CHURCH_SPIRE_H / 2 });
    rects.push({ x: cx - CHURCH_TOWER_W / 2, y: towerTop, w: CHURCH_TOWER_W, h: GROUND_Y - towerTop });
    rects.push({ x: o.x, y: naveTop - 14, w: o.w, h: GROUND_Y - naveTop + 14 });
    return rects;
  }
  if (o.bottom === "wreck") {
    const { deck, mastX } = wreckGeometry(o);
    rects.push({ x: o.x + WRECK_END_INSET, y: deck, w: o.w - WRECK_END_INSET * 2, h: GROUND_Y - deck });
    rects.push({ x: mastX - WRECK_MAST_W / 2, y: o.gapBottom, w: WRECK_MAST_W, h: deck - o.gapBottom });
    return rects;
  }
  // Bottom part rises from the ground to the gap (for a billboard: just the board, legs below).
  const billboard = o.bottom === "billboard";
  rects.push({ x: o.x, y: o.gapBottom, w: o.w, h: billboard ? BILLBOARD_H : GROUND_Y - o.gapBottom });
  if (billboard) {
    const inset = o.w * BILLBOARD_LEGS_INSET;
    const legsTop = o.gapBottom + BILLBOARD_H;
    rects.push({ x: o.x + inset, y: legsTop, w: o.w - inset * 2, h: GROUND_Y - legsTop });
  }
  return rects;
}

/**
 * A shark or the fisherman is still to come or under way this ocean stage: the far quay waits for them.
 * With both, the stage runs long enough to fit the fisherman and then the shark.
 */
function oceanSetPieceAhead(g: Game): boolean {
  return g.anglerPlanned || anglerBusy(g) || g.sharkPlanned || g.sharkTheme !== null || g.shark !== null;
}

export function updateObstacles(g: Game, dt: number, speed: number): void {
  for (const o of g.obstacles) o.x -= speed * dt;
  g.obstacles = g.obstacles.filter((o) => obstacleSpan(o).right > -60);
  updateAnchorDrops(g, dt, speed);

  for (const o of g.obstacles) {
    if (!o.passed && obstacleSpan(o).right < g.bird.x - BIRD_RADIUS) o.passed = true;
  }

  if (g.phase !== "playing" || g.demo) return;
  if (g.calmWater && g.stage === "ocean") {
    // Nothing spawns; the first obstacle stays a full delay ahead.
    g.delayNextObstacle(config.oceanFirstObstacleDelay);
    return;
  }
  if (g.calmCity && g.stage === "city") {
    g.delayNextObstacle(config.firstObstacleDelay);
    return;
  }

  if (!g.gateSpawned && g.distance >= g.nextObstacleAt && !sharkClearing(g)) {
    const ocean = g.stage === "ocean";
    const before = Math.round(ocean ? config.oceanObstacles : config.cityObstaclesBeforeGate);
    if (ocean && sharkThemeDue(g)) startSharkTheme(g);
    // The waterfront waits until a paparazzo's front page has hung in the city.
    // In the ocean it waits for the stage's shark and fisherman.
    const holdGate = ocean
      ? oceanSetPieceAhead(g)
      : g.pendingTabloids.length > 0 || g.targets.some((t) => t.pap?.state === "watching");
    // A power line takes up more room: the next obstacle waits until it's past.
    // So does a balloon, which drifts along with the wind.
    // A pending front page always gets the next slot.
    const special = g.stageObstacles > 0 && g.pendingTabloids.length === 0;
    const roll = Math.random();
    const powerLineChance = powerLinesAllowed(g) ? config.powerLineChance : 0;
    const powerLine = special && roll < powerLineChance;
    const balloon = special && !powerLine && roll < powerLineChance + config.balloonChance;
    let extra = 0;
    if (g.stageObstacles >= before && !holdGate) spawnShore(g);
    else if (ocean && anglerDue(g)) extra = spawnAngler(g);
    else if (ocean) extra = spawnOceanObstacle(g);
    else if (weddingDue(g)) extra = spawnWedding(g);
    else if (powerLine) extra = spawnPowerLine(g);
    else if (balloon) extra = spawnBalloon(g);
    else spawnObstacle(g);
    g.stageObstacles++;
    g.nextObstacleAt = g.distance + extra + (ocean
      ? ramp(config.oceanSpacing, config.oceanSpacingMin, g.difficulty)
      : ramp(config.obstacleSpacing, config.obstacleSpacingMin, g.difficulty));
  }
}

/**
 * Picks a gap centre in [top + margin + gap/2, GROUND_Y − bottomMargin − gap/2], within maxJump of the last one.
 * With `highChance`, the gap lands in the top TALL_FRACTION of that range (a tall building) only with that
 * chance, and lower down otherwise; without it, anywhere.
 */
export function pickGapCenter(g: Game, gap: number, top: number, margin: number, maxJump: number, bottomMargin = margin, highChance?: number): number {
  const minCenter = top + margin + gap / 2;
  const maxCenter = GROUND_Y - bottomMargin - gap / 2;
  let u = Math.random();
  if (highChance !== undefined) {
    u = Math.random() < highChance ? u * TALL_FRACTION : TALL_FRACTION + u * (1 - TALL_FRACTION);
  }
  let center = minCenter + u * Math.max(0, maxCenter - minCenter);
  center = Math.max(g.lastGapCenter - maxJump, Math.min(g.lastGapCenter + maxJump, center));
  center = Math.max(minCenter, Math.min(maxCenter, center));
  g.lastGapCenter = center;
  return center;
}

function spawnObstacle(g: Game): void {
  const d = g.difficulty;
  const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
  // A published photo goes up on a roadside billboard, which needs the whole board below the gap.
  const tabloid = g.pendingTabloids.shift() ?? null;
  // Limit how far the gap jumps, so the next gap is always reachable.
  // Tall buildings (a gap high up, a long climb) are rare in the first city and get more common.
  const tallChance = ramp(config.tallBuildingChance, config.tallBuildingChanceMax, g.stageLevel());
  const center = pickGapCenter(g, gap, 0, 50, 140 + 140 * d, tabloid ? BILLBOARD_H + BILLBOARD_MIN_LEGS : 50, tallChance);

  const bottom: BottomKind = tabloid ? "billboard" : pick(["building", "building", "building", "tower"]);
  const w = bottom === "billboard" ? BILLBOARD_W : bottom === "tower" ? 78 : 96 + Math.random() * 30;
  g.obstacles.push({
    x: g.width + 40, w,
    gapTop: center - gap / 2, gapBottom: center + gap / 2,
    bottom, color: pick(BUILDING_COLORS), seed: Math.random() * 1000,
    passed: false, splats: [], tabloid, anchor: false, drop: null,
  });
}
