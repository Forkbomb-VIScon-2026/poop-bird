// The Doo-el: the two-player versus mode's simulation. Pure: no DOM, no global
// config. Params come in (the live `config` object satisfies DuelParams), the
// controller (duel-main.ts) feeds each player's { straining, steer } every
// fixed step and drains `events`, like Game / GameEvent.
//
// World: x across the avenue (0 = centre line), y altitude (0 = street, up is
// positive), z along the avenue. Both birds share one z that advances at the
// match speed; gates and targets sit at (or move along) z and come toward them.
//
// The vertical feel is the main game's: same gravity, fall caps, charge
// (charge.ts), pushes and fall cancel, with the altitude range (0..ceiling)
// about the main playfield's height. What the duel adds:
// - steering: a lateral velocity command (a banked head, or keys),
// - poops falling on whoever is below (bombs), targets on the street,
// - gates: axis-aligned solid rects in the (x, y) plane over a z range,
// - crashes respawn the bird with a point penalty; nobody is ever out.

import { initialChargeState, inSweetSpot, stepCharge, type ChargeParams, type ChargeState } from "./charge";

export const DUEL_STEP = 1 / 120;
/** Seconds of 3-2-1 before GO. */
export const DUEL_COUNTDOWN = 3;
/** Altitude the birds hover at before GO and respawn at. */
export const DUEL_START_ALTITUDE = 250;
export const DUEL_RESPAWN_ALTITUDE = 280;
/** How fast the bird's sideways speed follows the steer command (1/s). */
const STEER_RESPONSE = 8;
/** Downward speed after bumping the ceiling. */
const CEILING_BOUNCE = 30;
/** Upward speed the street gives back to a shielded (just respawned) bird. */
const SHIELD_BOUNCE = 320;
/** Seconds between two "bump" events while the birds stay in contact. */
const BUMP_COOLDOWN = 0.3;
/** Sidewalk width (inside the avenue): pedestrians walk here. */
export const SIDEWALK = 55;
/** Crosswalks are painted every this many units of z. */
export const CROSSWALK_EVERY = 1400;
/** The finish arch passes the birds this long after the timer runs out. */
const FINISH_GLIDE = 1;
/** Altitude the birds glide at after time's up. */
const FINISH_ALTITUDE = 220;
/** Maximum poops in flight (a runaway input can't grow the arrays forever). */
const MAX_POOPS = 60;
const MAX_DECALS = 80;

/** Target points multipliers, as in the main game. */
export const TARGET_MULTIPLIER = { car: 1, pedestrian: 1.5, statue: 2 } as const;

export interface DuelParams extends ChargeParams {
  gravity: number;
  maxFallSpeed: number;
  chargeGravityScale: number;
  chargeMaxFallSpeed: number;
  fallCancel: number;
  startGrace: number;
  targetPoints: number;
  comboStep: number;
  comboMax: number;
  duelMatchTime: number;
  duelSpeed: number;
  duelSpeedRamp: number;
  duelCeiling: number;
  duelAvenueHalfWidth: number;
  duelBirdRadius: number;
  duelLateralSpeed: number;
  duelPoopGravity: number;
  duelBombStun: number;
  duelBombKnock: number;
  duelBombPoints: number;
  duelBombImmunity: number;
  duelGateSpacing: number;
  duelGateSpacingMin: number;
  duelMinOpening: number;
  duelFirstGateDelay: number;
  duelCrashPenalty: number;
  duelRespawnTime: number;
  duelInvulnTime: number;
  duelBumpBounce: number;
  duelTargetRate: number;
  duelStatueChance: number;
  duelCameraBack: number;
  duelDrawDistance: number;
}

export type PlayerId = 0 | 1;
export type DuelPhase = "countdown" | "playing" | "finishing" | "over";

export interface DuelInput {
  straining: boolean;
  /** Lateral velocity command, -1 (full left) .. 1 (full right). 0 = keep going straight. */
  steer: number;
}

/** A solid rectangle in the (x, y) plane. */
export interface GateRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  part: "deck" | "cloth" | "pole" | "wire" | "wall";
}

export type GateKind = "footbridge" | "banner" | "wires" | "arch" | "finish";

export interface Gate {
  id: number;
  kind: GateKind;
  /** Front face (the side facing the birds). */
  z: number;
  depth: number;
  rects: GateRect[];
  /** The arch's hole (for drawing). */
  opening: GateRect | null;
  passed: [boolean, boolean];
  /** No longer solid (time's up): drawn fading out. */
  ghost: boolean;
  splats: { x: number; y: number; r: number; seed: number }[];
  seed: number;
}

export type TargetKind = "car" | "pedestrian" | "statue";

export interface DuelTarget {
  id: number;
  kind: TargetKind;
  x: number;
  z: number;
  /** World velocity (z: along the avenue, x: across, for people on a crosswalk). */
  vx: number;
  vz: number;
  /** Footprint across (w) and along (d) the avenue, and height. */
  w: number;
  d: number;
  h: number;
  color: number;
  splats: number;
  hitFlash: number;
  seed: number;
}

export interface DuelPoop {
  owner: PlayerId;
  x: number;
  y: number;
  z: number;
  vy: number;
  vz: number;
  r: number;
  big: boolean;
  rot: number;
}

export interface PlayerStats {
  targets: number;
  targetPoints: number;
  bombs: number;
  bombPoints: number;
  bombed: number;
  crashes: number;
  /** Points actually lost to crashes (the score floors at 0). */
  penalty: number;
  accidents: number;
  poops: number;
  perfects: number;
  gates: number;
  bestCombo: number;
}

export interface DuelBird {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  charge: ChargeState;
  state: "flying" | "crashed";
  /** Seconds of tumbling left after a crash. */
  crashTime: number;
  /** Respawn shield: immune to gates and bombs, and the street bounces it back. */
  invuln: number;
  /** Seconds left of bomb immunity. */
  bombImmune: number;
  /** Seconds left of the splat drawn on its back. */
  splatted: number;
  score: number;
  combo: number;
  stats: PlayerStats;
  /** Animation timers (seconds left). */
  flap: number;
  relief: number;
  /** Tumble rotation (radians). */
  rot: number;
}

export type CrashCause = "gate" | "street" | "statue";

export type DuelEvent =
  | { type: "go" }
  | { type: "timeUp" }
  | { type: "finish"; winner: PlayerId | null }
  | { type: "release"; player: PlayerId; charge: number; sweet: boolean; x: number; y: number }
  | { type: "accident"; player: PlayerId; x: number; y: number }
  | { type: "bomb"; player: PlayerId; victim: PlayerId; points: number; big: boolean; x: number; y: number }
  | { type: "bump"; x: number; y: number }
  | { type: "ceiling"; player: PlayerId }
  | { type: "crash"; player: PlayerId; cause: CrashCause; penalty: number; x: number; y: number }
  | { type: "respawn"; player: PlayerId }
  | { type: "targetHit"; player: PlayerId; kind: TargetKind; points: number; combo: number; big: boolean; x: number; y: number; z: number }
  | { type: "splat"; player: PlayerId; where: "street" | "gate"; big: boolean; comboLost: boolean; x: number; y: number; z: number }
  | { type: "gatePassed"; player: PlayerId; kind: GateKind };

export interface Decal {
  x: number;
  z: number;
  r: number;
  seed: number;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export function emptyStats(): PlayerStats {
  return { targets: 0, targetPoints: 0, bombs: 0, bombPoints: 0, bombed: 0, crashes: 0, penalty: 0, accidents: 0, poops: 0, perfects: 0, gates: 0, bestCombo: 0 };
}

/** A player's home lane: P1 on the left, P2 on the right. */
export function homeLane(id: PlayerId, halfWidth: number): number {
  return (id === 0 ? -0.5 : 0.5) * halfWidth;
}

/** Whether a circle overlaps an axis-aligned rect (touching counts). */
export function circleRect(cx: number, cy: number, r: number, rect: GateRect): boolean {
  const nx = clamp(cx, rect.x0, rect.x1);
  const ny = clamp(cy, rect.y0, rect.y1);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

/** Whether a bird at (x, y) would hit a solid part of the gate (ignoring z). */
export function birdHitsGate(x: number, y: number, r: number, gate: Gate): boolean {
  if (gate.ghost) return false;
  for (const rect of gate.rects) if (circleRect(x, y, r, rect)) return true;
  return false;
}

/** Whether a bird at z is inside the gate's z range. */
export function insideGateZ(z: number, gate: Gate): boolean {
  return z >= gate.z && z <= gate.z + gate.depth;
}

export interface PassParams {
  duelAvenueHalfWidth: number;
  duelCeiling: number;
  duelMinOpening: number;
}

/**
 * Whether the gate leaves an opening at least `duelMinOpening` wide and high
 * inside the avenue, between the street and the ceiling. Sweeps every box
 * spanned by the rects' edges; a gate has a handful of rects, so it's cheap.
 */
export function gatePassable(gate: Gate, p: PassParams): boolean {
  const W = p.duelAvenueHalfWidth;
  const top = p.duelCeiling;
  const m = p.duelMinOpening;
  const rects = gate.ghost ? [] : gate.rects;
  const xs = [-W, W];
  const ys = [0, top];
  for (const r of rects) {
    xs.push(clamp(r.x0, -W, W), clamp(r.x1, -W, W));
    ys.push(clamp(r.y0, 0, top), clamp(r.y1, 0, top));
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const blocked = (x0: number, x1: number, y0: number, y1: number) =>
    rects.some((r) => r.x0 < x1 && r.x1 > x0 && r.y0 < y1 && r.y1 > y0);
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] - xs[i] < m) continue;
      for (let k = 0; k < ys.length; k++) {
        for (let l = k + 1; l < ys.length; l++) {
          if (ys[l] - ys[k] < m) continue;
          if (!blocked(xs[i], xs[j], ys[k], ys[l])) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Time for a poop released at altitude `y` with downward speed `v0` to reach
 * the street (y - r = 0) under gravity `g`.
 */
export function poopFallTime(y: number, r: number, v0: number, g: number): number {
  const h = Math.max(0, y - r);
  if (g <= 1e-6) return v0 > 1e-6 ? h / v0 : Infinity;
  return (-v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
}

/** Downward speed and radius of a poop released at `charge`, as in the main game. */
export function poopLaunch(charge: number, birdVy: number): { v0: number; r: number } {
  const c = clamp(charge, 0, 1);
  return { v0: 140 + c * 260 + Math.max(0, -birdVy * 0.2), r: 5 + c * 7 };
}

export class Duel {
  readonly params: DuelParams;
  readonly seed: number;
  private rng: () => number;
  phase: DuelPhase = "countdown";
  /** Seconds of countdown left. */
  countdown = DUEL_COUNTDOWN;
  /** Seconds since the duel was created / since GO. */
  time = 0;
  playTime = 0;
  /** Seconds of match left. */
  timeLeft: number;
  /** The match length this duel started with (the timer bar). */
  readonly matchTime: number;
  /** The birds' shared z. */
  z = 0;
  speed: number;
  birds: [DuelBird, DuelBird];
  gates: Gate[] = [];
  targets: DuelTarget[] = [];
  poops: DuelPoop[] = [];
  decals: Decal[] = [];
  events: DuelEvent[] = [];
  /** z of the next gate (null until GO). */
  private nextGateZ: number | null = null;
  finishZ: number | null = null;
  private targetDue = 0;
  private bumpCooldown = 0;
  private nextId = 1;
  private lastKind: GateKind | null = null;
  winner: PlayerId | null = null;

  constructor(params: DuelParams, seed = 1) {
    this.params = params;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.matchTime = Math.max(1, params.duelMatchTime);
    this.timeLeft = this.matchTime;
    this.speed = params.duelSpeed;
    this.birds = [this.makeBird(0), this.makeBird(1)];
  }

  private makeBird(id: PlayerId): DuelBird {
    return {
      id, x: homeLane(id, this.params.duelAvenueHalfWidth), y: DUEL_START_ALTITUDE, vx: 0, vy: 0,
      charge: initialChargeState(), state: "flying", crashTime: 0, invuln: 0, bombImmune: 0, splatted: 0,
      score: 0, combo: 0, stats: emptyStats(), flap: 0, relief: 0, rot: 0,
    };
  }

  get stunned(): [boolean, boolean] {
    return [this.birds[0].charge.stun > 0, this.birds[1].charge.stun > 0];
  }

  /** 0..1 through the match. */
  get progress(): number {
    return clamp(this.playTime / this.matchTime, 0, 1);
  }

  /** Combo multiplier for a combo count, as in the main game. */
  comboMultiplier(combo: number): number {
    if (combo <= 0) return 1;
    return Math.min(this.params.comboMax, 1 + this.params.comboStep * (combo - 1));
  }

  /** Overstrain danger 0..1 for the bird's look (trembling), like Game.overstrainProgress. */
  overstrain(id: PlayerId): number {
    const c = this.birds[id].charge;
    if (c.charge < 1) return 0;
    return clamp(c.fullHold / Math.max(1e-3, this.params.overstrainTime), 0, 1);
  }

  sweetSpot(id: PlayerId): boolean {
    return inSweetSpot(this.birds[id].charge, this.params);
  }

  /** Where a poop released now would land: (x, z) on the street. null if the bird can't poop. */
  landingSpot(id: PlayerId): { x: number; z: number } | null {
    const b = this.birds[id];
    if (b.state !== "flying") return null;
    const { v0, r } = poopLaunch(b.charge.charge, b.vy);
    const t = poopFallTime(b.y - this.params.duelBirdRadius * 0.8, r, v0, this.params.duelPoopGravity);
    if (!Number.isFinite(t)) return null;
    return { x: b.x, z: this.z + this.speed * t };
  }

  /** The leader (null on a tie). */
  leader(): PlayerId | null {
    const [a, b] = this.birds;
    return a.score === b.score ? null : a.score > b.score ? 0 : 1;
  }

  // --- stepping ------------------------------------------------------------

  step(dt: number, inputs: readonly [DuelInput, DuelInput]): void {
    if (!(dt > 0)) return;
    const p = this.params;
    this.time += dt;
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = "playing";
        this.nextGateZ = this.z + this.speed * Math.max(0, p.duelFirstGateDelay);
        this.events.push({ type: "go" });
      }
    } else if (this.phase === "playing") {
      this.playTime += dt;
      this.timeLeft = Math.max(0, this.matchTime - this.playTime);
      if (this.timeLeft <= 0) this.timeUp();
    }

    this.speed = p.duelSpeed * (1 + p.duelSpeedRamp * this.progress);
    this.z += this.speed * dt;

    const control = this.phase === "playing";
    for (const b of this.birds) {
      const input = inputs[b.id];
      const straining = control && !!input?.straining;
      const steer = control ? clamp(finite(input?.steer ?? 0), -1, 1) : 0;
      this.updateBird(b, straining, steer, dt);
    }
    this.bump(dt);
    this.updatePoops(dt);
    this.updateTargets(dt);
    this.updateGates();

    if (this.phase === "finishing" && this.finishZ !== null && this.z >= this.finishZ) {
      this.phase = "over";
      this.winner = this.leader();
      this.events.push({ type: "finish", winner: this.winner });
    }
  }

  private timeUp(): void {
    this.phase = "finishing";
    this.events.push({ type: "timeUp" });
    if (this.finishZ === null || this.finishZ < this.z + this.speed * 0.5) {
      this.finishZ = this.z + this.speed * FINISH_GLIDE;
      this.spawnFinish(this.finishZ);
    }
    for (const g of this.gates) if (g.kind !== "finish" && g.z + g.depth > this.z) g.ghost = true;
    for (const b of this.birds) {
      // No last-second poop: the strain just ends.
      b.charge = { ...initialChargeState(), stun: 0 };
    }
  }

  // --- birds ---------------------------------------------------------------

  private updateBird(b: DuelBird, straining: boolean, steer: number, dt: number): void {
    const p = this.params;
    const R = p.duelBirdRadius;
    const W = p.duelAvenueHalfWidth;
    b.flap = Math.max(0, b.flap - dt);
    b.relief = Math.max(0, b.relief - dt);
    b.invuln = Math.max(0, b.invuln - dt);
    b.bombImmune = Math.max(0, b.bombImmune - dt);
    b.splatted = Math.max(0, b.splatted - dt);

    if (b.state === "crashed") {
      b.crashTime -= dt;
      b.rot += dt * 12;
      b.vy = Math.max(-900, b.vy - p.gravity * 2.5 * dt);
      b.y += b.vy * dt;
      b.vx *= Math.exp(-3 * dt);
      b.x = clamp(b.x + b.vx * dt, -(W - R), W - R);
      if (b.y <= R) {
        b.y = R;
        b.vy = 0;
      }
      if (b.crashTime <= 0) this.respawn(b);
      return;
    }

    if (this.phase === "countdown" || this.phase === "finishing" || this.phase === "over") {
      // Hovering before GO; gliding through the finish after time's up.
      const alt = this.phase === "countdown" ? DUEL_START_ALTITUDE : FINISH_ALTITUDE;
      const k = 1 - Math.exp(-3 * dt);
      b.y += (alt - b.y) * k;
      b.vy = 0;
      if (this.phase !== "countdown") b.x += (homeLane(b.id, W) - b.x) * k;
      b.vx = 0;
      b.charge = this.phase === "countdown" ? b.charge : initialChargeState();
      this.unwind(b, dt);
      return;
    }

    // Charge (strain → release → overstrain), the main game's state machine.
    const { state, event } = stepCharge(b.charge, straining, dt, p);
    b.charge = state;
    if (event?.type === "release") this.release(b, event.charge, event.push, event.sweetSpot);
    else if (event?.type === "accident") this.accident(b, event.charge);

    // Vertical: the main game's gravity and fall caps (falls slower while charging).
    const stunned = b.charge.stun > 0;
    const charging = b.charge.charge > 0 && !stunned;
    const grace = p.startGrace > 0 ? Math.min(1, this.playTime / p.startGrace) : 1;
    const g = p.gravity * grace * (charging ? p.chargeGravityScale : 1);
    const maxFall = charging ? Math.min(p.maxFallSpeed, p.chargeMaxFallSpeed) : p.maxFallSpeed;
    let fall = -b.vy;
    fall = fall > maxFall ? Math.max(maxFall, fall - g * 3 * dt) : Math.min(fall + g * dt, maxFall);
    b.vy = -fall;
    b.y += b.vy * dt;

    // Steering: the bird's sideways speed follows the command (a bank, not a teleport).
    const target = (stunned ? 0 : steer) * p.duelLateralSpeed;
    b.vx += (target - b.vx) * (1 - Math.exp(-STEER_RESPONSE * dt));
    b.x += b.vx * dt;
    this.clampLateral(b);

    // Soft ceiling: bump off it, no damage.
    const top = p.duelCeiling - R;
    if (b.y > top) {
      b.y = top;
      if (b.vy > 0) {
        if (b.vy > 60) this.events.push({ type: "ceiling", player: b.id });
        b.vy = -CEILING_BOUNCE;
      }
    }

    if (stunned) b.rot += dt * 14;
    else this.unwind(b, dt);

    // Street.
    if (b.y <= R) {
      if (b.invuln > 0) {
        b.y = R;
        b.vy = SHIELD_BOUNCE;
      } else {
        b.y = R;
        this.crash(b, "street");
        return;
      }
    }
    if (b.invuln > 0) return;
    for (const gate of this.gates) {
      if (gate.ghost || !insideGateZ(this.z, gate)) continue;
      if (birdHitsGate(b.x, b.y, R, gate)) {
        this.crash(b, "gate");
        return;
      }
    }
    for (const t of this.targets) {
      if (t.kind !== "statue" || Math.abs(this.z - t.z) > t.d / 2) continue;
      if (circleRect(b.x, b.y, R, { x0: t.x - t.w / 2, x1: t.x + t.w / 2, y0: 0, y1: t.h, part: "wall" })) {
        this.crash(b, "statue");
        return;
      }
    }
  }

  private unwind(b: DuelBird, dt: number): void {
    const wound = b.rot - Math.round(b.rot / (Math.PI * 2)) * Math.PI * 2;
    b.rot = wound * Math.exp(-10 * dt);
  }

  private clampLateral(b: DuelBird): void {
    const lim = Math.max(0, this.params.duelAvenueHalfWidth - this.params.duelBirdRadius);
    if (b.x < -lim) {
      b.x = -lim;
      if (b.vx < 0) b.vx = 0;
    } else if (b.x > lim) {
      b.x = lim;
      if (b.vx > 0) b.vx = 0;
    }
  }

  private release(b: DuelBird, charge: number, push: number, sweet: boolean): void {
    const p = this.params;
    if (b.vy < 0) b.vy *= 1 - p.fallCancel;
    b.vy += push;
    b.relief = 0.45;
    b.flap = 0.35;
    b.stats.poops++;
    if (sweet) b.stats.perfects++;
    this.spawnPoop(b, charge, false);
    this.events.push({ type: "release", player: b.id, charge, sweet, x: b.x, y: b.y });
  }

  private accident(b: DuelBird, _charge: number): void {
    b.stats.accidents++;
    // A big messy blob: it can still land on someone.
    this.spawnPoop(b, 1, true);
    this.events.push({ type: "accident", player: b.id, x: b.x, y: b.y });
  }

  private spawnPoop(b: DuelBird, charge: number, big: boolean): void {
    if (this.poops.length >= MAX_POOPS) this.poops.shift();
    const launch = poopLaunch(charge, b.vy);
    this.poops.push({
      owner: b.id, x: b.x, y: b.y - this.params.duelBirdRadius * 0.8, z: this.z,
      vy: big ? -60 : -launch.v0, vz: this.speed, r: big ? 16 : launch.r, big, rot: this.rng() * 6,
    });
  }

  private crash(b: DuelBird, cause: CrashCause): void {
    const p = this.params;
    const penalty = Math.min(b.score, Math.max(0, Math.round(p.duelCrashPenalty)));
    b.score -= penalty;
    b.stats.penalty += penalty;
    b.stats.crashes++;
    b.combo = 0;
    b.state = "crashed";
    b.crashTime = Math.max(0.05, p.duelRespawnTime);
    b.charge = initialChargeState();
    b.vy = cause === "street" ? 0 : Math.min(b.vy, 60);
    b.splatted = 0;
    this.events.push({ type: "crash", player: b.id, cause, penalty, x: b.x, y: b.y });
  }

  private respawn(b: DuelBird): void {
    b.state = "flying";
    b.crashTime = 0;
    b.x = homeLane(b.id, this.params.duelAvenueHalfWidth);
    b.y = Math.min(DUEL_RESPAWN_ALTITUDE, this.params.duelCeiling - this.params.duelBirdRadius);
    b.vx = 0;
    b.vy = 0;
    b.rot = 0;
    b.invuln = this.params.duelInvulnTime;
    // A strain still held from before the crash must not fire.
    b.charge = { ...initialChargeState(), needsRelease: true };
    this.events.push({ type: "respawn", player: b.id });
  }

  /** Bird–bird contact: shove them apart along the contact normal with a small bounce. */
  private bump(dt: number): void {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    const [a, b] = this.birds;
    if (a.state !== "flying" || b.state !== "flying") return;
    const R = this.params.duelBirdRadius;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    if (d >= 2 * R) return;
    if (d < 1e-6) {
      dx = 1;
      dy = 0;
      d = 1e-6;
    }
    const nx = d < 1e-5 ? 1 : dx / d;
    const ny = d < 1e-5 ? 0 : dy / d;
    const overlap = 2 * R - d;
    a.x -= (nx * overlap) / 2;
    a.y -= (ny * overlap) / 2;
    b.x += (nx * overlap) / 2;
    b.y += (ny * overlap) / 2;
    const k = this.params.duelBumpBounce;
    a.vx -= nx * k;
    a.vy -= ny * k;
    b.vx += nx * k;
    b.vy += ny * k;
    this.clampLateral(a);
    this.clampLateral(b);
    // Never shove a bird through the ceiling.
    const top = this.params.duelCeiling - R;
    for (const bird of this.birds) if (bird.y > top) bird.y = top;
    if (this.bumpCooldown <= 0) {
      this.bumpCooldown = BUMP_COOLDOWN;
      this.events.push({ type: "bump", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  // --- poops ---------------------------------------------------------------

  private updatePoops(dt: number): void {
    const keep: DuelPoop[] = [];
    for (const poop of this.poops) {
      poop.vy -= this.params.duelPoopGravity * dt;
      poop.y += poop.vy * dt;
      poop.z += poop.vz * dt;
      poop.rot += dt * 4;
      if (!this.poopHits(poop)) keep.push(poop);
    }
    this.poops = keep;
  }

  /** Returns true if the poop is used up. */
  private poopHits(poop: DuelPoop): boolean {
    const p = this.params;
    const R = p.duelBirdRadius;
    // 1. The rival bird, from above only.
    for (const b of this.birds) {
      if (b.id === poop.owner || b.state !== "flying" || b.invuln > 0 || b.bombImmune > 0) continue;
      if (poop.y < b.y || Math.abs(poop.z - this.z) > R + poop.r + 10) continue;
      const reach = R + poop.r;
      if ((poop.x - b.x) ** 2 + (poop.y - b.y) ** 2 > reach * reach) continue;
      this.bomb(this.birds[poop.owner], b, poop);
      return true;
    }
    // 2. A gate's solid part.
    for (const g of this.gates) {
      if (g.ghost || poop.z < g.z - poop.r || poop.z > g.z + g.depth + poop.r) continue;
      for (const rect of g.rects) {
        if (!circleRect(poop.x, poop.y, poop.r, rect)) continue;
        if (g.splats.length < 12) g.splats.push({ x: poop.x, y: poop.y, r: poop.r * 1.3, seed: this.rng() * 1000 });
        this.events.push({ type: "splat", player: poop.owner, where: "gate", big: poop.big, comboLost: false, x: poop.x, y: poop.y, z: poop.z });
        return true;
      }
    }
    // 3. A target (they stick up from the street).
    for (const t of this.targets) {
      if (poop.y - poop.r > t.h) continue;
      if (Math.abs(poop.x - t.x) > t.w / 2 + poop.r || Math.abs(poop.z - t.z) > t.d / 2 + poop.r) continue;
      this.hitTarget(this.birds[poop.owner], t, poop);
      return true;
    }
    // 4. The street.
    if (poop.y - poop.r <= 0) {
      const owner = this.birds[poop.owner];
      const comboLost = owner.combo > 0;
      owner.combo = 0;
      this.decals.push({ x: poop.x, z: poop.z, r: poop.r * 1.6, seed: this.rng() * 1000 });
      if (this.decals.length > MAX_DECALS) this.decals.shift();
      this.events.push({ type: "splat", player: poop.owner, where: "street", big: poop.big, comboLost, x: poop.x, y: 0, z: poop.z });
      return true;
    }
    return false;
  }

  private bomb(bomber: DuelBird, victim: DuelBird, poop: DuelPoop): void {
    const p = this.params;
    victim.charge = { charge: 0, fullHold: 0, stun: Math.max(0, p.duelBombStun), needsRelease: true };
    victim.vy = Math.min(victim.vy, -p.duelBombKnock);
    victim.splatted = Math.max(0.6, p.duelBombStun);
    victim.bombImmune = p.duelBombImmunity;
    victim.combo = 0;
    victim.stats.bombed++;
    const points = Math.round(p.duelBombPoints * (poop.big ? 2 : 1));
    bomber.score += points;
    bomber.stats.bombs++;
    bomber.stats.bombPoints += points;
    this.events.push({ type: "bomb", player: bomber.id, victim: victim.id, points, big: poop.big, x: victim.x, y: victim.y });
  }

  private hitTarget(b: DuelBird, t: DuelTarget, poop: DuelPoop): void {
    t.splats++;
    t.hitFlash = 0.3;
    b.combo++;
    b.stats.bestCombo = Math.max(b.stats.bestCombo, b.combo);
    b.stats.targets++;
    const points = Math.round(this.params.targetPoints * TARGET_MULTIPLIER[t.kind] * this.comboMultiplier(b.combo) * (poop.big ? 2 : 1));
    b.score += points;
    b.stats.targetPoints += points;
    this.events.push({ type: "targetHit", player: b.id, kind: t.kind, points, combo: b.combo, big: poop.big, x: poop.x, y: Math.min(t.h, Math.max(0, poop.y)), z: poop.z });
  }

  // --- targets -------------------------------------------------------------

  private updateTargets(dt: number): void {
    const p = this.params;
    const W = p.duelAvenueHalfWidth;
    for (const t of this.targets) {
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.hitFlash = Math.max(0, t.hitFlash - dt);
    }
    const behind = this.z - p.duelCameraBack - 50;
    this.targets = this.targets.filter((t) => t.z > behind && Math.abs(t.x) < W + 60);
    if (this.phase === "over") return;
    this.targetDue += dt * Math.max(0, p.duelTargetRate);
    let guard = 0;
    while (this.targetDue >= 1 && guard++ < 8) {
      this.targetDue -= 1;
      this.spawnTarget();
    }
  }

  /** Spawns a target just beyond the draw distance (or at `z` for tests). */
  spawnTarget(kind?: TargetKind, z?: number): DuelTarget | null {
    const p = this.params;
    const W = p.duelAvenueHalfWidth;
    const r = this.rng;
    const at = z ?? this.z + p.duelDrawDistance + r() * 200;
    let k: TargetKind = kind ?? (r() < p.duelStatueChance ? "statue" : r() < 0.6 ? "car" : "pedestrian");
    if (k === "statue" && kind === undefined && !this.statueFits(at)) k = "car";
    const base = { id: this.nextId++, z: at, splats: 0, hitFlash: 0, seed: r() * 1000, color: Math.floor(r() * 6) };
    let t: DuelTarget;
    if (k === "car") {
      const road = W - SIDEWALK;
      const away = r() < 0.5;
      const lane = r() < 0.5 ? 0.3 : 0.72;
      const x = (away ? 1 : -1) * road * lane;
      t = { ...base, kind: k, x, vx: 0, vz: away ? 90 + r() * 80 : -(80 + r() * 70), w: 64, d: 130, h: 44 };
    } else if (k === "pedestrian") {
      const crossing = r() < 0.3;
      if (crossing) {
        const cz = Math.ceil(at / CROSSWALK_EVERY) * CROSSWALK_EVERY;
        const dir = r() < 0.5 ? 1 : -1;
        t = { ...base, z: cz, kind: k, x: -dir * (W - SIDEWALK * 0.5), vx: dir * (35 + r() * 20), vz: 0, w: 26, d: 26, h: 52 };
      } else {
        const side = r() < 0.5 ? -1 : 1;
        t = { ...base, kind: k, x: side * (W - SIDEWALK * 0.5 + (r() - 0.5) * 16), vx: 0, vz: (r() < 0.5 ? 1 : -1) * (15 + r() * 25), w: 26, d: 26, h: 52 };
      }
    } else {
      t = { ...base, kind: "statue", x: 0, vx: 0, vz: 0, w: 44, d: 44, h: 100 };
    }
    this.targets.push(t);
    return t;
  }

  /** A statue on the median must stand clear of gates and other statues. */
  private statueFits(z: number): boolean {
    for (const g of this.gates) if (z > g.z - 250 && z < g.z + g.depth + 250) return false;
    if (this.nextGateZ !== null && Math.abs(z - this.nextGateZ) < 250) return false;
    for (const t of this.targets) if (t.kind === "statue" && Math.abs(t.z - z) < 600) return false;
    return true;
  }

  // --- gates ---------------------------------------------------------------

  private updateGates(): void {
    const p = this.params;
    // Passed: the birds' z went past the gate's back face.
    for (const g of this.gates) {
      for (const b of this.birds) {
        if (g.passed[b.id] || this.z <= g.z + g.depth) continue;
        g.passed[b.id] = true;
        if (b.state === "flying" && g.kind !== "finish" && !g.ghost) {
          b.stats.gates++;
          this.events.push({ type: "gatePassed", player: b.id, kind: g.kind });
        }
      }
    }
    const behind = this.z - p.duelCameraBack - 100;
    this.gates = this.gates.filter((g) => g.z + g.depth > behind);

    if (this.phase !== "playing" || this.nextGateZ === null) return;
    // The finish arch comes into view before time's up, so it doesn't pop in.
    if (this.finishZ === null && this.timeLeft * this.speed < p.duelDrawDistance) {
      this.finishZ = this.z + this.speed * (this.timeLeft + FINISH_GLIDE);
      this.spawnFinish(this.finishZ);
    }
    const horizon = this.z + p.duelDrawDistance + 600;
    let guard = 0;
    let z: number = this.nextGateZ;
    while (z < horizon && guard++ < 8) {
      if (this.finishZ !== null && z > this.finishZ - 500) break;
      this.spawnGate(z);
      const spacing = p.duelGateSpacing + (p.duelGateSpacingMin - p.duelGateSpacing) * this.progress;
      z += Math.max(200, spacing);
    }
    this.nextGateZ = z;
  }

  private spawnFinish(z: number): void {
    this.gates.push({
      id: this.nextId++, kind: "finish", z, depth: 20, rects: [], opening: null,
      passed: [false, false], ghost: false, splats: [], seed: 0,
    });
  }

  /** Spawns a random gate at z (exposed for the debug key and tests). */
  spawnGate(z: number, kind?: GateKind): Gate {
    const k = kind ?? this.pickKind();
    const gate = makeGate(k, z, this.rng, this.params, this.progress, this.nextId++);
    this.lastKind = k;
    this.gates.push(gate);
    return gate;
  }

  /** Debug: a gate a couple of seconds ahead, right now. */
  spawnGateNow(kind?: GateKind): Gate {
    return this.spawnGate(this.z + this.speed * 2, kind);
  }

  private pickKind(): GateKind {
    const r = this.rng;
    const prog = this.progress;
    const weights: [GateKind, number][] = [
      ["footbridge", 0.3],
      ["banner", 0.25],
      ["wires", 0.25],
      ["arch", prog > 0.12 ? 0.25 : 0],
    ];
    // Not the same kind twice in a row.
    const pool = weights.filter(([k, w]) => w > 0 && k !== this.lastKind);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let x = r() * total;
    for (const [k, w] of pool) {
      x -= w;
      if (x <= 0) return k;
    }
    return pool[pool.length - 1][0];
  }
}

/** Builds a gate of the given kind. Every kind leaves an opening of at least duelMinOpening. */
export function makeGate(
  kind: GateKind,
  z: number,
  rng: () => number,
  p: Pick<DuelParams, "duelAvenueHalfWidth" | "duelCeiling" | "duelMinOpening" | "duelBirdRadius">,
  progress: number,
  id: number,
): Gate {
  const W = p.duelAvenueHalfWidth;
  const top = p.duelCeiling;
  const m = p.duelMinOpening;
  const margin = 12;
  const gate: Gate = { id, kind, z, depth: 20, rects: [], opening: null, passed: [false, false], ghost: false, splats: [], seed: rng() * 1000 };
  const range = (lo: number, hi: number) => (hi <= lo ? lo : lo + rng() * (hi - lo));
  const beyond = W + 400;
  if (kind === "footbridge") {
    const deck = 34;
    // Room under it or over it, whichever the deck height leaves.
    const lo = m + margin;
    const hi = Math.max(lo, top - m - margin - deck);
    const y0 = range(Math.min(lo, hi), hi);
    gate.depth = 60;
    gate.rects.push({ x0: -beyond, x1: beyond, y0, y1: y0 + deck, part: "deck" });
  } else if (kind === "banner") {
    const span = 2 * W;
    const cover = range(0.5, 0.68) * span;
    // Leave at least the min opening beside it (past the pole).
    const covered = Math.min(cover, span - m - margin - 14);
    const side = rng() < 0.5 ? -1 : 1;
    const band = 90;
    const y0 = range(m + margin, Math.max(m + margin, top - m - margin - band));
    const inner = side < 0 ? -W + covered : W - covered;
    const x0 = side < 0 ? -beyond : inner;
    const x1 = side < 0 ? inner : beyond;
    gate.depth = 14;
    gate.rects.push({ x0, x1, y0, y1: y0 + band, part: "cloth" });
    const pole = 12;
    const px0 = side < 0 ? inner - 2 : inner - pole + 2;
    gate.rects.push({ x0: px0, x1: px0 + pole, y0: 0, y1: y0 + band + 24, part: "pole" });
  } else if (kind === "wires") {
    const n = rng() < 0.5 ? 2 : 3;
    const thick = 8;
    const big = Math.min(top - n * thick - 40 * n, m + margin + rng() * 70);
    const bigAt = Math.floor(rng() * (n + 1));
    let rest = top - n * thick - big;
    // The other n gaps share what's left (each at least 40).
    const gaps: number[] = [];
    const shares = Array.from({ length: n }, () => 0.5 + rng());
    const shareSum = shares.reduce((s, v) => s + v, 0);
    rest = Math.max(40 * n, rest);
    for (let i = 0, j = 0; i <= n; i++) gaps.push(i === bigAt ? big : Math.max(40, (rest * shares[j++]) / shareSum));
    let y = 0;
    gate.depth = 8;
    for (let i = 0; i < n; i++) {
      y += gaps[i];
      if (y + thick > top) break;
      gate.rects.push({ x0: -beyond, x1: beyond, y0: y, y1: y + thick, part: "wire" });
      y += thick;
    }
  } else if (kind === "arch") {
    const shrink = Math.min(1, Math.max(0, progress));
    const ow = Math.max(m, range(190, 260) - shrink * 50);
    const oh = Math.max(m, range(180, 230) - shrink * 40);
    const ox = range(-W + ow / 2 + margin, W - ow / 2 - margin);
    const oy0 = range(40, Math.max(40, Math.min(220, top - oh - margin)));
    const ox0 = ox - ow / 2;
    const ox1 = ox + ow / 2;
    const oy1 = Math.min(top - margin, oy0 + oh);
    const wallTop = top + 300;
    gate.depth = 50;
    gate.opening = { x0: ox0, x1: ox1, y0: oy0, y1: oy1, part: "wall" };
    gate.rects.push({ x0: -beyond, x1: ox0, y0: 0, y1: wallTop, part: "wall" });
    gate.rects.push({ x0: ox1, x1: beyond, y0: 0, y1: wallTop, part: "wall" });
    if (oy0 > 0) gate.rects.push({ x0: ox0, x1: ox1, y0: 0, y1: oy0, part: "wall" });
    gate.rects.push({ x0: ox0, x1: ox1, y0: oy1, y1: wallTop, part: "wall" });
  }
  return gate;
}
