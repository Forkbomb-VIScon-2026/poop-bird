// The street's targets (cars, pedestrians, statues, and the specials in
// their own modules): spawning, moving, and pedestrians cursing at the bird.

import { config } from "../config";
import { pick } from "../random";
import { type Chute, updateParachutist } from "./balloons";
import type { Game } from "./game";
import { type Kid, kidDue, spawnKid, updateKid } from "./kids";
import { obstacleSpan } from "./obstacles";
import { type Paparazzo, paparazzoDue, spawnPaparazzo, updatePaparazzo } from "./paparazzi";
import { poleX } from "./power-lines";
import { BUS_MODEL, CAR_COLORS, CAR_MODELS, driveCars, FAR_LANE_Y, keepCarsApart, laneRoom, NEAR_LANE_Y } from "./traffic";
import { type Wedding, weddingAhead } from "./wedding";
import { GROUND_Y, type Rect, type Splat } from "./world";

/** × the target spawn rate in attract mode, so there's always someone to hit. */
const DEMO_SPAWN_SCALE = 3;

/** Share of attract-mode targets that are cars (vs 0.5 in a run), so the faster spawning doesn't jam the road. */
const DEMO_CAR_SHARE = 0.2;

export type TargetKind = "car" | "pedestrian" | "statue" | "paparazzo" | "kid" | "bride" | "groom" | "guest" | "photographer" | "parachutist";

export interface Target {
  x: number;
  y: number; // bottom (sits on the road)
  w: number;
  h: number;
  kind: TargetKind;
  /** Own speed relative to the ground (px/s, + = forward). */
  speed: number;
  color: string;
  seed: number;
  splats: Splat[];
  hitFlash: number;
  facing: 1 | -1;
  /** Only on paparazzi. */
  pap: Paparazzo | null;
  /** Only on slingshot kids. */
  kid: Kid | null;
  /** Wedding guests and the couple react to how it's going. Set on wedding party members (and the getaway car). */
  wedding?: Wedding;
  /** Only on parachutists. */
  chute?: Chute | null;
  /** Set while a splatted pedestrian stands there cursing at the bird. */
  rage?: Rage | null;
  /** Only on cars: which model (see CAR_MODELS). */
  model?: number;
  /** Only on cars: the speed it drives at on an open road (px/s, ≥ 0; 0 = parked). */
  cruise?: number;
}

/** A pedestrian's fit of rage after being splatted. */
export interface Rage {
  /** Seconds since it started (restarts on another hit). */
  t: number;
  /** The walking speed to resume once it has calmed down. */
  walk: number;
  /** The grawlix in the speech bubble. */
  curse: string;
}

const CURSES = ["#@$%!", "%&#@!!", "$#!*@", "@#%&$!", "*!#@%"];

export const PERSON_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#fd79a8", "#00b894"];

export function targetRect(t: Target): Rect {
  return { x: t.x - t.w / 2, y: t.y - t.h, w: t.w, h: t.h };
}

export function updateTargets(g: Game, dt: number, speed: number): void {
  driveCars(g, dt);
  for (const t of g.targets) {
    t.x += (t.speed - speed) * dt;
    // Nobody walks or drives off the quay: they stop at its edge.
    const s = g.shore;
    if (s && g.stage === "city") {
      if (s.kind === "dive") t.x = Math.min(t.x, s.x - t.w / 2 - 6);
      else t.x = Math.max(t.x, s.x + t.w / 2 + 6);
    }
    t.hitFlash = Math.max(0, t.hitFlash - dt);
    if (t.pap) updatePaparazzo(g, t, dt);
    if (t.kid) updateKid(g, t, dt);
    if (t.chute) updateParachutist(g, t, dt, speed);
    if (t.rage) updateRage(g, t, dt);
  }
  keepCarsApart(g);
  g.targets = g.targets.filter((t) => t.x > -200 && t.x < g.width + 600);
  if (g.phase !== "playing" || g.stage !== "city" || g.shore?.kind === "dive") return;
  g.targetSpawnAcc += dt * config.targetSpawnRate * (g.demo ? DEMO_SPAWN_SCALE : 1);
  if (g.targetSpawnAcc >= 1) {
    g.targetSpawnAcc -= 1 + (Math.random() - 0.5) * 0.6;
    if (g.demo) spawnTarget(g);
    else if (!g.calmCity && paparazzoDue(g) && Math.random() < config.paparazziChance) spawnPaparazzo(g);
    else if (!g.calmCity && kidDue(g) && Math.random() < config.kidChance) spawnKid(g);
    // Nobody wanders through the wedding; the road stays busy.
    else spawnTarget(g, weddingAhead(g) ? "car" : undefined);
  }
}

/** Some splatted pedestrians stop, turn on the bird and curse; another hit sets them off again. */
export function provoke(g: Game, t: Target): void {
  if (t.kind !== "pedestrian" || t.wedding) return;
  if (!t.rage) {
    if (Math.random() >= config.angryChance) return;
    t.rage = { t: 0, walk: t.speed, curse: pick(CURSES) };
  } else {
    t.rage.t = 0;
    t.rage.curse = pick(CURSES.filter((c) => c !== t.rage?.curse));
  }
  t.speed = 0;
  g.events.push({ type: "curse" });
}

function updateRage(g: Game, t: Target, dt: number): void {
  const rage = t.rage;
  if (!rage) return;
  rage.t += dt;
  if (rage.t < config.angryDuration) {
    t.facing = g.bird.x < t.x ? -1 : 1;
    return;
  }
  // Calmed down (mostly): walk on as before.
  t.rage = null;
  t.speed = rage.walk;
  if (rage.walk !== 0) t.facing = rage.walk < 0 ? -1 : 1;
}

export function spawnTarget(g: Game, only?: "car"): void {
  const r = Math.random();
  const carShare = g.demo ? DEMO_CAR_SHARE : 0.5;
  let kind: TargetKind = only ?? (r < carShare ? "car" : r < 1 - config.statueChance ? "pedestrian" : "statue");
  if (kind === "statue" && !statueFits(g, g.width + 80, 46)) kind = "pedestrian";
  // Layout: sidewalk GROUND_Y..+20 (pedestrians, statue), road +20..+80 (cars, in two lanes).
  let t: Target;
  const seed = Math.random() * 1000;
  if (kind === "car") {
    const model = Math.floor(Math.random() * CAR_MODELS);
    const len = 92 * (model === BUS_MODEL ? 2.3 : 1.5);
    const x = g.width + 40 + len / 2;
    // Take the other lane if g one is busy at the corner. With both busy no car comes,
    // unless one has to: then it joins the shorter queue, further off-screen.
    const prefer: 1 | -1 = Math.random() < 0.6 ? 1 : -1;
    const room = { [prefer]: laneRoom(g, prefer, x, len), [-prefer]: laneRoom(g, -prefer as 1 | -1, x, len) };
    const dir: 1 | -1 = room[prefer] <= room[-prefer] ? prefer : (-prefer as 1 | -1);
    if (room[dir] > x && !only) return;
    const cruise = 40 + Math.random() * 90;
    t = {
      x: room[dir], y: dir === 1 ? NEAR_LANE_Y : FAR_LANE_Y, w: 92, h: 40, kind, speed: dir * cruise, cruise, model,
      color: pick(CAR_COLORS), seed, splats: [], hitFlash: 0, facing: dir, pap: null, kid: null, chute: null,
    };
  } else if (kind === "pedestrian") {
    const dir = Math.random() < 0.5 ? 1 : -1;
    t = {
      x: g.width + 60, y: GROUND_Y + 20, w: 24, h: 52, kind, speed: dir * (18 + Math.random() * 30),
      color: pick(PERSON_COLORS), seed, splats: [], hitFlash: 0, facing: dir as 1 | -1, pap: null, kid: null, chute: null,
    };
  } else {
    t = {
      x: g.width + 80, y: GROUND_Y + 20, w: 46, h: 96, kind, speed: 0,
      color: "#8fa3a8", seed, splats: [], hitFlash: 0, facing: -1, pap: null, kid: null, chute: null,
    };
  }
  g.targets.push(t);
}

/**
 * Whether a statue at x (centre) with width w stands clear of everything else
 * on the sidewalk: buildings, power-line poles, other statues and paparazzi,
 * and the slot the next obstacle (or the church, or the quay) will scroll into.
 */
function statueFits(g: Game, x: number, w: number): boolean {
  const margin = 24;
  const left = x - w / 2 - margin;
  const right = x + w / 2 + margin;
  const clear = (l: number, r: number) => r < left || l > right;
  for (const o of g.obstacles) {
    const s = obstacleSpan(o);
    if (!clear(s.left, s.right)) return false;
  }
  for (const l of g.powerLines) {
    for (let i = 0; i < l.poles; i++) if (!clear(poleX(l, i) - 6, poleX(l, i) + 6)) return false;
  }
  for (const t of g.targets) {
    if ((t.kind === "statue" || t.pap) && !clear(t.x - t.w / 2, t.x + t.w / 2)) return false;
  }
  // The next obstacle spawns at width + 40 once we've travelled up to
  // nextObstacleAt; by then g statue will have scrolled that far left.
  if (!g.demo && right > g.width + 40 + (g.nextObstacleAt - g.distance)) return false;
  return true;
}
