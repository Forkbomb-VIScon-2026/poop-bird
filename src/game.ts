// Game simulation: bird, obstacles, targets, poops, particles, score.
// Runs at a fixed timestep (see main.ts). Rendering lives in render.ts.
// The simulation pushes GameEvents that main.ts turns into sound and UI.
//
// A run alternates between stages: city → ocean → city → … A gate obstacle
// ends each stage; flying through it starts a StageTransition (splash +
// transform) during which the world is frozen. In the ocean the bird is a
// pufferfish driven by `puffInput` instead of `straining`.

import { config, ramp } from "./config";
import { initialChargeState, inSweetSpot, stepCharge, type ChargeState } from "./charge";
import {
  applyWaterDrag,
  initialSpikeState,
  popProgress,
  popWarning,
  puffScale,
  stepSpike,
  targetSwimVelocity,
  type SpikeState,
} from "./swim";

export const VIEW_H = 600;
export const GROUND_Y = 520;
export const BIRD_RADIUS = 22;
/** Collision radius is a bit smaller than the drawn bird, to feel fair. */
const BIRD_HIT_RADIUS = 16;
/** Ocean: the water surface (a soft ceiling). The sea floor is GROUND_Y. */
export const SURFACE_Y = 36;

export type Stage = "city" | "ocean";

/**
 * Splash + transform between stages. `t` runs from 0 to `duration`; the stage
 * swaps (bird ↔ fish, obstacles cleared) at SWAP_AT under full splash cover.
 * While `Game.holdTransition` is set (puff calibration), `t` stops at HOLD_AT.
 */
export interface StageTransition {
  to: Stage;
  t: number;
  duration: number;
  swapped: boolean;
}
export const TRANSITION_SWAP_AT = 0.4;
export const TRANSITION_HOLD_AT = 0.75;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BottomKind = "building" | "chimney" | "tower" | "harbour" | "coral" | "rock" | "reef";
/** Only the stage gates have a top: a solid block from the top of the screen down to the gap. */
export type TopKind = "harbourArch" | "reefArch";

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
  top: TopKind | null;
  color: string;
  seed: number;
  passed: boolean;
  splats: Splat[];
  /** Set on the gate that ends a stage: flying through its gap starts the transition to `gate`. */
  gate: Stage | null;
}

export interface Jelly {
  x: number;
  /** Centre height the jellyfish bobs around. */
  baseY: number;
  y: number;
  r: number;
  phase: number;
  hue: number;
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
  | { type: "gameover" }
  | { type: "gateEntered"; to: Stage }
  | { type: "transformed" }
  | { type: "surfaced" }
  | { type: "spike" }
  | { type: "pop"; message: string }
  | { type: "jellyPopped"; points: number; combo: number };

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

const POP_MESSAGES = [
  "PFFFBBBT!",
  "Pop goes the puffer",
  "Too much hot air!",
  "Over-inflated!",
  "Deflate-gate",
  "Sea you later, dignity",
  "Hold your breath, they said",
  "Blub… blub…",
];

const CAR_COLORS = ["#e84a5f", "#2a9df4", "#ffb400", "#5cc96b", "#9b5de5", "#f9844a"];
const PERSON_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#fd79a8", "#00b894"];
const BUILDING_COLORS = ["#c8553d", "#588b8b", "#8e7dbe", "#d4a373", "#6d8a96", "#b56576"];
const CORAL_COLORS = ["#ff7f6e", "#ff9f43", "#f368e0", "#ee5a6f", "#ffb86b"];
const ROCK_COLORS = ["#6b7b8c", "#7d6e63", "#5f6f7a"];
const JELLY_HUES = [320, 285, 200, 340];

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

  stage: Stage = "city";
  transition: StageTransition | null = null;
  /** Set by main.ts while the puff calibration runs: the transition waits at HOLD_AT. */
  holdTransition = false;
  /** Puff 0..1 fed in each step by main.ts (face OR key), like `straining`. */
  puffInput = 0;
  fish = {
    /** Displayed puff (drives size and hitbox); eases quickly toward the input. */
    puff: 0,
    /** 0..1 spine pop-out animation. */
    spikes: 0,
    /** Seconds of the spike-out flash ring. */
    flare: 0,
  };
  spike: SpikeState = initialSpikeState();
  jellies: Jelly[] = [];
  jelliesPopped = 0;
  /** Scroll speed actually applied this step (0 while frozen or dead). */
  speed = 0;
  /** Seconds since the current stage began (gravity grace restarts after surfacing). */
  stageTime = 0;

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
  private jellySpawnAcc = 0;
  private lastGapCenter = 260;
  /** Regular obstacles spawned in the current stage (the gate comes after enough). */
  private stageObstacles = 0;
  private gateSpawned = false;

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
    this.stage = "city";
    this.transition = null;
    this.holdTransition = false;
    this.puffInput = 0;
    Object.assign(this.fish, { puff: 0, spikes: 0, flare: 0 });
    this.spike = initialSpikeState();
    this.jellies = [];
    this.jelliesPopped = 0;
    this.speed = 0;
    this.stageTime = 0;
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
    this.jellySpawnAcc = 0;
    this.lastGapCenter = 260;
    this.stageObstacles = 0;
    this.gateSpawned = false;
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
    return this.stage === "ocean" ? this.spike.stun > 0 : this.charge.stun > 0;
  }

  /** True while the fish is under player control (ocean, no transition, alive). */
  get swimming(): boolean {
    return this.stage === "ocean" && !this.transition && this.phase === "playing";
  }

  /** Radius of the drawn bird or fish. */
  get bodyRadius(): number {
    if (this.stage === "city") return BIRD_RADIUS;
    return BIRD_RADIUS * puffScale(this.fish.puff, config.oceanHitboxMin, config.oceanHitboxMax);
  }

  get hitRadius(): number {
    if (this.stage === "city") return BIRD_HIT_RADIUS;
    return BIRD_HIT_RADIUS * puffScale(this.fish.puff, config.oceanHitboxMin, config.oceanHitboxMax);
  }

  get popWarning(): boolean {
    return popWarning(this.spike, config);
  }

  /** Fraction (0..1) of the max spiked time used up. */
  get popProgress(): number {
    return popProgress(this.spike, config);
  }

  /** 0..1 progress of the current stage transition. */
  get transitionProgress(): number {
    const tr = this.transition;
    return tr ? Math.min(1, tr.t / tr.duration) : 0;
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
    this.speed = 0;
    this.bird.y = 240 + Math.sin(this.time * 2.5) * 12;
    this.bird.rot = Math.sin(this.time * 2.5 + 1) * 0.08;
    this.updateEffects(dt, 0);
  }

  step(dt: number): void {
    this.time += dt;
    this.runTime += dt;
    this.speed = 0;
    if (this.phase === "over") {
      this.updateEffects(dt, 0);
      return;
    }
    // Stage transitions freeze the world.
    if (this.transition && this.phase === "playing") {
      this.updateTransition(dt);
      this.updateEffects(dt, 0);
      return;
    }
    const alive = this.phase === "playing";
    const ocean = this.stage === "ocean";
    const speed = alive ? this.scrollSpeed * (ocean ? config.oceanScrollScale : 1) : 0;
    this.speed = speed;
    if (alive) {
      this.distance += speed * dt;
      this.stageTime += dt;
    }

    if (ocean) {
      if (alive) this.updateSpike(dt);
      this.updateFish(dt);
    } else {
      if (alive) this.updateCharge(dt);
      this.updateBird(dt);
    }
    this.updateObstacles(dt, speed);
    this.updateTargets(dt, speed);
    this.updatePoops(dt, speed);
    this.updateJellies(dt, speed);
    this.updateEffects(dt, speed);

    if (this.phase === "dying") {
      this.dyingTime += dt;
      if (this.dyingTime > 1.3 && this.bird.y >= GROUND_Y - this.bodyRadius - 1) {
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
    const grace = config.startGrace > 0 ? Math.min(1, this.stageTime / config.startGrace) : 1;
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
    this.spike = initialSpikeState();
    this.bird.vy = Math.max(this.bird.vy, 120);
    this.message = null;
    const ocean = this.stage === "ocean";
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: this.bird.x, y: this.bird.y,
        vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 - 80,
        life: 0.8, maxLife: 0.8, size: 4 + Math.random() * 3,
        color: ocean ? (Math.random() < 0.5 ? "#caf0f8" : "#fff") : Math.random() < 0.5 ? "#ffd166" : "#fff",
        gravity: ocean ? -200 : 600, world: false,
      });
    }
    this.events.push({ type: "crash" });
  }

  private hitsObstacle(): boolean {
    const { x, y } = this.bird;
    const r = this.hitRadius;
    for (const o of this.obstacles) {
      if (o.x > x + 80 || o.x + o.w < x - 80) continue;
      for (const rect of obstacleRects(o)) if (circleRect(x, y, r, rect)) return true;
    }
    return false;
  }

  // --- pufferfish ----------------------------------------------------------------

  private updateSpike(dt: number): void {
    const { state, event } = stepSpike(this.spike, this.puffInput, dt, config);
    this.spike = state;
    if (!event) return;
    if (event.type === "spike") {
      this.fish.flare = 0.35;
      this.bird.stretchV += 8;
      this.events.push({ type: "spike" });
    } else if (event.type === "pop") {
      this.popAccident();
    }
  }

  private popAccident(): void {
    const b = this.bird;
    this.accidents++;
    const text = POP_MESSAGES[Math.floor(Math.random() * POP_MESSAGES.length)];
    this.message = { text, life: 2.2 };
    this.shake = 16;
    b.stretchV -= 14;
    b.vy = Math.min(b.vy, -60);
    // The air comes out the back in a stream of bubbles.
    for (let i = 0; i < 44; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 1.6;
      const s = 120 + Math.random() * 320;
      this.particles.push({
        x: b.x - 10, y: b.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        life: 0.5 + Math.random() * 0.7, maxLife: 1.2,
        size: 2 + Math.random() * 6, color: Math.random() < 0.6 ? "#e0fbfc" : "#a8dadc",
        gravity: -260, world: true,
      });
    }
    this.events.push({ type: "pop", message: text });
  }

  private updateFish(dt: number): void {
    const b = this.bird;
    const f = this.fish;
    const dying = this.phase !== "playing";
    const stunned = this.stunned;
    const input = dying || stunned ? 0 : Math.min(1, Math.max(0, this.puffInput));
    // The displayed puff eases quickly so a pop visibly deflates instead of snapping.
    f.puff += (input - f.puff) * (1 - Math.exp(-dt / (stunned ? 0.12 : 0.06)));
    const spiked = this.spike.spiked && !dying;
    f.spikes += ((spiked ? 1 : 0) - f.spikes) * Math.min(1, dt * (spiked ? 22 : 10));
    f.flare = Math.max(0, f.flare - dt);

    const target = dying ? 260 : targetSwimVelocity(input, config);
    b.vy = applyWaterDrag(b.vy, target, dt, Math.max(0.02, config.oceanDragTime));
    b.y += b.vy * dt;

    // The surface is a soft ceiling: clamp and bump back down.
    const r = this.bodyRadius;
    if (b.y - r < SURFACE_Y) {
      b.y = SURFACE_Y + r;
      if (b.vy < 0) {
        if (b.vy < -80) {
          b.stretchV -= 5;
          for (let i = 0; i < 6; i++) {
            this.particles.push({
              x: b.x + (Math.random() - 0.5) * r, y: SURFACE_Y,
              vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 80,
              life: 0.4, maxLife: 0.4, size: 2 + Math.random() * 3, color: "#e0fbfc", gravity: 500, world: true,
            });
          }
        }
        b.vy = config.oceanSurfaceBump;
      }
    }

    this.updateSpring(dt);
    b.flap = Math.max(0, b.flap - dt);

    if (stunned) b.rot += dt * 9;
    else if (dying) b.rot += (Math.PI - b.rot) * Math.min(1, dt * 3);
    else {
      const targetRot = Math.max(-0.35, Math.min(0.35, b.vy / 500));
      const wound = b.rot - Math.round(b.rot / (Math.PI * 2)) * Math.PI * 2;
      b.rot = wound + (targetRot - wound) * Math.min(1, dt * 6);
    }

    if (b.y + r >= GROUND_Y) {
      b.y = GROUND_Y - r;
      if (b.vy > 0) b.vy = 0;
      if (this.phase === "playing") this.crash();
    }
    if (this.phase === "playing" && this.hitsObstacle()) this.crash();
  }

  private updateSpring(dt: number): void {
    const b = this.bird;
    const k = 220;
    const damp = 14;
    b.stretchV += (-(b.stretch - 1) * k - b.stretchV * damp) * dt;
    b.stretch = Math.max(0.6, Math.min(1.5, b.stretch + b.stretchV * dt));
  }

  // --- jellyfish -------------------------------------------------------------------

  private updateJellies(dt: number, speed: number): void {
    for (const j of this.jellies) {
      j.x -= speed * dt;
      j.y = j.baseY + Math.sin(this.time * 1.6 + j.phase) * 14;
    }
    this.jellies = this.jellies.filter((j) => j.x > -80);
    if (this.stage !== "ocean" || this.phase !== "playing") return;

    // Popping (spiked) or getting stung (not spiked).
    const r = this.hitRadius;
    const { x, y } = this.bird;
    for (const j of this.jellies) {
      const dx = j.x - x;
      const dy = j.y - y;
      const reach = r + j.r * 0.8;
      if (dx * dx + dy * dy >= reach * reach) continue;
      if (this.spike.spiked) {
        this.popJelly(j);
      } else {
        this.crash();
        return;
      }
    }
    this.jellies = this.jellies.filter((j) => j.r > 0);

    this.jellySpawnAcc += dt * config.oceanJellyRate;
    if (this.jellySpawnAcc >= 1) {
      // Open water only: no obstacle near the spawn point, and the next one
      // (it spawns at the same x) far enough behind that it can't land on top.
      const sx = this.width + 50;
      const clear =
        this.obstacles.every((o) => o.x > sx + 70 || o.x + o.w < sx - 70) &&
        (this.gateSpawned || this.nextObstacleAt - this.distance > 220);
      if (clear) {
        this.jellySpawnAcc = (Math.random() - 0.5) * 0.6;
        const baseY = SURFACE_Y + 70 + Math.random() * (GROUND_Y - SURFACE_Y - 140);
        this.jellies.push({
          x: sx, baseY, y: baseY, r: 18 + Math.random() * 6,
          phase: Math.random() * Math.PI * 2, hue: pick(JELLY_HUES),
        });
      }
    }
  }

  private popJelly(j: Jelly): void {
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.targetsHit++;
    this.jelliesPopped++;
    const points = Math.round(config.targetPoints * config.oceanJellyMultiplier * this.comboMultiplier);
    this.bonus += points;
    const label = this.combo > 1 ? `+${points}  x${this.comboMultiplier.toFixed(1)}` : `+${points}`;
    this.floaters.push({ x: j.x, y: j.y - 30, text: label, color: "#ffe14d", size: 26, life: 1.1, maxLife: 1.1 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      this.particles.push({
        x: j.x, y: j.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.4, maxLife: 0.8, size: 2 + Math.random() * 4,
        color: `hsla(${j.hue},90%,80%,1)`, gravity: -60, world: true,
      });
    }
    j.r = 0; // removed by the caller
    this.events.push({ type: "jellyPopped", points, combo: this.combo });
  }

  // --- stage transitions -------------------------------------------------------------

  private startTransition(to: Stage): void {
    const b = this.bird;
    this.transition = { to, t: 0, duration: Math.max(0.3, config.oceanTransformTime), swapped: false };
    // Nothing from the old stage may fire during or after the transition.
    this.charge = initialChargeState();
    this.spike = initialSpikeState();
    b.vy = to === "ocean" ? 160 : -380;
    b.stretchV += 10;
    this.splash(b.x, to === "ocean" ? b.y + 10 : b.y - 10, to === "ocean" ? 1 : -1);
    this.events.push({ type: "gateEntered", to });
  }

  private splash(x: number, y: number, dir: 1 | -1): void {
    for (let i = 0; i < 40; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 150 + Math.random() * 380;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 30, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * (dir === 1 ? 1 : 0.6),
        life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 3 + Math.random() * 6,
        color: Math.random() < 0.5 ? "#caf0f8" : "#ffffff", gravity: 900, world: false,
      });
    }
  }

  private updateTransition(dt: number): void {
    const tr = this.transition!;
    const b = this.bird;
    // While held (puff calibration) time stops at HOLD_AT; the fish keeps bobbing in place.
    const holdT = tr.duration * TRANSITION_HOLD_AT;
    tr.t = this.holdTransition ? Math.max(tr.t, Math.min(holdT, tr.t + dt)) : tr.t + dt;

    if (!tr.swapped && tr.t >= tr.duration * TRANSITION_SWAP_AT) this.swapStage(tr.to);

    if (!tr.swapped) {
      // Plunge down into the harbour, or shoot up to the surface.
      b.vy += (tr.to === "ocean" ? 1400 : -900) * dt;
      b.y += b.vy * dt;
      b.rot += ((tr.to === "ocean" ? 1.2 : -0.9) - b.rot) * Math.min(1, dt * 8);
    } else {
      b.y += (240 - b.y) * Math.min(1, dt * 5);
      b.rot += (0 - b.rot) * Math.min(1, dt * 8);
    }
    this.updateSpring(dt);
    b.flap = Math.max(0, b.flap - dt);

    if (tr.t >= tr.duration) {
      this.transition = null;
      b.vy = tr.to === "city" ? -200 : 0;
      b.flap = tr.to === "city" ? 0.4 : 0;
      this.events.push({ type: tr.to === "ocean" ? "transformed" : "surfaced" });
    }
  }

  /** Under full splash cover: switch bird ↔ fish and clear the old stage's world. */
  private swapStage(to: Stage): void {
    const tr = this.transition!;
    tr.swapped = true;
    this.stage = to;
    this.stageTime = 0;
    this.stageObstacles = 0;
    this.gateSpawned = false;
    this.obstacles = [];
    this.targets = [];
    this.poops = [];
    this.decals = [];
    this.jellies = [];
    this.screenSplats = [];
    this.message = null;
    this.lastGapCenter = 260;
    this.jellySpawnAcc = 0;
    this.targetSpawnAcc = 0.6;
    this.nextObstacleAt = this.distance + (to === "ocean" ? config.oceanFirstObstacleDelay : config.firstObstacleDelay);
    const b = this.bird;
    b.y = to === "ocean" ? SURFACE_Y + 60 : VIEW_H * 0.7;
    b.vy = 0;
    b.rot = 0;
    b.stretchV += 14;
    this.fish.puff = to === "ocean" ? config.oceanHoverPuff : 0;
    this.fish.spikes = 0;
    this.spike = initialSpikeState();
    // A strain held through the ocean must not fire the moment we're back in the city.
    this.charge = to === "city" ? { ...initialChargeState(), needsRelease: true } : initialChargeState();
    // Transform poof
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 160;
      this.particles.push({
        x: b.x, y: 260, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.5 + Math.random() * 0.6, maxLife: 1.1, size: 2 + Math.random() * 5,
        color: Math.random() < 0.6 ? "#e0fbfc" : "#ffffff", gravity: to === "ocean" ? -220 : 300, world: false,
      });
    }
  }

  /** Debug: dive into the ocean right away, skipping the city (same transition as the harbour gate). */
  diveNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.startTransition("ocean");
  }

  /** Debug: make the next obstacle the stage's gate, right now. */
  spawnGateNow(): void {
    if (this.phase !== "playing" || this.transition || this.gateSpawned) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 260);
    this.spawnGate();
  }

  // --- obstacles ---------------------------------------------------------------

  private updateObstacles(dt: number, speed: number): void {
    for (const o of this.obstacles) o.x -= speed * dt;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -60);

    for (const o of this.obstacles) {
      if (!o.passed && o.x + o.w < this.bird.x - BIRD_RADIUS) o.passed = true;
    }

    if (this.phase !== "playing") return;

    // Made it through a gate's gap (the walls would have crashed us): change stage.
    const gate = this.obstacles.find((o) => o.gate && this.bird.x >= o.x + o.w / 2);
    if (gate?.gate) {
      gate.gate = null;
      this.startTransition(this.stage === "city" ? "ocean" : "city");
      return;
    }

    if (!this.gateSpawned && this.distance >= this.nextObstacleAt) {
      const ocean = this.stage === "ocean";
      const before = Math.round(ocean ? config.oceanObstacles : config.cityObstaclesBeforeGate);
      if (this.stageObstacles >= before) this.spawnGate();
      else if (ocean) this.spawnOceanObstacle();
      else this.spawnObstacle();
      this.stageObstacles++;
      this.nextObstacleAt = this.distance + (ocean
        ? ramp(config.oceanSpacing, config.oceanSpacingMin, this.difficulty)
        : ramp(config.obstacleSpacing, config.obstacleSpacingMin, this.difficulty));
    }
  }

  /** Picks a gap centre in [top + margin + gap/2, GROUND_Y − margin − gap/2], within maxJump of the last one. */
  private pickGapCenter(gap: number, top: number, margin: number, maxJump: number): number {
    const minCenter = top + margin + gap / 2;
    const maxCenter = GROUND_Y - margin - gap / 2;
    let center = minCenter + Math.random() * Math.max(0, maxCenter - minCenter);
    center = Math.max(this.lastGapCenter - maxJump, Math.min(this.lastGapCenter + maxJump, center));
    center = Math.max(minCenter, Math.min(maxCenter, center));
    this.lastGapCenter = center;
    return center;
  }

  private spawnObstacle(): void {
    const d = this.difficulty;
    const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
    // Limit how far the gap jumps, so the next gap is always reachable.
    const center = this.pickGapCenter(gap, 0, 50, 140 + 140 * d);

    const bottom: BottomKind = pick(["building", "building", "chimney", "tower"]);
    const w = bottom === "chimney" ? 62 : bottom === "tower" ? 78 : 96 + Math.random() * 30;
    this.obstacles.push({
      x: this.width + 40, w,
      gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom, top: null, color: pick(BUILDING_COLORS), seed: Math.random() * 1000,
      passed: false, splats: [], gate: null,
    });
  }

  private spawnOceanObstacle(): void {
    const gap = ramp(config.oceanGap, config.oceanGapMin, this.difficulty);
    const center = this.pickGapCenter(gap, SURFACE_Y, 40, config.oceanGapJump);
    const bottom: BottomKind = pick(["coral", "coral", "rock"]);
    const w = bottom === "rock" ? 84 + Math.random() * 20 : 70 + Math.random() * 24;
    this.obstacles.push({
      x: this.width + 40, w, gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom, top: null, color: pick(bottom === "rock" ? ROCK_COLORS : CORAL_COLORS), seed: Math.random() * 1000,
      passed: false, splats: [], gate: null,
    });
  }

  /** The stage's last obstacle: the harbour gate (city → ocean) or the reef exit (ocean → city). */
  private spawnGate(): void {
    const ocean = this.stage === "ocean";
    const gap = ocean ? ramp(config.oceanGap, config.oceanGapMin, this.difficulty) : ramp(config.obstacleGap, config.obstacleGapMin, this.difficulty);
    const center = ocean
      ? this.pickGapCenter(gap, SURFACE_Y, 40, config.oceanGapJump)
      : this.pickGapCenter(gap, 0, 50, 140 + 140 * this.difficulty);
    this.gateSpawned = true;
    this.obstacles.push({
      x: this.width + 40, w: ocean ? 110 : 140,
      gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom: ocean ? "reef" : "harbour", top: ocean ? "reefArch" : "harbourArch",
      color: ocean ? "#5f6f7a" : "#3d5a80", seed: Math.random() * 1000,
      passed: false, splats: [], gate: ocean ? "city" : "ocean",
    });
  }

  // --- targets -----------------------------------------------------------------

  private updateTargets(dt: number, speed: number): void {
    for (const t of this.targets) {
      t.x += (t.speed - speed) * dt;
      t.hitFlash = Math.max(0, t.hitFlash - dt);
    }
    this.targets = this.targets.filter((t) => t.x > -200 && t.x < this.width + 400);
    if (this.phase !== "playing" || this.stage !== "city") return;
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

/** Collision rectangles for an obstacle, shared by rendering and physics. */
export function obstacleRects(o: Obstacle): Rect[] {
  const rects: Rect[] = [];
  // Bottom part rises from the ground to the gap.
  rects.push({ x: o.x, y: o.gapBottom, w: o.w, h: GROUND_Y - o.gapBottom });
  // A gate's top hangs down to the gap.
  if (o.top) rects.push({ x: o.x - 6, y: 0, w: o.w + 12, h: o.gapTop });
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
