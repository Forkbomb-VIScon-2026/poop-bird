// Game simulation: bird, obstacles, targets, poops, particles, score.
// Runs at a fixed timestep (see main.ts). Rendering lives in render.ts.
// The simulation pushes GameEvents that main.ts turns into sound and UI.

import { config, ramp } from "./config";
import { initialChargeState, inSweetSpot, stepCharge, type ChargeState } from "./charge";

export const VIEW_H = 600;
export const GROUND_Y = 520;
export const BIRD_RADIUS = 22;
/** Collision radius is a bit smaller than the drawn bird, to feel fair. */
const BIRD_HIT_RADIUS = 16;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BottomKind = "building" | "chimney" | "tower";
export type TopKind = "sign" | "balloons" | "girder";

export interface Splat {
  dx: number;
  dy: number;
  r: number;
  seed: number;
}

export interface Obstacle {
  x: number;
  w: number;
  gapTop: number;
  gapBottom: number;
  bottom: BottomKind;
  top: TopKind;
  color: string;
  seed: number;
  passed: boolean;
  splats: Splat[];
}

export type TargetKind = "car" | "pedestrian" | "statue";

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
}

export interface Poop {
  x: number;
  y: number;
  vx: number; // screen space
  vy: number;
  r: number;
  big: boolean;
  trail: number;
  rot: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  /** Moves with the world (scrolls left) when true. */
  world: boolean;
}

export interface Decal {
  x: number;
  y: number;
  r: number;
  seed: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface ScreenSplat {
  x: number;
  y: number;
  r: number;
  seed: number;
  life: number;
}

export type GameEvent =
  | { type: "release"; charge: number; sweet: boolean }
  | { type: "accident"; message: string }
  | { type: "splat"; big: boolean }
  | { type: "hit"; points: number; combo: number; kind: TargetKind }
  | { type: "crash" }
  | { type: "gameover" };

const ACCIDENT_MESSAGES = [
  "CODE BROWN!",
  "Oops… that wasn't a fart",
  "TOO MUCH PRESSURE!",
  "Should've had more fiber",
  "Abort! ABORT!",
  "Sharted mid-air",
  "Push gently, they said",
  "That's going to stain",
];

const CAR_COLORS = ["#e84a5f", "#2a9df4", "#ffb400", "#5cc96b", "#9b5de5", "#f9844a"];
const PERSON_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#fd79a8", "#00b894"];
const BUILDING_COLORS = ["#c8553d", "#588b8b", "#8e7dbe", "#d4a373", "#6d8a96", "#b56576"];

export type GamePhase = "playing" | "dying" | "over";

export class Game {
  width = 1000;
  phase: GamePhase = "playing";
  time = 0;
  /** Seconds since the run started (only advances in step()). */
  runTime = 0;

  bird = {
    x: 280,
    y: 240,
    vy: 0,
    rot: 0,
    /** Squash/stretch: >1 = stretched tall. Springs back to 1. */
    stretch: 1,
    stretchV: 0,
    /** Seconds of relieved face after a release. */
    relief: 0,
    flap: 0,
  };
  charge: ChargeState = initialChargeState();
  straining = false;

  obstacles: Obstacle[] = [];
  targets: Target[] = [];
  poops: Poop[] = [];
  particles: Particle[] = [];
  decals: Decal[] = [];
  floaters: Floater[] = [];
  screenSplats: ScreenSplat[] = [];

  distance = 0;
  bonus = 0;
  combo = 0;
  bestCombo = 0;
  targetsHit = 0;
  poopsDropped = 0;
  accidents = 0;
  shake = 0;
  message: { text: string; life: number } | null = null;
  dyingTime = 0;

  /** Distance at which the next obstacle spawns. */
  private nextObstacleAt = 0;
  private targetSpawnAcc = 0;
  private lastGapCenter = 260;

  events: GameEvent[] = [];

  constructor(width: number) {
    this.resize(width);
    this.reset();
  }

  resize(width: number): void {
    this.width = width;
    this.bird.x = Math.round(Math.min(320, width * 0.28));
  }

  reset(): void {
    this.phase = "playing";
    this.time = 0;
    this.runTime = 0;
    Object.assign(this.bird, { y: 240, vy: 0, rot: 0, stretch: 1, stretchV: 0, relief: 0, flap: 0 });
    this.charge = initialChargeState();
    this.straining = false;
    this.obstacles = [];
    this.targets = [];
    this.poops = [];
    this.particles = [];
    this.decals = [];
    this.floaters = [];
    this.screenSplats = [];
    this.distance = 0;
    this.bonus = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.targetsHit = 0;
    this.poopsDropped = 0;
    this.accidents = 0;
    this.shake = 0;
    this.message = null;
    this.dyingTime = 0;
    this.nextObstacleAt = config.firstObstacleDelay;
    this.targetSpawnAcc = 0.6; // a target shows up early
    this.lastGapCenter = 260;
    this.events = [];
  }

  get difficulty(): number {
    return Math.min(1, this.distance / Math.max(1, config.difficultyRamp));
  }

  get scrollSpeed(): number {
    return ramp(config.scrollSpeed, config.scrollSpeedMax, this.difficulty);
  }

  get score(): number {
    return Math.floor(this.distance / Math.max(1, config.distancePerPoint)) + this.bonus;
  }

  get comboMultiplier(): number {
    if (this.combo <= 0) return 1;
    return Math.min(config.comboMax, 1 + config.comboStep * (this.combo - 1));
  }

  get stunned(): boolean {
    return this.charge.stun > 0;
  }

  get sweetSpot(): boolean {
    return inSweetSpot(this.charge, config);
  }

  /** Fraction (0..1) of the overstrain time used up while at full charge. */
  get overstrainProgress(): number {
    return this.charge.charge >= 1 ? Math.min(1, this.charge.fullHold / Math.max(1e-3, config.overstrainTime)) : 0;
  }

  /** Menus / countdown: the bird hovers in place and effects keep animating. */
  idle(dt: number): void {
    this.time += dt;
    this.bird.y = 240 + Math.sin(this.time * 2.5) * 12;
    this.bird.rot = Math.sin(this.time * 2.5 + 1) * 0.08;
    this.updateEffects(dt, 0);
  }

  step(dt: number): void {
    this.time += dt;
    this.runTime += dt;
    if (this.phase === "over") {
      this.updateEffects(dt, 0);
      return;
    }
    const alive = this.phase === "playing";
    const speed = alive ? this.scrollSpeed : 0;
    if (alive) this.distance += speed * dt;

    if (alive) this.updateCharge(dt);
    this.updateBird(dt);
    this.updateObstacles(dt, speed);
    this.updateTargets(dt, speed);
    this.updatePoops(dt, speed);
    this.updateEffects(dt, speed);

    if (this.phase === "dying") {
      this.dyingTime += dt;
      if (this.dyingTime > 1.3 && this.bird.y >= GROUND_Y - BIRD_RADIUS - 1) {
        this.phase = "over";
        this.events.push({ type: "gameover" });
      }
    }
  }

  // --- bird & charge ---------------------------------------------------------

  private updateCharge(dt: number): void {
    const { state, event } = stepCharge(this.charge, this.straining, dt, config);
    this.charge = state;
    if (!event) return;
    if (event.type === "release") this.release(event.charge, event.push, event.sweetSpot);
    else this.accident();
  }

  private release(charge: number, push: number, sweet: boolean): void {
    const b = this.bird;
    if (b.vy > 0) b.vy *= 1 - config.fallCancel;
    b.vy -= push;
    b.stretchV += 6 + charge * 10;
    b.relief = 0.45;
    b.flap = 0.35;
    this.poopsDropped++;
    this.spawnPoop(b.x - 4, b.y + BIRD_RADIUS * 0.8, 5 + charge * 7, 140 + charge * 260, false);
    // Fart cloud
    const n = 4 + Math.round(charge * 14);
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: b.x - 10, y: b.y + 14,
        vx: -40 - Math.random() * 90 * (0.5 + charge), vy: 20 + Math.random() * 80 - 40,
        life: 0.4 + Math.random() * 0.5 * (0.5 + charge), maxLife: 0.9,
        size: 4 + Math.random() * 8 * (0.4 + charge), color: sweet ? "#ffe066" : "#b5c99a",
        gravity: -30, world: true,
      });
    }
    if (sweet) {
      this.floaters.push({ x: b.x, y: b.y - 40, text: "PERFECT PUSH!", color: "#ffd000", size: 30, life: 1.1, maxLife: 1.1 });
    } else if (charge >= 0.95) {
      this.floaters.push({ x: b.x, y: b.y - 40, text: "BIG ONE!", color: "#fff", size: 24, life: 0.8, maxLife: 0.8 });
    } else if (charge < 0.12) {
      this.floaters.push({ x: b.x - 20, y: b.y + 10, text: "pfft", color: "#e9f5db", size: 16, life: 0.6, maxLife: 0.6 });
    }
    this.events.push({ type: "release", charge, sweet });
  }

  private accident(): void {
    const b = this.bird;
    this.accidents++;
    const text = ACCIDENT_MESSAGES[Math.floor(Math.random() * ACCIDENT_MESSAGES.length)];
    this.message = { text, life: 2.2 };
    this.shake = 18;
    b.stretchV -= 12;
    // A big messy blob and a spray of mess.
    this.spawnPoop(b.x, b.y + BIRD_RADIUS, 16, 60, true);
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 380;
      this.particles.push({
        x: b.x, y: b.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100,
        life: 0.6 + Math.random() * 0.8, maxLife: 1.4,
        size: 3 + Math.random() * 7, color: Math.random() < 0.7 ? "#7a4a1e" : "#5c3310",
        gravity: 900, world: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.screenSplats.push({
        x: Math.random() * this.width, y: Math.random() * VIEW_H,
        r: 30 + Math.random() * 70, seed: Math.random() * 1000, life: 2.5 + Math.random(),
      });
    }
    this.events.push({ type: "accident", message: text });
  }

  private updateBird(dt: number): void {
    const b = this.bird;
    const charging = this.charge.charge > 0 && !this.stunned;
    const grace = config.startGrace > 0 ? Math.min(1, this.runTime / config.startGrace) : 1;
    const dying = this.phase !== "playing";
    const g = config.gravity * (dying ? 2.5 : grace * (charging ? config.chargeGravityScale : 1));
    const maxFall = dying ? 900 : charging ? Math.min(config.maxFallSpeed, config.chargeMaxFallSpeed) : config.maxFallSpeed;
    // While charging, a faster fall eases down to the charging cap instead of snapping to it.
    b.vy = b.vy > maxFall ? Math.max(maxFall, b.vy - g * 3 * dt) : Math.min(b.vy + g * dt, maxFall);
    b.y += b.vy * dt;

    // Clamp at the top of the screen.
    if (b.y < BIRD_RADIUS) {
      b.y = BIRD_RADIUS;
      if (b.vy < 0) b.vy = 0;
    }

    // Squash & stretch spring.
    const k = 220;
    const damp = 14;
    b.stretchV += (-(b.stretch - 1) * k - b.stretchV * damp) * dt;
    b.stretch = Math.max(0.6, Math.min(1.5, b.stretch + b.stretchV * dt));
    b.relief = Math.max(0, b.relief - dt);
    b.flap = Math.max(0, b.flap - dt);

    if (this.stunned) b.rot += dt * 14;
    else if (this.phase === "dying") b.rot += (1.4 - b.rot) * Math.min(1, dt * 6);
    else {
      const targetRot = Math.max(-0.5, Math.min(0.7, b.vy / 700));
      // Unwind tumble rotation to the nearest full turn.
      const wound = b.rot - Math.round(b.rot / (Math.PI * 2)) * Math.PI * 2;
      b.rot = wound + (targetRot - wound) * Math.min(1, dt * 10);
    }

    if (b.y + BIRD_RADIUS >= GROUND_Y) {
      b.y = GROUND_Y - BIRD_RADIUS;
      if (b.vy > 0) b.vy = 0;
      if (this.phase === "playing") this.crash();
    }
    if (this.phase === "playing" && this.hitsObstacle()) this.crash();
  }

  private crash(): void {
    this.phase = "dying";
    this.dyingTime = 0;
    this.shake = 12;
    this.charge = initialChargeState();
    this.bird.vy = Math.max(this.bird.vy, 120);
    this.message = null;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: this.bird.x, y: this.bird.y,
        vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 - 80,
        life: 0.8, maxLife: 0.8, size: 4 + Math.random() * 3,
        color: Math.random() < 0.5 ? "#ffd166" : "#fff", gravity: 600, world: false,
      });
    }
    this.events.push({ type: "crash" });
  }

  private hitsObstacle(): boolean {
    const { x, y } = this.bird;
    for (const o of this.obstacles) {
      if (o.x > x + 80 || o.x + o.w < x - 80) continue;
      for (const r of obstacleRects(o)) if (circleRect(x, y, BIRD_HIT_RADIUS, r)) return true;
    }
    return false;
  }

  // --- obstacles ---------------------------------------------------------------

  private updateObstacles(dt: number, speed: number): void {
    for (const o of this.obstacles) o.x -= speed * dt;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -60);

    for (const o of this.obstacles) {
      if (!o.passed && o.x + o.w < this.bird.x - BIRD_RADIUS) o.passed = true;
    }

    if (this.phase === "playing" && this.distance >= this.nextObstacleAt) {
      this.spawnObstacle();
      this.nextObstacleAt = this.distance + ramp(config.obstacleSpacing, config.obstacleSpacingMin, this.difficulty);
    }
  }

  private spawnObstacle(): void {
    const d = this.difficulty;
    const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
    const margin = 50;
    const minCenter = margin + gap / 2;
    const maxCenter = GROUND_Y - margin - gap / 2;
    // Limit how far the gap jumps, so the next gap is always reachable.
    const maxJump = 140 + 140 * d;
    let center = minCenter + Math.random() * Math.max(0, maxCenter - minCenter);
    center = Math.max(this.lastGapCenter - maxJump, Math.min(this.lastGapCenter + maxJump, center));
    center = Math.max(minCenter, Math.min(maxCenter, center));
    this.lastGapCenter = center;

    const bottom: BottomKind = pick(["building", "building", "chimney", "tower"]);
    const top: TopKind = pick(["sign", "balloons", "girder"]);
    const w = bottom === "chimney" ? 62 : bottom === "tower" ? 78 : 96 + Math.random() * 30;
    this.obstacles.push({
      x: this.width + 40, w,
      gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom, top, color: pick(BUILDING_COLORS), seed: Math.random() * 1000,
      passed: false, splats: [],
    });
  }

  // --- targets -----------------------------------------------------------------

  private updateTargets(dt: number, speed: number): void {
    for (const t of this.targets) {
      t.x += (t.speed - speed) * dt;
      t.hitFlash = Math.max(0, t.hitFlash - dt);
    }
    this.targets = this.targets.filter((t) => t.x > -200 && t.x < this.width + 400);
    if (this.phase !== "playing") return;
    this.targetSpawnAcc += dt * config.targetSpawnRate;
    if (this.targetSpawnAcc >= 1) {
      this.targetSpawnAcc -= 1 + (Math.random() - 0.5) * 0.6;
      this.spawnTarget();
    }
  }

  private spawnTarget(): void {
    const r = Math.random();
    const kind: TargetKind = r < 0.5 ? "car" : r < 0.85 ? "pedestrian" : "statue";
    // Layout: sidewalk GROUND_Y..+20 (pedestrians, statue), road +20..+80 (cars).
    const roadY = GROUND_Y + 68;
    let t: Target;
    const seed = Math.random() * 1000;
    if (kind === "car") {
      const dir = Math.random() < 0.6 ? 1 : -1;
      t = {
        x: this.width + 120, y: roadY, w: 92, h: 40, kind, speed: dir * (40 + Math.random() * 90),
        color: pick(CAR_COLORS), seed, splats: [], hitFlash: 0, facing: dir as 1 | -1,
      };
    } else if (kind === "pedestrian") {
      const dir = Math.random() < 0.5 ? 1 : -1;
      t = {
        x: this.width + 60, y: GROUND_Y + 20, w: 24, h: 52, kind, speed: dir * (18 + Math.random() * 30),
        color: pick(PERSON_COLORS), seed, splats: [], hitFlash: 0, facing: dir as 1 | -1,
      };
    } else {
      t = {
        x: this.width + 80, y: GROUND_Y + 20, w: 46, h: 96, kind, speed: 0,
        color: "#8fa3a8", seed, splats: [], hitFlash: 0, facing: -1,
      };
    }
    this.targets.push(t);
  }

  // --- poops -------------------------------------------------------------------

  private spawnPoop(x: number, y: number, r: number, vy: number, big: boolean): void {
    // Poops inherit the bird's forward speed (world vx = scroll speed, i.e.
    // screen vx = 0) and slowly lose it to drag.
    this.poops.push({ x, y, vx: 0, vy: vy + Math.max(0, this.bird.vy * 0.2), r, big, trail: 0, rot: Math.random() * 6 });
  }

  private updatePoops(dt: number, speed: number): void {
    const drag = 0.6;
    const keep: Poop[] = [];
    for (const p of this.poops) {
      // World velocity decays from `speed` toward 0 → screen vx drifts back.
      const worldVx = (p.vx + speed) * Math.exp(-drag * dt);
      p.vx = worldVx - speed;
      p.vy += config.poopGravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += dt * 4;
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.025;
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * p.r, y: p.y - p.r * 0.5,
          vx: (Math.random() - 0.5) * 20, vy: -10,
          life: 0.35, maxLife: 0.35, size: 1.5 + Math.random() * p.r * 0.35,
          color: "#8b5a2b", gravity: 0, world: true,
        });
      }
      if (this.poopHits(p)) continue;
      keep.push(p);
    }
    this.poops = keep;
  }

  /** Returns true if the poop was consumed. */
  private poopHits(p: Poop): boolean {
    // Targets
    for (const t of this.targets) {
      const rect = targetRect(t);
      if (!circleRect(p.x, p.y, p.r, rect)) continue;
      t.splats.push({ dx: p.x - t.x, dy: Math.max(-t.h, p.y - t.y), r: p.r * 1.3, seed: Math.random() * 1000 });
      t.hitFlash = 0.3;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.targetsHit++;
      const kindMult = t.kind === "car" ? 1 : t.kind === "pedestrian" ? 1.5 : 2;
      const points = Math.round(config.targetPoints * kindMult * this.comboMultiplier * (p.big ? 2 : 1));
      this.bonus += points;
      const label = this.combo > 1 ? `+${points}  x${this.comboMultiplier.toFixed(1)}` : `+${points}`;
      this.floaters.push({ x: p.x, y: t.y - t.h - 10, text: label, color: "#ffe14d", size: 26, life: 1.1, maxLife: 1.1 });
      this.splatParticles(p.x, p.y, p.r, true);
      this.events.push({ type: "hit", points, combo: this.combo, kind: t.kind });
      this.events.push({ type: "splat", big: p.big });
      return true;
    }
    // Obstacles
    for (const o of this.obstacles) {
      for (const r of obstacleRects(o)) {
        if (!circleRect(p.x, p.y, p.r, r)) continue;
        o.splats.push({ dx: p.x - o.x, dy: p.y, r: p.r * 1.2, seed: Math.random() * 1000 });
        this.splatParticles(p.x, p.y, p.r, false);
        this.events.push({ type: "splat", big: p.big });
        return true;
      }
    }
    // Ground: poops land mid-road, below every target's top edge, so a poop
    // over a target always reaches the target first.
    const groundHit = GROUND_Y + 55;
    if (p.y + p.r >= groundHit) {
      this.decals.push({ x: p.x, y: groundHit - 4 + Math.random() * 14, r: p.r * 1.6, seed: Math.random() * 1000 });
      if (this.decals.length > 60) this.decals.shift();
      this.splatParticles(p.x, groundHit, p.r, false);
      if (this.combo > 1 && this.phase === "playing") {
        this.floaters.push({ x: p.x, y: groundHit - 30, text: "combo lost", color: "#ffd6d6", size: 16, life: 0.8, maxLife: 0.8 });
      }
      this.combo = 0;
      this.events.push({ type: "splat", big: p.big });
      return true;
    }
    return false;
  }

  private splatParticles(x: number, y: number, r: number, hit: boolean): void {
    const n = 8 + Math.round(r);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * Math.random();
      const s = 60 + Math.random() * 160;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.3, maxLife: 0.7, size: 2 + Math.random() * 3,
        color: hit && Math.random() < 0.3 ? "#ffe14d" : "#6b3e14", gravity: 700, world: true,
      });
    }
  }

  // --- effects -----------------------------------------------------------------

  private updateEffects(dt: number, speed: number): void {
    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += (p.vx - (p.world ? speed : 0)) * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);

    for (const d of this.decals) d.x -= speed * dt;
    this.decals = this.decals.filter((d) => d.x > -80);

    for (const f of this.floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    for (const s of this.screenSplats) s.life -= dt;
    this.screenSplats = this.screenSplats.filter((s) => s.life > 0);

    this.shake = Math.max(0, this.shake - dt * 40);
    if (this.message) {
      this.message.life -= dt;
      if (this.message.life <= 0) this.message = null;
    }
  }
}

// --- geometry helpers ----------------------------------------------------------

export const SIGN_H = 64;

/** Collision rectangles for an obstacle, shared by rendering and physics. */
export function obstacleRects(o: Obstacle): Rect[] {
  const rects: Rect[] = [];
  // Bottom part rises from the ground to the gap.
  rects.push({ x: o.x, y: o.gapBottom, w: o.w, h: GROUND_Y - o.gapBottom });
  // Top part hangs down to the gap.
  const cx = o.x + o.w / 2;
  if (o.top === "girder") {
    rects.push({ x: o.x - 6, y: 0, w: o.w + 12, h: o.gapTop });
  } else {
    const hangH = Math.min(SIGN_H, o.gapTop);
    // Cable(s) from the top of the screen.
    rects.push({ x: cx - 4, y: 0, w: 8, h: o.gapTop - hangH });
    rects.push({ x: o.x - 8, y: o.gapTop - hangH, w: o.w + 16, h: hangH });
  }
  return rects;
}

export function targetRect(t: Target): Rect {
  return { x: t.x - t.w / 2, y: t.y - t.h, w: t.w, h: t.h };
}

export function circleRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  if (rect.h <= 0 || rect.w <= 0) return false;
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
