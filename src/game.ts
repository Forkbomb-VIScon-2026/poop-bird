// Game simulation: bird, obstacles, targets, poops, particles, score.
// Runs at a fixed timestep (see main.ts). Rendering lives in render.ts.
// The simulation pushes GameEvents that main.ts turns into sound and UI.
//
// A run alternates between stages: city → ocean → city → … A gate obstacle
// ends each stage; flying through it starts a StageTransition (splash +
// transform) during which the world is frozen. In the ocean the bird is a
// pufferfish driven by `puffInput` instead of `straining`.
//
// In the city, some obstacle slots become power lines instead of buildings:
// poles with sagging wires. Touching a wire zaps the bird; pigeons sitting on
// the wires are targets.
//
// Slingshot kids walk on along the sidewalk, plant their feet and take aim at
// the bird (a dotted arc shows where). A pebble that hits bonks the bird: it
// tumbles, stunned, and loses its charge and combo. Buildings block pebbles,
// a falling poop can shoot one down mid-air, and splatting the kid before he
// lets go disarms him.
//
// Once per city stage (or so) there's a wedding: a church, a couple on the
// sidewalk in front of it, guests and a photographer who counts down
// "3… 2… 1… KISS!". Splat the couple mid-kiss and the wedding is ruined (a
// jackpot), and the photo of that moment becomes the official wedding photo.
// Miss and they're married: confetti, doves, and the bride tosses her bouquet.
// Ruin it and she throws the bouquet at you instead.

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

export type BottomKind = "billboard" | "building" | "chimney" | "tower" | "church" | "harbour" | "coral" | "rock" | "reef";
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
  /** Set when `bottom` is "billboard": the published front page it shows. */
  tabloid: Tabloid | null;
}

/** A paparazzo's photo that made it to print. `photoId` keys the image main.ts captured. */
export interface Tabloid {
  photoId: number;
  headline: string;
}

/**
 * The paparazzo's state. Watching: walking up with the camera raised while
 * his timer ring fills; it's full when he's just past the bird, and he takes
 * the shot. Snapped: he got it (the photo is published). Smashed: a poop got
 * him first.
 */
export type PaparazzoState = "watching" | "snapped" | "smashed";

export interface Paparazzo {
  state: PaparazzoState;
  /** 0..1 timer ring: how close he is to the shot. */
  timer: number;
  /** Where he spawned, so the timer runs from there to the bird. */
  startX: number;
  /** The run's first paparazzo walks slower and gets a "SPLAT HIM!" arrow. */
  tutorial: boolean;
  /** Camera angle toward the bird (radians, screen space). */
  aim: number;
  /** Seconds of the lens flash burst. */
  flash: number;
  /** Counts down to the next tick of the camera beep, which speeds up as the timer fills. */
  beep: number;
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

/**
 * A run of wooden poles (city) with wires sagging between them. Poles stand
 * `span` px apart; every wire hangs from all poles at the same height.
 */
export interface PowerLine {
  /** Screen x of the first pole. */
  x: number;
  span: number;
  poles: number;
  /** Height of the pole tops (above the top wire). */
  topY: number;
  /** Top wire first: attach height at the poles, and the sag of each span. */
  wires: { y: number; sags: number[] }[];
  pigeons: Pigeon[];
  seed: number;
}

export interface Pigeon {
  wire: number;
  span: number;
  /** 0..1 along the span. */
  t: number;
  facing: 1 | -1;
  seed: number;
  /** Seconds of a startled hop (a neighbour got hit). */
  startle: number;
  /** Set once it's hit: it flies off, splattered (screen space). */
  flyer: { x: number; y: number; vx: number; vy: number } | null;
}

/**
 * A slingshot kid's state. Walking: trotting toward the bird. Aiming: feet
 * planted, pulling the band back while tracking the bird; fires when `pull`
 * reaches 1. Reloading: a beat between shots. Taunting: out of shots or the
 * bird got past. Cheering: a pebble bonked the bird. Crying: a poop got him.
 */
export type KidState = "walking" | "aiming" | "reloading" | "taunting" | "cheering" | "crying";

export interface Kid {
  state: KidState;
  /** Seconds in the current state. */
  t: number;
  /** 0..1 how far the band is pulled back while aiming. */
  pull: number;
  /** Seconds the current wind-up takes. */
  windup: number;
  shots: number;
  /** Launch velocity of the next pebble (screen space, px/s), tracked while aiming. */
  aimVx: number;
  aimVy: number;
  /** Seconds of the band's snap-back after a shot. */
  twang: number;
}

/** A slingshot pebble, in screen space. */
export interface Pebble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** Closest it came to the bird so far (for the "close one" bonus). */
  closest: number;
  /** Set once it has paid the "close one" bonus (at most once per pebble). */
  dodged: boolean;
  /** The kid who shot it. */
  from: Target;
}

export type TargetKind = "car" | "pedestrian" | "statue" | "paparazzo" | "kid" | "bride" | "groom" | "guest" | "photographer";

/**
 * The wedding's progress. Arriving: the party scrolls in. Countdown: the
 * photographer counts 3… 2… 1…. Kiss: the jackpot window. After: the
 * photo's taken and `outcome` says how it went.
 */
export type WeddingPhase = "arriving" | "countdown" | "kiss" | "after";
export type WeddingOutcome = "ruined" | "married";

export interface Wedding {
  phase: WeddingPhase;
  /** Seconds in the current phase. */
  t: number;
  /** The countdown number showing (3, 2, 1); 0 before and after. */
  count: number;
  outcome: WeddingOutcome | null;
  /** The run's first wedding gets a hint over the couple. */
  tutorial: boolean;
  /** "Reto ♥ Nadine", on the banner over the arch. */
  names: string;
  /** The couple got splatted before the kiss (they carry on, a bit brown). */
  early: boolean;
  /** Set once the bride has thrown (or tossed) her bouquet. */
  thrown: boolean;
  /** Set once the arrival music has started (the couple is on screen). */
  announced: boolean;
  /** Seconds of the photographer's flash. */
  flash: number;
  bride: Target;
  groom: Target;
  photographer: Target;
  guests: Target[];
  church: Obstacle;
}

/** The bride's bouquet, in screen space: tossed for the bird to catch, or thrown at it. */
export interface Bouquet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** Thrown at the bird by a furious bride (it knocks the bird), or tossed to it (catch it for points). */
  angry: boolean;
}

/** A released white dove, in screen space (scenery). */
export interface Dove {
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
}

/** The official photo of a wedding. `photoId` keys the image main.ts composed. */
export interface WeddingPhoto {
  photoId: number;
  ruined: boolean;
  names: string;
}

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
  | { type: "hit"; points: number; combo: number; kind: TargetKind | "pigeon" }
  | { type: "crash" }
  | { type: "zap" }
  | { type: "gameover" }
  | { type: "gateEntered"; to: Stage }
  | { type: "transformed" }
  | { type: "surfaced" }
  | { type: "spike" }
  | { type: "pop"; message: string }
  | { type: "jellyPopped"; points: number; combo: number }
  | { type: "paparazzoBeep"; timer: number }
  | { type: "photo"; photoId: number }
  | { type: "cameraSmashed" }
  | { type: "slingshotDraw"; windup: number }
  | { type: "slingshotFire" }
  | { type: "bonk" }
  | { type: "pebbleShot"; points: number; combo: number }
  | { type: "ricochet" }
  | { type: "kidCried" }
  | { type: "weddingArrived" }
  | { type: "weddingBeat"; count: number }
  | { type: "weddingKiss" }
  | { type: "weddingRuined"; points: number }
  | { type: "weddingMarried" }
  | { type: "weddingPhoto"; photoId: number; ruined: boolean }
  | { type: "bouquetThrown"; angry: boolean }
  | { type: "bouquetCaught"; points: number }
  | { type: "bouquetHit" };

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

const ZAP_MESSAGES = [
  "ZZZAP!",
  "Shocking!",
  "Extra crispy",
  "Fried chicken… almost",
  "Watt were you thinking?",
  "Current situation: bad",
];

const BONK_MESSAGES = ["BONK!", "Right in the beak!", "Headshot!", "Ow ow ow", "Seeing stars", "Little brat!"];

const SNAP_MESSAGES = ["SNAP!", "SAY CHEESE!", "CAUGHT ON CAMERA!", "*CLICK*", "GOT YOU!"];

const HEADLINES = [
  "LOCAL BIRD STRAINS IN PUBLIC",
  "SHOCK PICS: THE FACE OF EFFORT",
  "\u201CI WAS JUST FLYING\u201D CLAIMS BIRD",
  "CONSTIPATION CRISIS GRIPS CITY",
  "BIRD'S PRIVATE MOMENT EXPOSED",
  "PUSHING IT TOO HARD?",
  "IS THIS THE WORST FACE EVER?",
  "FIBRE SHORTAGE: THE HUMAN COST",
  "EXPERTS: \u201CJUST RELAX\u201D",
];

const COUPLES = [
  "Reto \u2665 Nadine",
  "Beat \u2665 Vreni",
  "Ueli \u2665 Heidi",
  "Kevin \u2665 Chantal",
  "J\u00FCrg \u2665 Sandra",
  "Luca \u2665 Lea",
  "Urs \u2665 Brigitte",
];

const RUIN_MESSAGES = ["OBJECTION!", "SPEAK NOW!", "UNHOLY MATRIMONY!", "TILL DEATH DO US PART!", "SOMETHING BROWN!"];
const EARLY_MESSAGES = ["Not the dress!", "Wait for the kiss!", "Too early!", "Rude!"];
const BOUQUET_MESSAGES = ["BRIDEZILLA!", "Right in the face!", "Hell hath no fury…", "She's got an arm!"];

/** Pastel outfits for the wedding guests. */
const GUEST_COLORS = ["#ff8fab", "#a2d2ff", "#cdb4db", "#ffc8dd", "#bde0fe", "#b9fbc0", "#fde68a"];

const CAR_COLORS = ["#e84a5f", "#2a9df4", "#ffb400", "#5cc96b", "#9b5de5", "#f9844a"];
const PERSON_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#fd79a8", "#00b894"];
const BUILDING_COLORS = ["#c8553d", "#588b8b", "#8e7dbe", "#d4a373", "#6d8a96", "#b56576"];
const CORAL_COLORS = ["#ff7f6e", "#ff9f43", "#f368e0", "#ee5a6f", "#ffb86b"];
const ROCK_COLORS = ["#6b7b8c", "#7d6e63", "#5f6f7a"];
const JELLY_HUES = [320, 285, 200, 340];

export type GamePhase = "playing" | "dying" | "over";

/** Wire half-thickness for collisions (the bird's hit radius is added). */
const WIRE_HIT = 2;
/** Pigeon hit radius for poops. */
export const PIGEON_R = 16;
/** Pebble radius (drawn and for collisions). */
export const PEBBLE_R = 5;
/** A kid stops shooting once he's this close to (or behind) the bird. */
const KID_MIN_AHEAD = 70;

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
  powerLines: PowerLine[] = [];
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
  polaroid: { photoId: number; life: number; maxLife: number; wedding?: WeddingPhoto } | null = null;
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
  message: { text: string; life: number } | null = null;
  dyingTime = 0;
  /** The run ended on a wire: the bird is drawn charred. */
  zapped = false;
  /** Seconds left of the electrocution flash (skeleton flicker). */
  zapFlash = 0;

  /** Distance at which the next obstacle spawns. */
  private nextObstacleAt = 0;
  private targetSpawnAcc = 0;
  private jellySpawnAcc = 0;
  private lastGapCenter = 260;
  /** Regular obstacles spawned in the current stage (the gate comes after enough). */
  private stageObstacles = 0;
  private gateSpawned = false;
  /** Published photos waiting for an obstacle to hang on. */
  private pendingTabloids: Tabloid[] = [];
  private nextPhotoId = 1;
  private lastPaparazzoAt = -Infinity;
  private paparazziSeen = 0;
  private lastKidAt = -Infinity;
  /** This city stage gets a wedding that hasn't happened yet. */
  private weddingPlanned = true;
  private weddingsSeen = 0;

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
    this.powerLines = [];
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
    this.lastKidAt = -Infinity;
    this.wedding = null;
    this.bouquet = null;
    this.doves = [];
    this.weddingPhotos = [];
    this.weddingsRuined = 0;
    this.bouquetsCaught = 0;
    this.weddingPlanned = true;
    this.weddingsSeen = 0;
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
    this.updatePowerLines(dt, speed);
    this.updateTargets(dt, speed);
    this.updatePoops(dt, speed);
    this.updatePebbles(dt);
    this.updateWedding(dt);
    this.updateBouquet(dt);
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
    if (this.phase === "playing" && this.touchesWire()) this.zap();
    if (this.zapped && Math.random() < dt * 25) {
      this.particles.push({
        x: b.x + (Math.random() - 0.5) * 20, y: b.y - 10,
        vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 40,
        life: 0.9, maxLife: 0.9, size: 4 + Math.random() * 6, color: "rgba(90,90,90,0.6)",
        gravity: -40, world: true,
      });
    }
  }

  private crash(cause: "crash" | "zap" = "crash"): void {
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

  private hitsObstacle(): boolean {
    const { x, y } = this.bird;
    const r = this.hitRadius;
    for (const o of this.obstacles) {
      if (o.x > x + 80 || o.x + o.w < x - 80) continue;
      for (const rect of obstacleRects(o)) if (circleRect(x, y, r, rect)) return true;
    }
    for (const l of this.powerLines) {
      for (let i = 0; i < l.poles; i++) if (circleRect(x, y, r, poleRect(l, i))) return true;
    }
    return false;
  }

  private touchesWire(): boolean {
    const { x, y } = this.bird;
    const r = this.hitRadius;
    for (const l of this.powerLines) {
      for (let w = 0; w < l.wires.length; w++) {
        const wire = wireAt(l, w, x);
        if (!wire) continue;
        // Distance to the wire, measured perpendicular to its slope.
        const dist = Math.abs(y - wire.y) / Math.sqrt(1 + wire.slope * wire.slope);
        if (dist < r + WIRE_HIT) return true;
      }
    }
    return false;
  }

  private zap(): void {
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
    this.powerLines = [];
    this.targets = [];
    this.pebbles = [];
    this.poops = [];
    this.decals = [];
    this.jellies = [];
    this.screenSplats = [];
    this.wedding = null;
    this.bouquet = null;
    this.doves = [];
    if (to === "city") this.weddingPlanned = Math.random() < config.weddingChance;
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

  /** Debug: spawn a power line right now (city only). */
  spawnPowerLineNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 150 || o.gate);
    const length = this.spawnPowerLine();
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + length + config.obstacleSpacingMin);
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
      // The harbour waits until a paparazzo's front page has hung in the city.
      const holdGate = !ocean && (this.pendingTabloids.length > 0 || this.targets.some((t) => t.pap?.state === "watching"));
      // A power line takes up more room: the next obstacle waits until it's past.
      // A pending front page always gets the next slot.
      const powerLine = this.stageObstacles > 0 && this.pendingTabloids.length === 0 && Math.random() < config.powerLineChance;
      let extra = 0;
      if (this.stageObstacles >= before && !holdGate) this.spawnGate();
      else if (ocean) this.spawnOceanObstacle();
      else if (this.weddingDue()) extra = this.spawnWedding();
      else if (powerLine) extra = this.spawnPowerLine();
      else this.spawnObstacle();
      this.stageObstacles++;
      this.nextObstacleAt = this.distance + extra + (ocean
        ? ramp(config.oceanSpacing, config.oceanSpacingMin, this.difficulty)
        : ramp(config.obstacleSpacing, config.obstacleSpacingMin, this.difficulty));
    }
  }

  /** Picks a gap centre in [top + margin + gap/2, GROUND_Y − bottomMargin − gap/2], within maxJump of the last one. */
  private pickGapCenter(gap: number, top: number, margin: number, maxJump: number, bottomMargin = margin): number {
    const minCenter = top + margin + gap / 2;
    const maxCenter = GROUND_Y - bottomMargin - gap / 2;
    let center = minCenter + Math.random() * Math.max(0, maxCenter - minCenter);
    center = Math.max(this.lastGapCenter - maxJump, Math.min(this.lastGapCenter + maxJump, center));
    center = Math.max(minCenter, Math.min(maxCenter, center));
    this.lastGapCenter = center;
    return center;
  }

  private spawnObstacle(): void {
    const d = this.difficulty;
    const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
    // A published photo goes up on a roadside billboard, which needs the whole board below the gap.
    const tabloid = this.pendingTabloids.shift() ?? null;
    // Limit how far the gap jumps, so the next gap is always reachable.
    const center = this.pickGapCenter(gap, 0, 50, 140 + 140 * d, tabloid ? BILLBOARD_H + BILLBOARD_MIN_LEGS : 50);

    const bottom: BottomKind = tabloid ? "billboard" : pick(["building", "building", "chimney", "tower"]);
    const w = bottom === "billboard" ? BILLBOARD_W : bottom === "chimney" ? 62 : bottom === "tower" ? 78 : 96 + Math.random() * 30;
    this.obstacles.push({
      x: this.width + 40, w,
      gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom, top: null, color: pick(BUILDING_COLORS), seed: Math.random() * 1000,
      passed: false, splats: [], gate: null, tabloid,
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
      passed: false, splats: [], gate: null, tabloid: null,
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
      passed: false, splats: [], gate: ocean ? "city" : "ocean", tabloid: null,
    });
  }

  // --- power lines -------------------------------------------------------------

  /** Spawns a power line just off-screen. Returns its length (first to last pole). */
  private spawnPowerLine(): number {
    const d = this.difficulty;
    const poles = 3 + Math.floor(Math.random() * 3);
    const span = config.powerLineSpan * (0.9 + Math.random() * 0.2);
    const r = Math.random();
    const count = d < 0.25 ? 1 : d < 0.6 ? (r < 0.4 ? 1 : 2) : r < 0.5 ? 2 : 3;
    // Room to fly over the pole tops and under the lowest wire, even where it
    // sags most: stacked wires squeeze closer together if they'd go too high.
    const highestTop = 160;
    const lowestMax = 370;
    const gap = count > 1
      ? Math.min(ramp(config.powerLineWireGap, config.powerLineWireGapMin, d), (lowestMax - highestTop) / (count - 1))
      : 0;
    const lowestMin = Math.max(250, highestTop + (count - 1) * gap);
    const lowest = lowestMin + Math.random() * (lowestMax - lowestMin);
    const wires = Array.from({ length: count }, (_, i) => ({
      y: lowest - (count - 1 - i) * gap,
      sags: Array.from({ length: poles - 1 }, () => config.powerLineSag * (0.7 + Math.random() * 0.6)),
    }));
    const line: PowerLine = {
      x: this.width + 60, span, poles, topY: wires[0].y - 16, wires, pigeons: [], seed: Math.random() * 1000,
    };
    // Pigeons, spread out along the spans.
    for (let s = 0; s < poles - 1; s++) {
      const n = Math.floor(config.pigeonsPerSpan + Math.random());
      const taken: number[] = [];
      for (let k = 0; k < n; k++) {
        const t = 0.15 + Math.random() * 0.7;
        if (taken.some((u) => Math.abs(u - t) < 0.12)) continue;
        taken.push(t);
        line.pigeons.push({
          wire: Math.floor(Math.random() * count), span: s, t,
          facing: Math.random() < 0.5 ? 1 : -1, seed: Math.random() * 1000, startle: 0, flyer: null,
        });
      }
    }
    this.powerLines.push(line);
    return span * (poles - 1);
  }

  private updatePowerLines(dt: number, speed: number): void {
    for (const l of this.powerLines) {
      l.x -= speed * dt;
      for (const p of l.pigeons) {
        p.startle = Math.max(0, p.startle - dt);
        const f = p.flyer;
        if (!f) continue;
        // Flies off forward and up, flapping harder as it goes.
        f.vy -= 120 * dt;
        f.x += (f.vx - speed) * dt;
        f.y += f.vy * dt;
      }
    }
    this.powerLines = this.powerLines.filter((l) => l.x + l.span * (l.poles - 1) > -80);
  }

  /** Returns true if the poop hit a pigeon. */
  private poopHitsPigeon(p: Poop): boolean {
    for (const l of this.powerLines) {
      for (const pg of l.pigeons) {
        if (pg.flyer) continue;
        const pos = pigeonPos(l, pg);
        const dx = p.x - pos.x;
        const dy = p.y - (pos.y - PIGEON_R);
        const reach = p.r + PIGEON_R;
        if (dx * dx + dy * dy >= reach * reach) continue;
        pg.flyer = { x: pos.x, y: pos.y, vx: 40 + Math.random() * 80, vy: -140 };
        for (const other of l.pigeons) if (other !== pg && other.span === pg.span && !other.flyer) other.startle = 0.35;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.targetsHit++;
        const points = Math.round(config.targetPoints * config.pigeonMultiplier * this.comboMultiplier * (p.big ? 2 : 1));
        this.bonus += points;
        const label = this.combo > 1 ? `+${points}  x${this.comboMultiplier.toFixed(1)}` : `+${points}`;
        this.floaters.push({ x: pos.x, y: pos.y - 40, text: label, color: "#ffe14d", size: 26, life: 1.1, maxLife: 1.1 });
        this.splatParticles(p.x, p.y, p.r, true);
        this.events.push({ type: "hit", points, combo: this.combo, kind: "pigeon" });
        this.events.push({ type: "splat", big: p.big });
        return true;
      }
    }
    return false;
  }

  // --- targets -----------------------------------------------------------------

  private updateTargets(dt: number, speed: number): void {
    for (const t of this.targets) {
      t.x += (t.speed - speed) * dt;
      t.hitFlash = Math.max(0, t.hitFlash - dt);
      if (t.pap) this.updatePaparazzo(t, dt);
      if (t.kid) this.updateKid(t, dt);
    }
    this.targets = this.targets.filter((t) => t.x > -200 && t.x < this.width + 600);
    if (this.phase !== "playing" || this.stage !== "city") return;
    this.targetSpawnAcc += dt * config.targetSpawnRate;
    if (this.targetSpawnAcc >= 1) {
      this.targetSpawnAcc -= 1 + (Math.random() - 0.5) * 0.6;
      if (this.paparazzoDue() && Math.random() < config.paparazziChance) this.spawnPaparazzo();
      else if (this.kidDue() && Math.random() < config.kidChance) this.spawnKid();
      // Nobody wanders through the wedding; the road stays busy.
      else this.spawnTarget(this.wedding ? "car" : undefined);
    }
  }

  // --- paparazzi ---------------------------------------------------------------

  private paparazzoDue(): boolean {
    return (
      !this.gateSpawned &&
      this.distance >= config.paparazziMinDistance &&
      this.distance - this.lastPaparazzoAt >= config.paparazziMinGap &&
      !this.targets.some((t) => t.pap?.state === "watching") &&
      !this.targets.some(kidArmed) &&
      !this.wedding &&
      !this.weddingNext
    );
  }

  private spawnPaparazzo(): void {
    this.lastPaparazzoAt = this.distance;
    const tutorial = this.paparazziSeen++ === 0;
    const x = this.width + 60;
    this.targets.push({
      x, y: GROUND_Y + 20, w: 56, h: 66, kind: "paparazzo",
      // The first one walks along with the bird, so there's time to figure him out.
      speed: tutorial ? config.paparazziTutorialWalk : 0,
      color: "#6d6875", seed: Math.random() * 1000, splats: [], hitFlash: 0, facing: -1,
      pap: { state: "watching", timer: 0, startX: x, tutorial, aim: -2.4, flash: 0, beep: 0 },
      kid: null,
    });
  }

  /** Debug: a paparazzo walks on right now. */
  spawnPaparazzoNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.spawnPaparazzo();
  }

  private updatePaparazzo(t: Target, dt: number): void {
    const p = t.pap!;
    p.flash = Math.max(0, p.flash - dt);
    if (p.state !== "watching") return;
    // Camera position (see drawPaparazzo): at shoulder height, aiming at the bird.
    const camY = t.y - t.h * 0.72;
    p.aim += (Math.atan2(this.bird.y - camY, this.bird.x - t.x) - p.aim) * Math.min(1, dt * 8);
    if (this.phase !== "playing") return;

    // The timer fills from where he walked on to just past the bird.
    const shotX = this.bird.x - config.paparazziShotOffset;
    p.timer = Math.min(1, Math.max(0, (p.startX - t.x) / Math.max(1, p.startX - shotX)));
    if (p.timer >= 1) {
      this.snap(t);
      return;
    }
    // Camera beep, faster as the timer fills (only once he's on screen).
    if (t.x < this.width) {
      p.beep -= dt;
      if (p.beep <= 0) {
        p.beep = 0.6 - p.timer * 0.48;
        this.events.push({ type: "paparazzoBeep", timer: p.timer });
      }
    }
  }

  /** He got the shot: flash, polaroid, and it's on the next obstacle as a tabloid front page. */
  private snap(t: Target): void {
    const p = t.pap!;
    p.state = "snapped";
    p.timer = 1;
    p.flash = 0.25;
    t.speed = 0;
    const photoId = this.nextPhotoId++;
    this.flash = 1;
    this.shake = Math.max(this.shake, 6);
    this.polaroid = { photoId, life: 2.2, maxLife: 2.2 };
    this.message = { text: pick(SNAP_MESSAGES), life: 1.4 };
    const tabloid: Tabloid = { photoId, headline: pick(HEADLINES) };
    this.frontPages.push(tabloid);
    this.pendingTabloids.push(tabloid);
    this.events.push({ type: "photo", photoId });
  }

  /** A poop got him before the shot: the camera's done for. */
  private smashCamera(t: Target): void {
    const p = t.pap!;
    p.state = "smashed";
    t.speed = 0;
    this.camerasSmashed++;
    // Lens shards
    const camX = t.x;
    const camY = t.y - t.h * 0.72;
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * Math.random();
      const s = 80 + Math.random() * 200;
      this.particles.push({
        x: camX, y: camY, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 1.5 + Math.random() * 2.5,
        color: Math.random() < 0.5 ? "#caf0f8" : "#adb5bd", gravity: 800, world: true,
      });
    }
    this.floaters.push({ x: t.x, y: t.y - t.h - 44, text: "NO PHOTOS!", color: "#7ae582", size: 24, life: 1.3, maxLife: 1.3 });
    this.events.push({ type: "cameraSmashed" });
  }

  private spawnTarget(only?: "car"): void {
    const r = Math.random();
    const kind: TargetKind = only ?? (r < 0.5 ? "car" : r < 0.85 ? "pedestrian" : "statue");
    // Layout: sidewalk GROUND_Y..+20 (pedestrians, statue), road +20..+80 (cars).
    const roadY = GROUND_Y + 68;
    let t: Target;
    const seed = Math.random() * 1000;
    if (kind === "car") {
      const dir = Math.random() < 0.6 ? 1 : -1;
      t = {
        x: this.width + 120, y: roadY, w: 92, h: 40, kind, speed: dir * (40 + Math.random() * 90),
        color: pick(CAR_COLORS), seed, splats: [], hitFlash: 0, facing: dir as 1 | -1, pap: null, kid: null,
      };
    } else if (kind === "pedestrian") {
      const dir = Math.random() < 0.5 ? 1 : -1;
      t = {
        x: this.width + 60, y: GROUND_Y + 20, w: 24, h: 52, kind, speed: dir * (18 + Math.random() * 30),
        color: pick(PERSON_COLORS), seed, splats: [], hitFlash: 0, facing: dir as 1 | -1, pap: null, kid: null,
      };
    } else {
      t = {
        x: this.width + 80, y: GROUND_Y + 20, w: 46, h: 96, kind, speed: 0,
        color: "#8fa3a8", seed, splats: [], hitFlash: 0, facing: -1, pap: null, kid: null,
      };
    }
    this.targets.push(t);
  }

  // --- slingshot kids ----------------------------------------------------------

  private kidDue(): boolean {
    return (
      !this.gateSpawned &&
      this.distance >= config.kidMinDistance &&
      this.distance - this.lastKidAt >= config.kidMinGap &&
      !this.targets.some(kidArmed) &&
      !this.targets.some((t) => t.pap?.state === "watching") &&
      !this.wedding &&
      !this.weddingNext
    );
  }

  private spawnKid(): void {
    this.lastKidAt = this.distance;
    const d = this.difficulty;
    this.targets.push({
      x: this.width + 40, y: GROUND_Y + 20, w: 34, h: 62, kind: "kid", speed: -config.kidWalkSpeed,
      color: pick(PERSON_COLORS), seed: Math.random() * 1000, splats: [], hitFlash: 0, facing: -1, pap: null,
      kid: {
        state: "walking", t: 0, pull: 0, windup: 1,
        shots: Math.min(Math.max(1, Math.round(config.kidShotsMax)), 1 + Math.floor(d * config.kidShotsMax)),
        aimVx: 0, aimVy: 0, twang: 0,
      },
    });
  }

  /** Debug: a slingshot kid walks on right now. */
  spawnKidNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city") return;
    this.spawnKid();
  }

  private setKidState(t: Target, state: KidState): void {
    const k = t.kid!;
    k.state = state;
    k.t = 0;
    k.pull = 0;
  }

  private updateKid(t: Target, dt: number): void {
    const k = t.kid!;
    k.t += dt;
    k.twang = Math.max(0, k.twang - dt);
    const ahead = t.x - this.bird.x;
    if (this.phase !== "playing") {
      // The bird's going down: whoever still had shots left is thrilled.
      if (k.state === "aiming" || k.state === "reloading" || k.state === "walking") {
        t.speed = 0;
        this.setKidState(t, "cheering");
      }
      return;
    }
    switch (k.state) {
      case "walking":
        // Plants his feet once he's on screen, in range and has a clear shot.
        if (ahead < KID_MIN_AHEAD) this.setKidState(t, "taunting");
        else if (ahead < config.kidRange && t.x < this.width - 30 && !this.kidCovered(t)) {
          t.speed = 0;
          this.startAim(t);
        }
        break;
      case "aiming":
        if (ahead < KID_MIN_AHEAD) {
          this.setKidState(t, "taunting");
          break;
        }
        this.aimKid(t);
        k.pull = Math.min(1, k.t / k.windup);
        if (k.pull >= 1) this.fireKid(t);
        break;
      case "reloading":
        if (k.t < 0.45) break;
        if (k.shots <= 0 || ahead < KID_MIN_AHEAD + 60) {
          t.speed = 0;
          this.setKidState(t, "taunting");
        } else if (this.kidCovered(t)) {
          t.speed = -config.kidWalkSpeed; // steps out from behind the building
        } else {
          t.speed = 0;
          this.startAim(t);
        }
        break;
      case "cheering":
        // A little victory dance, then back to it if he has pebbles left.
        if (k.t > 1.1) this.setKidState(t, "reloading");
        break;
      case "taunting":
      case "crying":
        break;
    }
  }

  /** True if a building or pole is in front of his slingshot (he'd only hit the wall). */
  private kidCovered(t: Target): boolean {
    const s = slingshotPos(t);
    for (const o of this.obstacles) for (const r of obstacleRects(o)) if (circleRect(s.x, s.y, 14, r)) return true;
    for (const l of this.powerLines) for (let i = 0; i < l.poles; i++) if (circleRect(s.x, s.y, 14, poleRect(l, i))) return true;
    return false;
  }

  private startAim(t: Target): void {
    const k = t.kid!;
    this.setKidState(t, "aiming");
    k.windup = ramp(config.kidWindup, config.kidWindupMin, this.difficulty);
    this.aimKid(t);
    this.events.push({ type: "slingshotDraw", windup: k.windup });
  }

  /**
   * Aims a lob that reaches the bird (plus a bit of lead along its current
   * vertical speed) after the flight time: plain projectile maths.
   */
  private aimKid(t: Target): void {
    const k = t.kid!;
    const T = Math.max(0.2, ramp(config.kidFlightTime, config.kidFlightTimeMin, this.difficulty));
    const s = slingshotPos(t);
    const b = this.bird;
    const ty = Math.max(BIRD_RADIUS, Math.min(GROUND_Y - 40, b.y + b.vy * T * config.kidLead));
    k.aimVx = (b.x - s.x) / T;
    k.aimVy = (ty - s.y) / T - 0.5 * config.kidPebbleGravity * T;
  }

  private fireKid(t: Target): void {
    const k = t.kid!;
    const s = slingshotPos(t);
    this.pebbles.push({ x: s.x, y: s.y, vx: k.aimVx, vy: k.aimVy, rot: 0, closest: Infinity, dodged: false, from: t });
    k.shots--;
    this.setKidState(t, "reloading");
    k.twang = 0.3;
    this.events.push({ type: "slingshotFire" });
  }

  /** A poop got him while he was armed: he drops the slingshot and runs off crying. */
  private disarmKid(t: Target): void {
    this.kidsDisarmed++;
    this.setKidState(t, "crying");
    t.speed = config.kidWalkSpeed * 3;
    t.facing = 1;
    this.floaters.push({ x: t.x, y: t.y - t.h - 44, text: "DISARMED!", color: "#7ae582", size: 24, life: 1.3, maxLife: 1.3 });
    this.events.push({ type: "kidCried" });
  }

  private updatePebbles(dt: number): void {
    const g = config.kidPebbleGravity;
    const keep: Pebble[] = [];
    for (const p of this.pebbles) {
      p.vy += g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += dt * 14;
      if (this.pebbleHits(p)) continue;
      if (p.y > GROUND_Y + 80 || p.x < -60 || p.x > this.width + 160 || p.y < -600) continue;
      keep.push(p);
    }
    this.pebbles = keep;
  }

  /** Returns true if the pebble is used up. */
  private pebbleHits(p: Pebble): boolean {
    // A falling poop shoots it down.
    for (let i = 0; i < this.poops.length; i++) {
      const poop = this.poops[i];
      const reach = poop.r + PEBBLE_R + 6;
      if ((poop.x - p.x) ** 2 + (poop.y - p.y) ** 2 >= reach * reach) continue;
      this.poops.splice(i, 1);
      this.shootDownPebble(p, poop);
      return true;
    }
    const b = this.bird;
    const playing = this.phase === "playing" && this.stage === "city" && !this.transition;
    if (playing) {
      const dist = Math.hypot(p.x - b.x, p.y - b.y);
      if (dist < this.hitRadius + PEBBLE_R) {
        this.bonk(p);
        return true;
      }
      p.closest = Math.min(p.closest, dist);
      // Dodged it by a whisker.
      if (!p.dodged && p.x < b.x - 30 && p.closest < this.hitRadius + PEBBLE_R + 28) {
        p.dodged = true;
        this.bonus += Math.round(config.targetPoints * 0.5);
        this.floaters.push({ x: b.x, y: b.y - 46, text: "CLOSE ONE!", color: "#bde0fe", size: 20, life: 0.9, maxLife: 0.9 });
      }
    }
    // Buildings and poles are cover: it pings off.
    const rects: Rect[] = [];
    for (const o of this.obstacles) if (Math.abs(o.x + o.w / 2 - p.x) < o.w) rects.push(...obstacleRects(o));
    for (const l of this.powerLines) for (let i = 0; i < l.poles; i++) rects.push(poleRect(l, i));
    for (const r of rects) {
      if (!circleRect(p.x, p.y, PEBBLE_R, r)) continue;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          x: p.x, y: p.y, vx: Math.cos(a) * 160 - p.vx * 0.2, vy: Math.sin(a) * 160,
          life: 0.25, maxLife: 0.25, size: 1.5 + Math.random() * 1.5, color: Math.random() < 0.5 ? "#fff3b0" : "#adb5bd",
          gravity: 500, world: false,
        });
      }
      this.events.push({ type: "ricochet" });
      return true;
    }
    // Sitting pigeons get knocked off their wire (no points for the kid).
    for (const l of this.powerLines) {
      for (const pg of l.pigeons) {
        if (pg.flyer) continue;
        const pos = pigeonPos(l, pg);
        const reach = PEBBLE_R + PIGEON_R;
        if ((pos.x - p.x) ** 2 + (pos.y - PIGEON_R - p.y) ** 2 >= reach * reach) continue;
        pg.flyer = { x: pos.x, y: pos.y, vx: 60 + Math.random() * 60, vy: -160 };
        this.floaters.push({ x: pos.x, y: pos.y - 40, text: "COO!", color: "#fff", size: 18, life: 0.8, maxLife: 0.8 });
        this.events.push({ type: "ricochet" });
        return true;
      }
    }
    return false;
  }

  private shootDownPebble(p: Pebble, poop: Poop): void {
    this.pebblesShot++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.targetsHit++;
    const points = Math.round(config.targetPoints * config.kidParryMultiplier * this.comboMultiplier);
    this.bonus += points;
    this.shake = Math.max(this.shake, 7);
    const x = (p.x + poop.x) / 2;
    const y = (p.y + poop.y) / 2;
    this.floaters.push({ x, y: y - 30, text: "INTERCEPTED!", color: "#7ae582", size: 26, life: 1.2, maxLife: 1.2 });
    this.floaters.push({ x, y: y - 2, text: `+${points}`, color: "#ffe14d", size: 22, life: 1.1, maxLife: 1.1 });
    // A mid-air burst of poop and gravel.
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 260;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 2 + Math.random() * 4,
        color: pick(["#6b3e14", "#8b5a2b", "#ffe14d", "#adb5bd"]), gravity: 800, world: true,
      });
    }
    this.events.push({ type: "pebbleShot", points, combo: this.combo });
  }

  /** A pebble got the bird: knocked down, stunned, charge and combo gone. */
  private bonk(p: Pebble): void {
    const b = this.bird;
    this.bonks++;
    this.charge = { charge: 0, fullHold: 0, stun: config.kidBonkStun, needsRelease: true };
    b.vy = Math.max(b.vy, config.kidKnockback);
    b.stretchV -= 10;
    this.shake = Math.max(this.shake, 12);
    if (this.combo > 1) {
      this.floaters.push({ x: b.x, y: b.y + 40, text: "combo lost", color: "#ffd6d6", size: 16, life: 0.8, maxLife: 0.8 });
    }
    this.combo = 0;
    this.message = { text: pick(BONK_MESSAGES), life: 1.6 };
    // Loose feathers and an impact burst.
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: b.x + (Math.random() - 0.5) * 20, y: b.y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 160 + p.vx * 0.15, vy: -60 - Math.random() * 120,
        life: 1 + Math.random() * 0.6, maxLife: 1.6, size: 3 + Math.random() * 3,
        color: Math.random() < 0.6 ? "#ffd166" : "#fff", gravity: 160, world: true,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220,
        life: 0.2, maxLife: 0.2, size: 2.5, color: "#fff", gravity: 0, world: false,
      });
    }
    const kid = p.from.kid;
    if (kid && kid.state !== "crying") {
      p.from.speed = 0;
      this.setKidState(p.from, "cheering");
    }
    this.events.push({ type: "bonk" });
  }

  // --- wedding -----------------------------------------------------------------

  /** The church is up within the next obstacle slot or so: keep paparazzi and kids out of its way. */
  private get weddingNext(): boolean {
    return this.weddingPlanned && this.stage === "city" && this.stageObstacles >= Math.round(config.weddingSlot) - 1;
  }

  /** The church takes this stage's next obstacle slot once nothing else is busy on the sidewalk. */
  private weddingDue(): boolean {
    return (
      this.weddingPlanned &&
      !this.wedding &&
      this.stageObstacles >= Math.round(config.weddingSlot) &&
      this.pendingTabloids.length === 0 &&
      !this.targets.some((t) => t.pap?.state === "watching" || kidArmed(t))
    );
  }

  /**
   * The church (an obstacle like any building) with the wedding party on the
   * sidewalk in front of it, all just off-screen. Returns the extra room the
   * next obstacle has to leave.
   */
  private spawnWedding(): number {
    this.weddingPlanned = false;
    const d = this.difficulty;
    const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
    const center = this.pickGapCenter(gap, 0, 50, 140 + 140 * d, CHURCH_MIN_H);
    const churchX = this.width + 330;
    const church: Obstacle = {
      x: churchX, w: CHURCH_W, gapTop: center - gap / 2, gapBottom: center + gap / 2,
      bottom: "church", top: null, color: "#f4ecdc", seed: Math.random() * 1000,
      passed: false, splats: [], gate: null, tabloid: null,
    };
    this.obstacles.push(church);

    const coupleX = churchX - 105;
    const person = (kind: TargetKind, dx: number, w: number, h: number, color: string, facing: 1 | -1): Target => ({
      x: coupleX + dx, y: GROUND_Y + 20, w, h, kind, speed: 0, color, seed: Math.random() * 1000,
      splats: [], hitFlash: 0, facing, pap: null, kid: null,
    });
    const colors = [...GUEST_COLORS].sort(() => Math.random() - 0.5);
    const wedding: Wedding = {
      phase: "arriving", t: 0, count: 0, outcome: null,
      tutorial: this.weddingsSeen++ === 0,
      names: pick(COUPLES), early: false, thrown: false, announced: false, flash: 0,
      groom: person("groom", -15, 28, 70, "#2b2d42", 1),
      bride: person("bride", 15, 32, 70, "#ffffff", -1),
      photographer: person("photographer", -165, 36, 60, "#495057", 1),
      guests: [
        person("guest", -62, 24, 54, colors[0], 1),
        person("guest", -92, 24, 54, colors[1], 1),
        person("guest", 58, 24, 54, colors[2], -1),
      ],
      church,
    };
    // The getaway car, parked in front of the church.
    const car: Target = {
      x: churchX + CHURCH_W / 2, y: GROUND_Y + 68, w: 92, h: 40, kind: "car", speed: 0, color: "#fdfcf7",
      seed: Math.random() * 1000, splats: [], hitFlash: 0, facing: -1, pap: null, kid: null,
    };
    const party = [wedding.photographer, ...wedding.guests, wedding.groom, wedding.bride, car];
    for (const t of party) t.wedding = wedding;
    this.targets.push(...party);
    this.wedding = wedding;
    return 350;
  }

  /** Debug: a wedding right now (city only). */
  spawnWeddingNow(): void {
    if (this.phase !== "playing" || this.transition || this.stage !== "city" || this.wedding) return;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width - 280 || o.gate);
    this.powerLines = this.powerLines.filter((l) => poleX(l, l.poles - 1) < this.width - 280);
    this.targets = this.targets.filter((t) => t.kind === "car" || t.x < this.width - 280);
    const extra = this.spawnWedding();
    this.nextObstacleAt = Math.max(this.nextObstacleAt, this.distance + extra + config.obstacleSpacingMin);
  }

  private setWeddingPhase(w: Wedding, phase: WeddingPhase): void {
    w.phase = phase;
    w.t = 0;
  }

  private updateWedding(dt: number): void {
    for (const d of this.doves) {
      d.vy = Math.max(-260, d.vy - 40 * dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
    this.doves = this.doves.filter((d) => d.y > -60 && d.x > -60 && d.x < this.width + 60);

    const w = this.wedding;
    if (!w) return;
    w.t += dt;
    w.flash = Math.max(0, w.flash - dt);
    const x = (w.bride.x + w.groom.x) / 2;
    if (x < -260) {
      this.wedding = null;
      return;
    }
    if (this.phase !== "playing") return;
    if (!w.announced && x < this.width - 20) {
      w.announced = true;
      this.events.push({ type: "weddingArrived" });
    }

    const lead = config.weddingKissLead;
    const rel = x - this.bird.x;
    switch (w.phase) {
      case "arriving":
      case "countdown": {
        if (rel <= lead) {
          this.setWeddingPhase(w, "kiss");
          w.count = 0;
          this.events.push({ type: "weddingKiss" });
          break;
        }
        // The photographer counts down the beats until the couple reaches the kiss point.
        if (this.speed <= 1) break;
        const n = Math.ceil((rel - lead) / this.speed / Math.max(0.05, config.weddingBeat));
        if (n <= 3 && (w.phase === "arriving" || n < w.count)) {
          if (w.phase === "arriving") this.setWeddingPhase(w, "countdown");
          w.count = Math.max(1, n);
          this.events.push({ type: "weddingBeat", count: w.count });
        }
        break;
      }
      case "kiss":
        if (w.t >= config.weddingKissTime) this.marry(w);
        break;
      case "after":
        // A furious bride takes a moment to wind up.
        if (!w.thrown && w.t >= (w.outcome === "ruined" ? WEDDING_WINDUP : 0.45)) this.throwBouquet(w);
        break;
    }
  }

  /** A poop on a member of the wedding party: returns the points multiplier, and whether it ruined the kiss. */
  private weddingHit(t: Target, w: Wedding): { mult: number; ruin: boolean } {
    if (t.kind === "bride" || t.kind === "groom") {
      if (w.phase === "kiss" && !w.outcome) return { mult: config.weddingKissMultiplier, ruin: true };
      if (w.phase === "arriving" || w.phase === "countdown") {
        w.early = true;
        this.floaters.push({ x: t.x, y: t.y - t.h - 50, text: pick(EARLY_MESSAGES), color: "#ffd6e0", size: 20, life: 1.1, maxLife: 1.1 });
      }
      return { mult: config.weddingCoupleMultiplier, ruin: false };
    }
    if (t.kind === "photographer") {
      if (!w.outcome) {
        this.floaters.push({ x: t.x, y: t.y - t.h - 50, text: "LENS SMUDGED!", color: "#7ae582", size: 20, life: 1.2, maxLife: 1.2 });
      }
      return { mult: 2, ruin: false };
    }
    return { mult: t.kind === "car" ? 1 : 1.5, ruin: false };
  }

  /** Splatted mid-kiss: the photographer gets the shot of a lifetime. */
  private ruinWedding(w: Wedding, points: number): void {
    w.outcome = "ruined";
    this.setWeddingPhase(w, "after");
    this.weddingsRuined++;
    this.shake = Math.max(this.shake, 14);
    this.message = { text: pick(RUIN_MESSAGES), life: 2.2 };
    const x = (w.bride.x + w.groom.x) / 2;
    // The veil and the groom's top hat fly off.
    for (let i = 0; i < 18; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      const s = 120 + Math.random() * 220;
      this.particles.push({
        x, y: w.bride.y - w.bride.h * 0.8, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.7 + Math.random() * 0.5, maxLife: 1.2, size: 2 + Math.random() * 4,
        color: pick(["#ffffff", "#ffe5ec", "#ffb3c6", "#6b3e14"]), gravity: 500, world: true,
      });
    }
    this.events.push({ type: "weddingRuined", points });
    this.takeWeddingPhoto(w);
  }

  /** The kiss went through: they're married. Confetti, doves, and the photo. */
  private marry(w: Wedding): void {
    w.outcome = "married";
    this.setWeddingPhase(w, "after");
    const x = (w.bride.x + w.groom.x) / 2;
    const y = w.bride.y - w.bride.h;
    this.floaters.push({ x, y: y - 60, text: "♥ JUST MARRIED ♥", color: "#ffb3c6", size: 24, life: 1.6, maxLife: 1.6 });
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 150 + Math.random() * 300;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 140, y: y + 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1 + Math.random() * 0.8, maxLife: 1.8, size: 2 + Math.random() * 3,
        color: pick(["#ff8fab", "#ffd166", "#a2d2ff", "#b9fbc0", "#ffffff", "#cdb4db"]), gravity: 260, world: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.doves.push({
        x: x + (Math.random() - 0.5) * 80, y: y - 20 - Math.random() * 30,
        vx: -30 + Math.random() * 110, vy: -110 - Math.random() * 90, seed: Math.random() * 1000,
      });
    }
    this.events.push({ type: "weddingMarried" });
    this.takeWeddingPhoto(w);
  }

  private takeWeddingPhoto(w: Wedding): void {
    const photoId = this.nextPhotoId++;
    const photo: WeddingPhoto = { photoId, ruined: w.outcome === "ruined", names: w.names };
    w.flash = 0.3;
    this.flash = Math.max(this.flash, 0.55);
    this.weddingPhotos.push(photo);
    this.polaroid = { photoId, life: 3.4, maxLife: 3.4, wedding: photo };
    this.events.push({ type: "weddingPhoto", photoId, ruined: photo.ruined });
  }

  /**
   * Married: the bride tosses her bouquet high, to come down through the
   * bird's column (catch it!). Ruined: she throws it at the bird, aimed like
   * a slingshot pebble.
   */
  private throwBouquet(w: Wedding): void {
    w.thrown = true;
    const angry = w.outcome === "ruined";
    const b = this.bird;
    const hand = bouquetHand(w.bride);
    const g = config.weddingBouquetGravity;
    let vx: number;
    let vy: number;
    if (angry) {
      const T = Math.max(0.2, config.weddingThrowTime);
      vx = (b.x - hand.x) / T;
      vy = (b.y - hand.y) / T - 0.5 * g * T;
    } else {
      // Peaks near the top of the screen, then falls through the bird's column around mid-height.
      const apex = 110;
      vy = -Math.sqrt(2 * g * Math.max(40, hand.y - apex));
      const catchY = 300;
      const T = (-vy + Math.sqrt(vy * vy + 2 * g * (catchY - hand.y))) / g;
      vx = (b.x - hand.x) / T;
    }
    this.bouquet = { x: hand.x, y: hand.y, vx, vy, rot: 0, angry };
    this.events.push({ type: "bouquetThrown", angry });
  }

  private updateBouquet(dt: number): void {
    const q = this.bouquet;
    if (!q) return;
    q.vy += config.weddingBouquetGravity * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.rot += dt * (q.angry ? 14 : 4);
    if (Math.random() < dt * 25) {
      this.particles.push({
        x: q.x, y: q.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        life: 0.5, maxLife: 0.5, size: 1.5 + Math.random() * 2,
        color: q.angry ? "#ff8fab" : pick(["#fff3b0", "#ffffff", "#ffb3c6"]), gravity: 120, world: false,
      });
    }
    if (q.y > GROUND_Y + 40 || q.x < -80 || q.x > this.width + 80 || q.y < -400) {
      this.bouquet = null;
      return;
    }
    if (this.phase !== "playing" || this.stage !== "city" || this.transition) return;
    const reach = this.hitRadius + BOUQUET_R;
    if ((q.x - this.bird.x) ** 2 + (q.y - this.bird.y) ** 2 >= reach * reach) return;
    this.bouquet = null;
    if (q.angry) this.bouquetHit(q);
    else this.catchBouquet(q);
  }

  private petalBurst(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 220;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.7 + Math.random() * 0.7, maxLife: 1.4, size: 2.5 + Math.random() * 3,
        color: pick(["#ff8fab", "#ffb3c6", "#ffffff", "#fb6f92", "#b9fbc0"]), gravity: 220, world: true,
      });
    }
  }

  private catchBouquet(q: Bouquet): void {
    this.bouquetsCaught++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = Math.round(config.targetPoints * config.weddingBouquetMultiplier * this.comboMultiplier);
    this.bonus += points;
    this.bird.stretchV += 8;
    this.floaters.push({ x: q.x, y: q.y - 46, text: "YOU'RE NEXT! \u{1F48D}", color: "#ffb3c6", size: 26, life: 1.4, maxLife: 1.4 });
    this.floaters.push({ x: q.x, y: q.y - 16, text: `+${points}`, color: "#ffe14d", size: 22, life: 1.1, maxLife: 1.1 });
    this.petalBurst(q.x, q.y, 24);
    this.events.push({ type: "bouquetCaught", points });
  }

  /** The furious bride's bouquet: a knock and a face full of petals, but no stun. */
  private bouquetHit(q: Bouquet): void {
    const b = this.bird;
    b.vy = Math.max(b.vy, config.weddingBouquetKnock);
    b.stretchV -= 10;
    this.shake = Math.max(this.shake, 10);
    this.message = { text: pick(BOUQUET_MESSAGES), life: 1.6 };
    this.petalBurst(q.x, q.y, 30);
    this.events.push({ type: "bouquetHit" });
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
    if (this.poopHitsPigeon(p)) return true;
    // Targets
    for (const t of this.targets) {
      const rect = targetRect(t);
      if (!circleRect(p.x, p.y, p.r, rect)) continue;
      t.splats.push({ dx: p.x - t.x, dy: Math.max(-t.h, p.y - t.y), r: p.r * 1.3, seed: Math.random() * 1000 });
      t.hitFlash = 0.3;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.targetsHit++;
      const camera = t.pap?.state === "watching";
      if (camera) this.smashCamera(t);
      const armed = kidArmed(t);
      if (armed) this.disarmKid(t);
      const wed = t.wedding ? this.weddingHit(t, t.wedding) : null;
      const kindMult = wed ? wed.mult : camera ? config.paparazziMultiplier : armed ? config.kidMultiplier : t.kind === "car" ? 1 : t.kind === "statue" ? 2 : 1.5;
      const points = Math.round(config.targetPoints * kindMult * this.comboMultiplier * (p.big ? 2 : 1));
      this.bonus += points;
      if (wed?.ruin && t.wedding) this.ruinWedding(t.wedding, points);
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
    this.zapFlash = Math.max(0, this.zapFlash - dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.polaroid) {
      this.polaroid.life -= dt;
      if (this.polaroid.life <= 0) this.polaroid = null;
    }
    if (this.message) {
      this.message.life -= dt;
      if (this.message.life <= 0) this.message = null;
    }
  }
}

// --- geometry helpers ----------------------------------------------------------

/** The roadside billboard: a board at the bottom of the gap on steel legs (see obstacleRects). */
export const BILLBOARD_W = 230;
export const BILLBOARD_H = 140;
const BILLBOARD_MIN_LEGS = 40;
/** The legs' frame covers the middle of the board's width; the board overhangs on both sides. */
export const BILLBOARD_LEGS_INSET = 0.16;

/** The church: a tower with a spire in the middle of a lower nave. */
export const CHURCH_W = 170;
export const CHURCH_TOWER_W = 56;
export const CHURCH_SPIRE_H = 66;
/** Room below the gap the church needs (spire, tower and nave). */
const CHURCH_MIN_H = 200;
/** Bouquet radius (drawn and for collisions). */
export const BOUQUET_R = 12;
/** Seconds the furious bride winds up before she throws. */
export const WEDDING_WINDUP = 0.9;

/** Key heights of a church obstacle: the spire tip is the gap's bottom edge. */
export function churchGeometry(o: Obstacle): { cx: number; towerTop: number; naveTop: number } {
  const towerTop = o.gapBottom + CHURCH_SPIRE_H;
  return { cx: o.x + o.w / 2, towerTop, naveTop: Math.max(towerTop + 40, GROUND_Y - 150) };
}

/** Where the bride holds her bouquet (the throw starts here). */
export function bouquetHand(bride: Target): { x: number; y: number } {
  return { x: bride.x + bride.facing * 10, y: bride.y - bride.h * 0.55 };
}

/** Collision rectangles for an obstacle, shared by rendering and physics. */
export function obstacleRects(o: Obstacle): Rect[] {
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
  // Bottom part rises from the ground to the gap (for a billboard: just the board, legs below).
  const billboard = o.bottom === "billboard";
  rects.push({ x: o.x, y: o.gapBottom, w: o.w, h: billboard ? BILLBOARD_H : GROUND_Y - o.gapBottom });
  // A gate's top hangs down to the gap.
  if (o.top) rects.push({ x: o.x - 6, y: 0, w: o.w + 12, h: o.gapTop });
  if (billboard) {
    const inset = o.w * BILLBOARD_LEGS_INSET;
    const legsTop = o.gapBottom + BILLBOARD_H;
    rects.push({ x: o.x + inset, y: legsTop, w: o.w - inset * 2, h: GROUND_Y - legsTop });
  }
  return rects;
}

export function poleX(l: PowerLine, i: number): number {
  return l.x + i * l.span;
}

/** A pole's collision rectangle (also its drawn trunk). */
export function poleRect(l: PowerLine, i: number): Rect {
  return { x: poleX(l, i) - 6, y: l.topY, w: 12, h: GROUND_Y - l.topY };
}

/** Height and slope of wire `w` at screen x, or null outside the line. Spans sag as parabolas. */
export function wireAt(l: PowerLine, w: number, x: number): { y: number; slope: number } | null {
  const rel = x - l.x;
  const last = l.poles - 1;
  if (rel < 0 || rel > l.span * last) return null;
  const s = Math.min(last - 1, Math.floor(rel / l.span));
  const t = (rel - s * l.span) / l.span;
  const wire = l.wires[w];
  const sag = wire.sags[s];
  return { y: wire.y + 4 * sag * t * (1 - t), slope: (4 * sag * (1 - 2 * t)) / l.span };
}

/** Where a sitting pigeon's feet touch its wire. */
export function pigeonPos(l: PowerLine, p: Pigeon): { x: number; y: number } {
  const wire = l.wires[p.wire];
  return { x: l.x + (p.span + p.t) * l.span, y: wire.y + 4 * wire.sags[p.span] * p.t * (1 - p.t) };
}

/** Where a kid's slingshot pouch sits (the pebble's launch point). */
export function slingshotPos(t: Target): { x: number; y: number } {
  return { x: t.x + t.facing * 17, y: t.y - t.h * 0.64 };
}

/** True while a kid can still shoot (not crying, taunting or out of shots). */
export function kidArmed(t: Target): boolean {
  const k = t.kid;
  return !!k && (k.state === "walking" || k.state === "aiming" || (k.state === "reloading" && k.shots > 0));
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
