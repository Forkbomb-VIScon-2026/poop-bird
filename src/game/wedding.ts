// Once per city stage (or so) there's a wedding: a church, a couple on the
// sidewalk in front of it, guests and a photographer who counts down
// "3… 2… 1… KISS!". Splat the couple mid-kiss and the wedding is ruined (a
// jackpot), and the photo of that moment becomes the official wedding photo.
// Miss and they're married: confetti, doves, and the bride tosses her bouquet.
// Ruin it and she throws the bouquet at you instead.

import { config, ramp } from "../config";
import { pick } from "../random";
import { burst } from "./effects";
import type { Game } from "./game";
import { kidArmed } from "./kids";
import { pickGapCenter, type Obstacle } from "./obstacles";
import { makeTarget, type Target, type TargetKind } from "./street";
import { FAR_LANE_Y } from "./traffic";
import { GROUND_Y } from "./world";

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

/** The couple stands this far left of the church. */
const WEDDING_COUPLE_DX = 105;

/**
 * Screen x of the couple's centre. Derived from the church, which stays in
 * play until it's off-screen, while the party members get culled earlier.
 */
export function weddingX(w: Wedding): number {
  return w.church.x - WEDDING_COUPLE_DX;
}

/** Where the bride holds her bouquet (the throw starts here). */
export function bouquetHand(bride: Target): { x: number; y: number } {
  return { x: bride.x + bride.facing * 10, y: bride.y - bride.h * 0.55 };
}

/**
 * The wedding is still to come (the couple hasn't passed the bird yet):
 * paparazzi, kids and pedestrians keep out of its way. Once it's over
 * they're back, even while the church is still on screen.
 */
export function weddingAhead(g: Game): boolean {
  return g.wedding !== null && g.wedding.phase !== "after";
}

/** The church takes g stage's next obstacle slot once nothing else is busy on the sidewalk. */
export function weddingDue(g: Game): boolean {
  return (
    g.weddingPlanned &&
    !g.wedding &&
    g.stageObstacles >= Math.round(config.weddingSlot) &&
    g.pendingTabloids.length === 0 &&
    !g.targets.some((t) => t.pap?.state === "watching" || kidArmed(t))
  );
}

/**
 * The church (an obstacle like any building) with the wedding party on the
 * sidewalk in front of it, all just off-screen. Returns the extra room the
 * next obstacle has to leave.
 */
export function spawnWedding(g: Game): number {
  g.weddingPlanned = false;
  const d = g.difficulty;
  const gap = ramp(config.obstacleGap, config.obstacleGapMin, d);
  const center = pickGapCenter(g, gap, 0, 50, 140 + 140 * d, CHURCH_MIN_H);
  const churchX = g.width + 330;
  const church: Obstacle = {
    x: churchX, w: CHURCH_W, gapTop: center - gap / 2, gapBottom: center + gap / 2,
    bottom: "church", color: "#f4ecdc", seed: Math.random() * 1000,
    passed: false, splats: [], tabloid: null, anchor: false, drop: null,
  };
  g.obstacles.push(church);

  const coupleX = churchX - WEDDING_COUPLE_DX;
  const person = (kind: TargetKind, dx: number, w: number, h: number, color: string, facing: 1 | -1): Target =>
    makeTarget({ x: coupleX + dx, y: GROUND_Y + 20, w, h, kind, speed: 0, color, seed: Math.random() * 1000, facing });
  const colors = [...GUEST_COLORS].sort(() => Math.random() - 0.5);
  const wedding: Wedding = {
    phase: "arriving", t: 0, count: 0, outcome: null,
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
  const car = makeTarget({
    x: churchX + CHURCH_W / 2, y: FAR_LANE_Y, w: 92, h: 40, kind: "car", speed: 0, cruise: 0, model: 0, color: "#fdfcf7",
    seed: Math.random() * 1000, facing: -1,
  });
  const party = [wedding.photographer, ...wedding.guests, wedding.groom, wedding.bride, car];
  for (const t of party) t.wedding = wedding;
  g.targets.push(...party);
  g.wedding = wedding;
  return 350;
}

function setWeddingPhase(w: Wedding, phase: WeddingPhase): void {
  w.phase = phase;
  w.t = 0;
}

export function updateWedding(g: Game, dt: number): void {
  for (const d of g.doves) {
    d.vy = Math.max(-260, d.vy - 40 * dt);
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }
  g.doves = g.doves.filter((d) => d.y > -60 && d.x > -60 && d.x < g.width + 60);

  const w = g.wedding;
  if (!w) return;
  w.t += dt;
  w.flash = Math.max(0, w.flash - dt);
  // Over once the church has scrolled off (its party members get culled before that).
  if (w.church.x + w.church.w < -40) {
    g.wedding = null;
    return;
  }
  const x = weddingX(w);
  if (g.phase !== "playing") return;
  if (!w.announced && x < g.width - 20) {
    w.announced = true;
    g.events.push({ type: "weddingArrived" });
  }

  const lead = config.weddingKissLead;
  const rel = x - g.bird.x;
  switch (w.phase) {
    case "arriving":
    case "countdown": {
      if (rel <= lead) {
        setWeddingPhase(w, "kiss");
        w.count = 0;
        g.events.push({ type: "weddingKiss" });
        break;
      }
      // The photographer counts down the beats until the couple reaches the kiss point.
      if (g.speed <= 1) break;
      const n = Math.ceil((rel - lead) / g.speed / Math.max(0.05, config.weddingBeat));
      if (n <= 3 && (w.phase === "arriving" || n < w.count)) {
        if (w.phase === "arriving") setWeddingPhase(w, "countdown");
        w.count = Math.max(1, n);
        g.events.push({ type: "weddingBeat", count: w.count });
      }
      break;
    }
    case "kiss":
      if (w.t >= config.weddingKissTime) marry(g, w);
      break;
    case "after":
      // A furious bride takes a moment to wind up.
      if (!w.thrown && w.t >= (w.outcome === "ruined" ? WEDDING_WINDUP : 0.45)) throwBouquet(g, w);
      break;
  }
}

/** A poop on a member of the wedding party: returns the points multiplier, and whether it ruined the kiss. */
export function weddingHit(g: Game, t: Target, w: Wedding): { mult: number; ruin: boolean } {
  if (t.kind === "bride" || t.kind === "groom") {
    if (w.phase === "kiss" && !w.outcome) return { mult: config.weddingKissMultiplier, ruin: true };
    if (w.phase === "arriving" || w.phase === "countdown") {
      w.early = true;
      g.floater(t.x, t.y - t.h - 50, pick(EARLY_MESSAGES), "#ffd6e0", 20, 1.1);
    }
    return { mult: config.weddingCoupleMultiplier, ruin: false };
  }
  if (t.kind === "photographer") {
    if (!w.outcome) {
      g.floater(t.x, t.y - t.h - 50, "LENS SMUDGED!", "#7ae582", 20, 1.2);
    }
    return { mult: 2, ruin: false };
  }
  return { mult: t.kind === "car" ? 1 : 1.5, ruin: false };
}

/** Splatted mid-kiss: the photographer gets the shot of a lifetime. */
export function ruinWedding(g: Game, w: Wedding, points: number): void {
  w.outcome = "ruined";
  setWeddingPhase(w, "after");
  g.weddingsRuined++;
  g.shakeAtLeast(14);
  g.say(RUIN_MESSAGES);
  const x = weddingX(w);
  // The veil and the groom's top hat fly off.
  burst(g, x, w.bride.y - w.bride.h * 0.8, 18, {
    angle: [-Math.PI / 2 - 1, -Math.PI / 2 + 1], speed: [120, 340], life: [0.7, 1.2], maxLife: 1.2, size: [2, 6],
    color: ["#ffffff", "#ffe5ec", "#ffb3c6", "#6b3e14"], gravity: 500,
  });
  g.events.push({ type: "weddingRuined", points });
  takeWeddingPhoto(g, w);
}

/** The kiss went through: they're married. Confetti, doves, and the photo. */
function marry(g: Game, w: Wedding): void {
  w.outcome = "married";
  setWeddingPhase(w, "after");
  const x = weddingX(w);
  const y = w.bride.y - w.bride.h;
  g.floater(x, y - 60, "♥ JUST MARRIED ♥", "#ffb3c6", 24, 1.6);
  // Confetti.
  burst(g, x, y + 20, 70, {
    angle: [-Math.PI / 2 - 1.2, -Math.PI / 2 + 1.2], speed: [150, 450], spread: 140, life: [1, 1.8], maxLife: 1.8, size: [2, 5],
    color: ["#ff8fab", "#ffd166", "#a2d2ff", "#b9fbc0", "#ffffff", "#cdb4db"], gravity: 260,
  });
  for (let i = 0; i < 6; i++) {
    g.doves.push({
      x: x + (Math.random() - 0.5) * 80, y: y - 20 - Math.random() * 30,
      vx: -30 + Math.random() * 110, vy: -110 - Math.random() * 90, seed: Math.random() * 1000,
    });
  }
  g.events.push({ type: "weddingMarried" });
  takeWeddingPhoto(g, w);
}

function takeWeddingPhoto(g: Game, w: Wedding): void {
  const photoId = g.newPhotoId();
  const photo: WeddingPhoto = { photoId, ruined: w.outcome === "ruined", names: w.names };
  w.flash = 0.3;
  g.flash = Math.max(g.flash, 0.55);
  g.weddingPhotos.push(photo);
  g.polaroid = { photoId, life: 3.4, maxLife: 3.4, wedding: photo };
  g.events.push({ type: "weddingPhoto", photoId, ruined: photo.ruined });
}

/**
 * Married: the bride tosses her bouquet high, to come down through the
 * bird's column (catch it!). Ruined: she throws it at the bird, aimed like
 * a slingshot pebble.
 */
function throwBouquet(g: Game, w: Wedding): void {
  w.thrown = true;
  const angry = w.outcome === "ruined";
  const b = g.bird;
  const hand = bouquetHand(w.bride);
  const grav = config.weddingBouquetGravity;
  let vx: number;
  let vy: number;
  if (angry) {
    const T = Math.max(0.2, config.weddingThrowTime);
    vx = (b.x - hand.x) / T;
    vy = (b.y - hand.y) / T - 0.5 * grav * T;
  } else {
    // Peaks near the top of the screen, then falls through the bird's column around mid-height.
    const apex = 110;
    vy = -Math.sqrt(2 * grav * Math.max(40, hand.y - apex));
    const catchY = 300;
    const T = (-vy + Math.sqrt(vy * vy + 2 * grav * (catchY - hand.y))) / grav;
    vx = (b.x - hand.x) / T;
  }
  g.bouquet = { x: hand.x, y: hand.y, vx, vy, rot: 0, angry };
  g.events.push({ type: "bouquetThrown", angry });
}

export function updateBouquet(g: Game, dt: number): void {
  const q = g.bouquet;
  if (!q) return;
  q.vy += config.weddingBouquetGravity * dt;
  q.x += q.vx * dt;
  q.y += q.vy * dt;
  q.rot += dt * (q.angry ? 14 : 4);
  // A trail of sparkles (or angry pink).
  if (Math.random() < dt * 25) {
    burst(g, q.x, q.y, 1, {
      vx: [-20, 20], vy: [-20, 20], life: 0.5, maxLife: 0.5, size: [1.5, 3.5],
      color: q.angry ? "#ff8fab" : ["#fff3b0", "#ffffff", "#ffb3c6"], gravity: 120, world: false,
    });
  }
  if (q.y > GROUND_Y + 40 || q.x < -80 || q.x > g.width + 80 || q.y < -400) {
    g.bouquet = null;
    return;
  }
  if (g.phase !== "playing" || g.stage !== "city" || g.transition) return;
  const reach = g.hitRadius + BOUQUET_R;
  if ((q.x - g.bird.x) ** 2 + (q.y - g.bird.y) ** 2 >= reach * reach) return;
  g.bouquet = null;
  if (q.angry) bouquetHit(g, q);
  else catchBouquet(g, q);
}

function petalBurst(g: Game, x: number, y: number, n: number): void {
  burst(g, x, y, n, {
    speed: [60, 280], lift: -40, life: [0.7, 1.4], maxLife: 1.4, size: [2.5, 5.5],
    color: ["#ff8fab", "#ffb3c6", "#ffffff", "#fb6f92", "#b9fbc0"], gravity: 220,
  });
}

function catchBouquet(g: Game, q: Bouquet): void {
  g.bouquetsCaught++;
  const points = g.scoreHit(config.weddingBouquetMultiplier, 1, false);
  g.bird.stretchV += 8;
  g.floater(q.x, q.y - 46, "YOU'RE NEXT! \u{1F48D}", "#ffb3c6", 26, 1.4);
  g.floater(q.x, q.y - 16, `+${points}`, "#ffe14d", 22, 1.1);
  petalBurst(g, q.x, q.y, 24);
  g.events.push({ type: "bouquetCaught", points });
}

/** The furious bride's bouquet: a knock and a face full of petals, but no stun. */
function bouquetHit(g: Game, q: Bouquet): void {
  const b = g.bird;
  b.vy = Math.max(b.vy, config.weddingBouquetKnock);
  b.stretchV -= 10;
  g.shakeAtLeast(10);
  g.say(BOUQUET_MESSAGES, 1.6);
  petalBurst(g, q.x, q.y, 30);
  g.events.push({ type: "bouquetHit" });
}
