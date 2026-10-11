// Game simulation: the Game class holds the whole state of a run and steps it
// at a fixed timestep (see main.ts). Rendering lives in render/. The
// simulation pushes GameEvents that main.ts turns into sound and UI.
//
// Each feature (the bird, the pufferfish, the stage transitions, every hazard
// and target) lives in its own module next to this one, as functions over the
// Game: its types, constants, geometry, spawning, update and hit logic.
// Game.step() calls them in order; Game keeps what they share (state, scoring,
// effects, crashing) and the debug spawns.
//
// A run alternates between stages: city → ocean → city → … (see stage.ts). In
// the ocean the bird is a pufferfish driven by `puffInput` instead of
// `straining`.

import { type ChargeState, initialChargeState, inSweetSpot } from "../charge";
import { config, ramp } from "../config";
import { pick } from "../random";
import { initialSpikeState, popProgress, popWarning, puffScale, type SpikeState } from "../swim";
import { type Angler, ANGLER_ROOM, spawnAngler, updateAngler } from "./angler";
import { type Balloon, BALLOON_RX, spawnBalloon, updateBalloons } from "./balloons";
import { animateBird, updateBird, updateCharge } from "./bird";
import { aimPoop, autopilot, DEMO_MAX_NUDGE, DEMO_MAX_RISE } from "./demo";
import { type Decal, type Floater, type Particle, type ScreenSplat, updateEffects } from "./effects";
import type { GameEvent } from "./events";
import { updateFish, updateSpike } from "./fish";
import { type Jelly, updateJellies } from "./jellies";
import { type Pebble, spawnKid, updatePebbles } from "./kids";
import { type Obstacle, updateObstacles } from "./obstacles";
import { spawnOceanObstacle } from "./ocean-obstacles";
import { spawnPaparazzo, type Tabloid } from "./paparazzi";
import { type Poop, updatePoops } from "./poops";
import { poleX, type PowerLine, spawnPowerLine, updatePowerLines, ZAP_MESSAGES } from "./power-lines";
import { type Shark, startSharkTheme, updateShark, updateSharkTheme } from "./shark";
import { DIVE_TAKEOVER, type Shore, spawnShore, type StageTransition, startTransition, updateShore, updateTransition } from "./stage";
import { spawnTarget, type Target, updateTargets } from "./street";
import { type Bouquet, type Dove, spawnWedding, updateBouquet, updateWedding, type Wedding, type WeddingPhoto } from "./wedding";
import { BIRD_RADIUS, type GamePhase, GROUND_Y, OCEAN_DEPTH, PERCH_Y, type Stage, WATER_Y } from "./world";

/** Fastest climb (px/s) off the practice perch, so a practice poop is a hop, not a launch. */
const PERCH_MAX_RISE = 280;

/** Collision radius is a bit smaller than the drawn bird, to feel fair. */
const BIRD_HIT_RADIUS = 16;

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
  /**
   * Set by main.ts while the swim lesson / puff calibration runs in the ocean:
   * the world scrolls on, but no obstacles or jellyfish spawn, the fish can't
   * spike out, and the sea floor doesn't kill. The first obstacle comes
   * oceanFirstObstacleDelay after it's cleared.
   */
  calmWater = false;
  /**
   * Set by main.ts at the end of the swim lesson: the fish swims to this ocean
   * y on its own, puffing as needed, whatever puffInput says. null = the
   * player steers.
   */
  guideY: number | null = null;
  /**
   * Set by main.ts while a new player's first city lesson runs: the street
   * scrolls on and cars and pedestrians come, but no obstacles, paparazzi or
   * kids, and the street bounces the bird back up instead of ending the run.
   * The first obstacle comes firstObstacleDelay after it's cleared.
   */
  calmCity = false;
  /** Was calmWater set last step (to start the floor grace when it's cleared). */
  wasCalm = false;
  /** Seconds left in which the sea floor still doesn't kill, after calm water (oceanCalmFloorGrace). */
  floorGrace = 0;
  /** The waterfront at the end (or just behind the start) of the stage. */
  shore: Shore | null = null;
  /** Top of the view in city coordinates: 0 in the city, OCEAN_DEPTH in the ocean, in between while diving or leaping. */
  cameraY = 0;
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
  /** Which city stage this is (1 = the first, 2 = after the first dive, …): new hazards come in with later ones. */
  cityStage = 1;

  obstacles: Obstacle[] = [];
  powerLines: PowerLine[] = [];
  balloons: Balloon[] = [];
  targets: Target[] = [];
  pebbles: Pebble[] = [];
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
  /** 0..1 white camera flash over the whole screen. */
  flash = 0;
  /** The latest shot, popping up as a polaroid. */
  polaroid: { photoId: number; life: number; maxLife: number; wedding?: WeddingPhoto; trophy?: boolean } | null = null;
  /** Photos that went to print, in order. */
  frontPages: Tabloid[] = [];
  camerasSmashed = 0;
  kidsDisarmed = 0;
  pebblesShot = 0;
  bonks = 0;
  wedding: Wedding | null = null;
  bouquet: Bouquet | null = null;
  doves: Dove[] = [];
  /** Official photos of this run's weddings, in order. */
  weddingPhotos: WeddingPhoto[] = [];
  weddingsRuined = 0;
  bouquetsCaught = 0;
  balloonsPopped = 0;
  angler: Angler | null = null;
  anglersSnapped = 0;
  shark: Shark | null = null;
  /**
   * Seconds into the shark's theme music, which starts well before the shark
   * shows up (null = no shark coming). The shark times its approach so it
   * lunges at `sharkThemeAttack`; main.ts keeps the music in sync with this.
   */
  sharkTheme: number | null = null;
  sharksSpiked = 0;
  /** The run ended in a shark: the fish isn't drawn. */
  eaten = false;
  /** The run ended on the fisherman's line: the trophy photo's id. */
  trophy: number | null = null;
  message: { text: string; life: number } | null = null;
  dyingTime = 0;
  /** The run ended on a wire: the bird is drawn charred. */
  zapped = false;
  /** Seconds left of the electrocution flash (skeleton flicker). */
  zapFlash = 0;

  /** Distance at which the next obstacle spawns. */
  nextObstacleAt = 0;
  targetSpawnAcc = 0;
  jellySpawnAcc = 0;
  lastGapCenter = 260;
  /** Regular obstacles spawned in the current stage (the gate comes after enough). */
  stageObstacles = 0;
  gateSpawned = false;
  /** Published photos waiting for an obstacle to hang on. */
  pendingTabloids: Tabloid[] = [];
  nextPhotoId = 1;
  lastPaparazzoAt = -Infinity;
  paparazziSeen = 0;
  lastKidAt = -Infinity;
  /** This city stage gets a wedding that hasn't happened yet. */
  weddingPlanned = false;
  /** This ocean stage gets a fisherman who hasn't shown up yet. */
  anglerPlanned = false;
  sharkPlanned = false;

  events: GameEvent[] = [];

  /**
   * Start-screen attract mode: the bird flies itself over a city of plain
   * targets (no buildings or specials) and every poop lands on someone.
   */
  demo = false;

  /**
   * Before a run: x of the street lamp the bird sits on to practise (null =
   * no lamp). Once the run starts, the lamp scrolls away with the street.
   */
  perchX: number | null = null;
  /** The bird still sits on the perch (the run hasn't started). */
  perched = false;

  constructor(width: number) {
    this.resize(width);
    this.reset();
  }

  resize(width: number): void {
    this.width = width;
    const x = this.bird.x;
    this.bird.x = Math.round(Math.min(320, width * 0.28));
    // Still on the perch (e.g. a phone turned to landscape): the lamp moves with the bird.
    if (this.perched && this.perchX !== null) this.perchX += this.bird.x - x;
  }

  reset(): void {
    this.demo = false;
    this.perchX = null;
    this.perched = false;
    this.phase = "playing";
    this.time = 0;
    this.runTime = 0;
    Object.assign(this.bird, { y: 240, vy: 0, rot: 0, stretch: 1, stretchV: 0, relief: 0, flap: 0 });
    this.charge = initialChargeState();
    this.straining = false;
    this.stage = "city";
    this.transition = null;
    this.calmWater = false;
    this.guideY = null;
    this.calmCity = false;
    this.wasCalm = false;
    this.floorGrace = 0;
    this.shore = null;
    this.cameraY = 0;
    this.puffInput = 0;
    Object.assign(this.fish, { puff: 0, spikes: 0, flare: 0 });
    this.spike = initialSpikeState();
    this.jellies = [];
    this.jelliesPopped = 0;
    this.speed = 0;
    this.stageTime = 0;
    this.cityStage = 1;
    this.obstacles = [];
    this.powerLines = [];
    this.balloons = [];
    this.targets = [];
    this.pebbles = [];
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
    this.flash = 0;
    this.polaroid = null;
    this.frontPages = [];
    this.camerasSmashed = 0;
    this.kidsDisarmed = 0;
    this.pebblesShot = 0;
    this.bonks = 0;
    this.balloonsPopped = 0;
    this.angler = null;
    this.anglersSnapped = 0;
    this.trophy = null;
    this.anglerPlanned = false;
    this.shark = null;
    this.sharkTheme = null;
    this.sharksSpiked = 0;
    this.eaten = false;
    this.sharkPlanned = false;
    this.lastKidAt = -Infinity;
    this.wedding = null;
    this.bouquet = null;
    this.doves = [];
    this.weddingPhotos = [];
    this.weddingsRuined = 0;
    this.bouquetsCaught = 0;
    this.weddingPlanned = Math.random() < config.weddingChance;
    this.pendingTabloids = [];
    this.lastPaparazzoAt = -Infinity;
    this.paparazziSeen = 0;
    this.message = null;
    this.dyingTime = 0;
    this.zapped = false;
    this.zapFlash = 0;
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

  /**
   * Per-stage difficulty of a hazard that first shows up in city stage
   * `first`: 0 there, rising each city stage to 1 at `cityStagesToHardest`.
   */
  stageLevel(first = 1): number {
    const hardest = Math.round(config.cityStagesToHardest);
    if (hardest <= first) return this.cityStage >= first ? 1 : 0;
    return Math.min(1, Math.max(0, (this.cityStage - first) / (hardest - first)));
  }

  get scrollSpeed(): number {
    if (this.demo) return config.scrollSpeed;
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

  /** The fish lies on (or just above) the sea floor. */
  get onSeaFloor(): boolean {
    return this.stage === "ocean" && this.bird.y + this.bodyRadius >= GROUND_Y - 30;
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

  /** Offset of the current stage's y in city coordinates (0 in the city, OCEAN_DEPTH in the ocean). */
  get stageOffset(): number {
    return this.stage === "ocean" ? OCEAN_DEPTH : 0;
  }

  /** Where the city's ground is harbour water rather than quay and street. */
  overWater(x: number): boolean {
    const s = this.shore;
    if (!s) return false;
    return s.kind === "dive" ? x > s.x : x < s.x;
  }

  /** What the bird lands on at its x: the water or the street (the sea floor in the ocean). */
  floorY(): number {
    return this.stage === "city" && this.overWater(this.bird.x) ? WATER_Y : GROUND_Y;
  }

  get sweetSpot(): boolean {
    return inSweetSpot(this.charge, config);
  }

  /** Fraction (0..1) of the overstrain time used up while at full charge. */
  get overstrainProgress(): number {
    return this.charge.charge >= 1 ? Math.min(1, this.charge.fullHold / Math.max(1e-3, config.overstrainTime)) : 0;
  }

  /** Resets into the start screen's attract mode (see `demo`). */
  startDemo(): void {
    this.reset();
    this.demo = true;
  }

  /** One attract-mode step: the autopilot strains and lets go, and steers each poop onto a target. */
  stepDemo(dt: number): void {
    this.straining = autopilot(this);
    this.step(dt);
    // A long strain would send it to the top of the screen: hop, don't launch.
    this.bird.vy = Math.max(this.bird.vy, -DEMO_MAX_RISE);
    // The autopilot lets go when the poop's natural fall lands on someone; it only
    // gets a slight nudge for what it can't foresee (people stopping or turning).
    for (const p of this.poops) {
      const aim = aimPoop(this, p.x, p.y, p.vy, p.vx, DEMO_MAX_NUDGE);
      if (aim) p.vx += (aim.vx - p.vx) * Math.min(1, dt * 3);
    }
    // Nobody listens on the start screen.
    this.events = [];
  }

  /** Menus / countdown: the bird hovers in place and effects keep animating. */
  idle(dt: number): void {
    this.time += dt;
    this.speed = 0;
    this.bird.y = 240 + Math.sin(this.time * 2.5) * 12;
    this.bird.rot = Math.sin(this.time * 2.5 + 1) * 0.08;
    updateEffects(this, dt, 0);
  }

  /** Sits the bird on the practice perch. Call after reset(). */
  perch(): void {
    const b = this.bird;
    this.perched = true;
    this.perchX = b.x;
    Object.assign(b, { y: PERCH_Y, vy: 0, rot: 0 });
  }

  /**
   * One practice step on the perch: `straining` charges as in a run and a
   * release poops and hops the bird, but the world holds still and the bird
   * lands back on the lamp. Nothing spawns and nothing can hurt it.
   */
  stepPerch(dt: number): void {
    this.time += dt;
    this.speed = 0;
    updateCharge(this, dt);
    const b = this.bird;
    b.vy = Math.max(b.vy, -PERCH_MAX_RISE);
    const charging = this.charge.charge > 0 && !this.stunned;
    b.vy = Math.min(b.vy + config.gravity * (charging ? config.chargeGravityScale : 1) * dt, config.maxFallSpeed);
    b.y += b.vy * dt;
    if (b.y >= PERCH_Y) {
      b.y = PERCH_Y;
      if (b.vy > 0) b.vy = 0;
    }
    animateBird(this, dt);
    b.rot += ((this.stunned ? 0 : Math.max(-0.5, Math.min(0.7, b.vy / 700))) - b.rot) * Math.min(1, dt * 10);
    for (const t of this.targets) t.hitFlash = Math.max(0, t.hitFlash - dt);
    updatePoops(this, dt, 0);
    updateEffects(this, dt, 0);
  }

  /** The run starts: practice hits and mishaps don't count. The lamp stays behind. */
  leavePerch(): void {
    this.perched = false;
    this.bonus = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.targetsHit = 0;
    this.poopsDropped = 0;
    this.accidents = 0;
    this.floaters = [];
  }

  step(dt: number): void {
    this.time += dt;
    this.runTime += dt;
    this.speed = 0;
    if (this.phase === "over") {
      updateEffects(this, dt, 0);
      return;
    }
    if (this.transition && this.phase === "playing") {
      updateTransition(this, dt);
      updateEffects(this, dt, this.speed);
      return;
    }
    // Calm water just ended: the fish may be lying on the sea floor, so it gets a moment to swim off it.
    // Once it has, the floor is deadly again.
    if (this.wasCalm && !this.calmWater) this.floorGrace = config.oceanCalmFloorGrace;
    this.wasCalm = this.calmWater;
    if (!this.onSeaFloor) this.floorGrace = 0;
    this.floorGrace = Math.max(0, this.floorGrace - dt);
    const alive = this.phase === "playing";
    const ocean = this.stage === "ocean";
    // The world holds still while the fisherman reels in a hooked fish.
    const reeling = this.angler?.state === "hooked";
    const speed = alive && !reeling ? this.scrollSpeed * (ocean ? config.oceanScrollScale : 1) : 0;
    this.speed = speed;
    if (alive) {
      this.distance += speed * dt;
      this.stageTime += dt;
    }
    if (this.perchX !== null) {
      this.perchX -= speed * dt;
      if (this.perchX < -100) this.perchX = null;
    }

    if (ocean) {
      if (alive && !reeling && !this.calmWater) updateSpike(this, dt);
      updateFish(this, dt);
    } else {
      if (alive) updateCharge(this, dt);
      updateBird(this, dt);
    }
    updateShore(this, dt, speed);
    updateObstacles(this, dt, speed);
    updatePowerLines(this, dt, speed);
    updateBalloons(this, dt, speed);
    updateTargets(this, dt, speed);
    updatePoops(this, dt, speed);
    updatePebbles(this, dt);
    updateWedding(this, dt);
    updateBouquet(this, dt);
    updateJellies(this, dt, speed);
    updateAngler(this, dt, speed);
    updateSharkTheme(this, dt);
    updateShark(this, dt);
    updateEffects(this, dt, speed);

    if (this.phase === "dying") {
      this.dyingTime += dt;
      const landed = this.angler?.state === "landed";
      if (this.eaten ? this.dyingTime > 1.8 : landed ? this.dyingTime > 2.6 : this.dyingTime > 1.3 && this.bird.y >= this.floorY() - this.bodyRadius - 1) {
        this.phase = "over";
        this.events.push({ type: "gameover" });
      }
    }
  }

  crash(cause: "crash" | "zap" | "chomp" = "crash"): void {
    if (this.demo) return;
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
    this.events.push({ type: cause });
  }

  zap(): void {
    this.crash("zap");
    this.zapped = true;
    this.zapFlash = 0.7;
    this.shake = 16;
    this.message = { text: pick(ZAP_MESSAGES), life: 2.2 };
    const b = this.bird;
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 150 + Math.random() * 350;
      this.particles.push({
        x: b.x, y: b.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.35, maxLife: 0.6, size: 2 + Math.random() * 3,
        color: pick(["#fff", "#fff3b0", "#ffd60a", "#9bf6ff"]), gravity: 300, world: false,
      });
    }
  }

  /** Debug: the shark's music starts now, and the shark follows as it would in a run (ocean only). */
  spawnSharkNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "ocean" || this.shark || this.sharkTheme !== null) return;
    // Not during the swim lesson: the fish can't spike yet.
    if (this.calmWater) return;
    startSharkTheme(this);
  }

  /** Debug: a fisherman rows in right now (ocean only). */
  spawnAnglerNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "ocean" || this.angler) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 260);
    this.jellies = this.jellies.filter((j) => j.x < this.width - 200);
    spawnAngler(this);
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + ANGLER_ROOM + config.oceanSpacingMin);
  }

  /** Debug: dive into the ocean right away, skipping the city: the harbour opens up under the bird. */
  diveNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.shore = { x: this.bird.x - DIVE_TAKEOVER, kind: "dive" };
    this.obstacles = [];
    this.powerLines = [];
    this.balloons = [];
    this.targets = this.targets.filter((t) => t.x + t.w / 2 < this.shore!.x);
    startTransition(this, "ocean");
  }

  /** Debug: the stage's waterfront comes next, right now. */
  spawnShoreNow(): void {
    if (this.phase !== "playing" || this.transition || this.gateSpawned) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 260);
    this.powerLines = this.powerLines.filter((l) => poleX(l, l.poles - 1) < this.width - 260);
    this.balloons = this.balloons.filter((b) => b.x + BALLOON_RX < this.width - 260);
    spawnShore(this);
  }

  /** Debug: spawn a power line right now (city only). */
  spawnPowerLineNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 150);
    const length = spawnPowerLine(this);
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + length + config.obstacleSpacingMin);
  }

  /** Debug: a balloon floats in right now (city only). */
  spawnBalloonNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 150);
    const length = spawnBalloon(this);
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + length + config.obstacleSpacingMin);
  }

  /** Debug: a boat that drops its anchor comes in right now (ocean only). */
  spawnAnchorDropNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "ocean" || this.angler || this.gateSpawned) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 260);
    spawnOceanObstacle(this, true);
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + config.oceanSpacingMin);
  }

  /** A car drives on right now (the city lesson's first target). */
  spawnCarNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    spawnTarget(this, "car");
  }

  /** Debug: a paparazzo walks on right now. */
  spawnPaparazzoNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    spawnPaparazzo(this);
  }

  /** Debug: a slingshot kid walks on right now. */
  spawnKidNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    spawnKid(this);
  }

  /** Debug: a wedding right now (city only). */
  spawnWeddingNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city" || this.wedding) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 280);
    this.powerLines = this.powerLines.filter((l) => poleX(l, l.poles - 1) < this.width - 280);
    this.balloons = this.balloons.filter((b) => b.x + BALLOON_RX < this.width - 280);
    this.targets = this.targets.filter((t) => t.kind === "car" || t.x < this.width - 280);
    const extra = spawnWedding(this);
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + extra + config.obstacleSpacingMin);
  }
}
