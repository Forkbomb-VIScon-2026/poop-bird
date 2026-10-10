// Canvas rendering. Simple shapes, chunky outlines, no image assets.

import { initialChargeState } from "./charge";
import { config } from "./config";
import {
  BIRD_RADIUS,
  GROUND_Y,
  SURFACE_Y,
  BILLBOARD_H,
  BILLBOARD_LEGS_INSET,
  BOUQUET_R,
  CHURCH_SPIRE_H,
  CHURCH_TOWER_W,
  WEDDING_WINDUP,
  churchGeometry,
  weddingX,
  OCEAN_DEPTH,
  VIEW_H,
  WATER_Y,
  PEBBLE_R,
  BALLOON_RX,
  BALLOON_RY,
  basketRect,
  obstacleRects,
  pigeonPos,
  poleRect,
  poleX,
  slingshotPos,
  type Balloon,
  type Game,
  type Jelly,
  type Obstacle,
  type Pebble,
  type DroneWreck,
  type Pigeon,
  type PowerLine,
  type Splat,
  type Tabloid,
  type Target,
  type Bouquet,
  type Dove,
  type Wedding,
  type WeddingPhoto,
} from "./game";

/** A captured photo: a face crop from the webcam, or a crop of the game canvas around the bird. */
export type Photo = HTMLCanvasElement;

/** What drawBird reads, so a bird can be drawn outside the game (the strain check's meter). */
type BirdLook = Pick<Game, "bird" | "charge" | "stunned" | "phase" | "overstrainProgress" | "zapped" | "zapFlash" | "time">;

const OUTLINE = "#2b2d42";
/** Pigeons are drawn at this scale (their hit radius is PIGEON_R in game.ts). */
const PIGEON_SCALE = 1.35;
/** Slingshot kids are drawn at this scale (their hitbox is the target's w × h). */
const KID_SCALE = 1.35;
const POOP = "#7a4a1e";
const POOP_DARK = "#5c3310";

/** Deterministic pseudo-random in [0,1) from a seed. */
function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// --- background layers (parallax) ---------------------------------------------

interface SkylineBuilding {
  x: number;
  w: number;
  h: number;
  roof: number;
}

function makeSkyline(seed: number, length: number, minH: number, maxH: number): SkylineBuilding[] {
  const out: SkylineBuilding[] = [];
  let x = 0;
  let i = 0;
  while (x < length) {
    const w = 40 + rnd(seed + i * 3.1) * 80;
    out.push({ x, w, h: minH + rnd(seed + i * 7.7) * (maxH - minH), roof: Math.floor(rnd(seed + i * 1.3) * 4) });
    x += w + rnd(seed + i * 5.3) * 12;
    i++;
  }
  return out;
}

const SKYLINE_LEN = 2400;
const FAR_SKYLINE = makeSkyline(1, SKYLINE_LEN, 90, 240);
const MID_SKYLINE = makeSkyline(2, SKYLINE_LEN, 60, 170);
const CLOUDS = Array.from({ length: 9 }, (_, i) => ({
  x: rnd(i + 10) * 2000,
  y: 30 + rnd(i + 20) * 200,
  s: 0.6 + rnd(i + 30) * 0.9,
}));
// Ocean parallax: far rock silhouettes and mid-distance kelp.
const FAR_ROCKS = makeSkyline(3, SKYLINE_LEN, 50, 190);
const KELP = Array.from({ length: 26 }, (_, i) => ({
  x: rnd(i + 90) * SKYLINE_LEN,
  h: 90 + rnd(i + 91) * 200,
  phase: rnd(i + 92) * 6,
}));

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  width = 1000;
  /** Background scroll offset, accumulates even between runs. */
  private bgOffset = 0;
  /** The paparazzi's photos of this run, by Game photo id. main.ts fills it on "photo" events. */
  readonly photos = new Map<number, Photo>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
  }

  /** Keyboard-mode photo: a close-up of the bird, always caught mid-strain (that's the joke), without HUD. */
  captureBird(game: Game): Photo | null {
    const out = document.createElement("canvas");
    out.width = 200;
    out.height = 200;
    const octx = out.getContext("2d");
    if (!octx) return null;
    const g = octx.createLinearGradient(0, 0, 0, 200);
    g.addColorStop(0, "#5ec8f2");
    g.addColorStop(1, "#bde8f7");
    octx.fillStyle = g;
    octx.fillRect(0, 0, 200, 200);
    octx.fillStyle = "#8fb3c6";
    for (let i = 0; i < 5; i++) octx.fillRect(i * 44 - 6, 120 + ((i * 37) % 40), 36, 100);
    const zoom = 2.1;
    octx.setTransform(zoom, 0, 0, zoom, 100 - game.bird.x * zoom, 105 - game.bird.y * zoom);
    const main = this.ctx;
    const charge = game.charge;
    const relief = game.bird.relief;
    this.ctx = octx;
    game.charge = { ...charge, charge: Math.max(charge.charge, 0.9) };
    game.bird.relief = 0;
    try {
      this.drawBird(game);
    } finally {
      this.ctx = main;
      game.charge = charge;
      game.bird.relief = relief;
    }
    return out;
  }

  /**
   * The strain check's bird, perched on the live meter at `at` (0..1 across
   * the canvas) and charged by the live strain, so the player sees that
   * straining is what drives the bird before the run starts. `relief` shows
   * its relieved face (after letting go of a strain).
   */
  drawMeterBird(canvas: HTMLCanvasElement, at: number, strain: number, relief: boolean, time: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w <= 0 || h <= 0) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const octx = canvas.getContext("2d");
    if (!octx) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);
    const charge = Math.max(0, Math.min(1, strain));
    // Room for the fully puffed bird plus its sweat drops.
    const s = h / (BIRD_RADIUS * 3.2);
    const half = BIRD_RADIUS * 1.6 * s;
    // Over the fill's end, but whole on the canvas near either end of the bar.
    const x = Math.max(half, Math.min(w - half, at * w));
    // The bird puffs up around its centre (drawBird), so lift it as it grows: its belly
    // (plus the outline) stays resting on the bottom edge, never sinking into the bar.
    const belly = BIRD_RADIUS * (1 + charge * 0.28) + 2;
    octx.setTransform(s, 0, 0, s, x, h - belly * s);
    const look: BirdLook = {
      bird: { x: 0, y: 0, vy: 0, rot: Math.sin(time * 2.5) * 0.06, stretch: 1, stretchV: 0, relief: relief ? 1 : 0, flap: 0 },
      charge: { ...initialChargeState(), charge },
      stunned: false,
      phase: "playing",
      overstrainProgress: 0,
      zapped: false,
      zapFlash: 0,
      time,
    };
    const main = this.ctx;
    this.ctx = octx;
    try {
      this.drawBird(look);
    } finally {
      this.ctx = main;
    }
  }

  /** Fits the canvas to its CSS size. Returns the logical width (height is always VIEW_H). */
  resize(): number {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = this.canvas.height / VIEW_H;
    this.width = this.canvas.width / this.scale;
    return this.width;
  }

  draw(game: Game, dt: number): void {
    const ctx = this.ctx;
    this.bgOffset += game.speed * dt;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (game.shake > 0) {
      const s = game.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    const ocean = game.stage === "ocean";
    // The camera looks at the city, the sea below it, or (diving, leaping) both.
    ctx.save();
    ctx.translate(0, -game.cameraY);
    this.drawScenery(game);
    // Everything else lives in the current stage's coordinates.
    ctx.translate(0, game.stageOffset);
    for (const d of game.decals) drawSplat(ctx, d.x, d.y, d.r, d.seed, 0.45);
    if (game.wedding) drawWeddingBackdrop(ctx, game.wedding, game.time);
    for (const o of game.obstacles) this.drawObstacle(o, game.time);
    for (const l of game.powerLines) this.drawPowerLine(l, game.time);
    // People stand on the sidewalk, in front of the buildings and poles.
    for (const t of game.targets) if (t.kind !== "car" && !t.chute) this.drawTarget(t, game.time);
    for (const b of game.balloons) this.drawBalloon(b, game.time);
    // In the air, in front of the buildings.
    for (const t of game.targets) if (t.chute) this.drawTarget(t, game.time);
    for (const t of game.targets) if (t.kind === "car") this.drawTarget(t, game.time);
    // Over the buildings, so a paparazzo's timer is never hidden.
    for (const t of game.targets) if (t.pap) this.drawPaparazzoTimer(t, game);
    for (const d of game.doves) drawDove(ctx, d, game.time);
    for (const j of game.jellies) this.drawJelly(j, game.time, game.spike.spiked);
    this.drawPoops(game);
    for (const p of game.pebbles) drawPebble(this.ctx, p);
    // During a transition the splash and bubbles fly over the creature.
    if (!game.transition) this.drawParticles(game);
    if (ocean) this.drawFish(game);
    else this.drawBird(game);
    // Over the bird, so the crosshair reads on it.
    if (!game.transition) for (const t of game.targets) if (t.kid) this.drawKidAim(t, game);
    if (game.bouquet) drawBouquet(ctx, game.bouquet);
    if (game.wedding && !game.transition) this.drawWeddingCue(game.wedding, game);
    if (game.transition) {
      this.drawParticles(game);
      // A held dive (tutorial, puff calibration) shows the meter, so the player sees their puff.
      if (ocean && game.holdTransition) this.drawPuffMeter(game);
    } else if (game.phase === "playing") {
      if (ocean) this.drawPuffMeter(game);
      else this.drawChargeMeter(game);
    }
    this.drawFloaters(game);
    ctx.restore();
    this.drawScreenSplats(game);
    this.drawPolaroid(game);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, game.flash * 1.2)})`;
      ctx.fillRect(-40, -40, this.width + 80, VIEW_H + 80);
    }
    // Electrocution flash: the whole screen flickers.
    if (game.zapFlash > 0 && Math.floor(game.time * 24) % 2 === 0) {
      ctx.fillStyle = `rgba(220,245,255,${Math.min(0.55, game.zapFlash)})`;
      ctx.fillRect(-20, -20, this.width + 40, VIEW_H + 40);
    }
  }

  // --- scenery ----------------------------------------------------------------

  /**
   * The backdrop in city coordinates (the caller has applied the camera). The
   * sea is drawn OCEAN_DEPTH lower, under the city: in the ocean, while the
   * camera pans between them, and under the harbour where the street ends.
   * The city's sky is cut off at the water level, so the two meet at the
   * surface.
   */
  private drawScenery(game: Game): void {
    const ctx = this.ctx;
    const cam = game.cameraY;
    const cityVisible = cam < OCEAN_DEPTH - 0.5;
    const seaVisible = game.stage === "ocean" || !!game.transition || !!game.shore;
    if (seaVisible) {
      ctx.save();
      ctx.translate(0, OCEAN_DEPTH);
      this.drawOcean(game);
      ctx.restore();
    }
    if (cityVisible) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-40, -1000, this.width + 80, WATER_Y + 1000);
      ctx.clip();
      this.drawSky(game);
      ctx.restore();
    }
    if (game.shore) this.drawQuay(game);
    if (cityVisible) {
      this.drawGround(game);
      if (game.shore) this.drawHarbourSurface(game);
    }
  }

  /** The x range of the quay (land) and of the harbour water, in screen x. Without a shore, it's all land. */
  private landRange(game: Game): { land: [number, number]; water: [number, number] | null } {
    const s = game.shore;
    const lo = -40;
    const hi = this.width + 40;
    if (!s) return { land: [lo, hi], water: null };
    const x = Math.min(hi, Math.max(lo, s.x));
    return s.kind === "dive" ? { land: [lo, x], water: [x, hi] } : { land: [x, hi], water: [lo, x] };
  }

  /**
   * The quay: a stone block under the street that ends in a wall at the
   * shore, down to the sea floor. Above the water it's dry stone with a
   * bollard at the edge; below, it's tinted blue-green with a weed line.
   */
  private drawQuay(game: Game): void {
    const ctx = this.ctx;
    const s = game.shore!;
    const { land } = this.landRange(game);
    const [x0, x1] = land;
    if (x1 - x0 < 1) return;
    const bottom = OCEAN_DEPTH + VIEW_H + 40;
    const face = s.x;
    const dir = s.kind === "dive" ? 1 : -1; // the wall faces right (dive) or left (exit)

    // Dry stone above the water, wet stone below.
    ctx.fillStyle = "#a59f92";
    ctx.fillRect(x0, GROUND_Y, x1 - x0, WATER_Y - GROUND_Y);
    const wet = ctx.createLinearGradient(0, WATER_Y, 0, bottom);
    wet.addColorStop(0, "#5f7f86");
    wet.addColorStop(0.25, "#3f6673");
    wet.addColorStop(1, "#1d4256");
    ctx.fillStyle = wet;
    ctx.fillRect(x0, WATER_Y, x1 - x0, bottom - WATER_Y);

    // Stone blocks, in offset courses, anchored to the shore so they scroll with it.
    ctx.strokeStyle = "rgba(43,45,66,0.35)";
    ctx.lineWidth = 2;
    const courseH = 30;
    const blockW = 56;
    const top = Math.max(GROUND_Y, game.cameraY - courseH);
    const end = Math.min(bottom, game.cameraY + VIEW_H + courseH);
    const firstRow = Math.floor((top - GROUND_Y) / courseH);
    for (let row = firstRow; GROUND_Y + row * courseH < end; row++) {
      const y = GROUND_Y + row * courseH;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      const shift = row % 2 ? blockW / 2 : 0;
      // Vertical joints, counted from the wall face inward.
      for (let k = 1; ; k++) {
        const jx = face - dir * (k * blockW - shift);
        if (jx < x0 - blockW || jx > x1 + blockW) break;
        if (jx > x0 && jx < x1) {
          ctx.moveTo(jx, y);
          ctx.lineTo(jx, y + courseH);
        }
      }
      ctx.stroke();
    }

    // Weed and slime along the water line.
    ctx.fillStyle = "#2f7d5b";
    ctx.beginPath();
    ctx.moveTo(x0, WATER_Y - 2);
    for (let x = x0; x <= x1; x += 8) {
      const seed = Math.floor((x - face) / 8);
      ctx.lineTo(x, WATER_Y + 6 + rnd(seed + 900) * 10);
    }
    ctx.lineTo(x1, WATER_Y - 2);
    ctx.closePath();
    ctx.fill();

    // The wall face, with a stone coping on top and a bollard at the edge.
    if (face > -40 && face < this.width + 40) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(face, GROUND_Y);
      ctx.lineTo(face, bottom);
      ctx.stroke();
      ctx.fillStyle = "#c9c3b4";
      ctx.fillRect(dir === 1 ? face - 26 : face, GROUND_Y - 2, 26, 8);
      ctx.strokeRect(dir === 1 ? face - 26 : face, GROUND_Y - 2, 26, 8);
      const bx = face - dir * 40;
      ctx.fillStyle = "#3d405b";
      ctx.beginPath();
      roundRect(ctx, bx - 8, GROUND_Y - 22, 16, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bx, GROUND_Y - 22, 11, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // A ladder down into the water.
      const lx = face + dir * 2;
      ctx.strokeStyle = "#6c757d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const rail of [0, 14]) {
        ctx.moveTo(lx + dir * rail, GROUND_Y + 4);
        ctx.lineTo(lx + dir * rail, WATER_Y + 70);
      }
      for (let y = GROUND_Y + 14; y < WATER_Y + 70; y += 14) {
        ctx.moveTo(lx, y);
        ctx.lineTo(lx + dir * 14, y);
      }
      ctx.stroke();
    }
  }

  /** The harbour seen from above: a rippling surface at WATER_Y over the water, the sea showing through below. */
  private drawHarbourSurface(game: Game): void {
    const ctx = this.ctx;
    const { water } = this.landRange(game);
    if (!water || water[1] - water[0] < 1) return;
    const [x0, x1] = water;
    const time = game.time;
    const wave = (x: number) => Math.sin(x * 0.035 + time * 2.4 + this.bgOffset * 0.035) * 2.5;
    // A light tint just under the surface, fading into the sea below.
    const g = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + 40);
    g.addColorStop(0, "rgba(202,240,248,0.7)");
    g.addColorStop(1, "rgba(202,240,248,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, WATER_Y, x1 - x0, 40);
    ctx.beginPath();
    ctx.moveTo(x0, WATER_Y + wave(x0));
    for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, WATER_Y + wave(x));
    ctx.lineTo(x1, WATER_Y + wave(x1));
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 4;
    ctx.stroke();
    // Glints drifting on the surface.
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 10; i++) {
      const span = this.width + 80;
      const gx = ((((rnd(i + 950) * span - this.bgOffset) % span) + span) % span) - 40;
      if (gx < x0 || gx > x1) continue;
      ctx.fillRect(gx, WATER_Y + 6 + rnd(i + 960) * 14, 10 + rnd(i + 970) * 14, 2);
    }
  }

  // --- sky & ground -----------------------------------------------------------

  private drawSky(game: Game): void {
    const ctx = this.ctx;
    const w = this.width + 40;
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, "#5ec8f2");
    g.addColorStop(0.7, "#bfeaf7");
    g.addColorStop(1, "#fde7c8");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w, GROUND_Y + 40);

    // Sun
    ctx.fillStyle = "#fff3b0";
    ctx.beginPath();
    ctx.arc(this.width - 140, 110, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,243,176,0.35)";
    ctx.beginPath();
    ctx.arc(this.width - 140, 110, 75 + Math.sin(game.time * 2) * 4, 0, Math.PI * 2);
    ctx.fill();

    // Clouds (slowest layer)
    const cloudOff = this.bgOffset * 0.08 + game.time * 6;
    for (const c of CLOUDS) {
      const span = 2000;
      const x = ((((c.x - cloudOff) % span) + span) % span) - 200;
      drawCloud(ctx, x, c.y, c.s);
    }

    this.drawSkyline(FAR_SKYLINE, this.bgOffset * 0.18, "#9cc5d9", "#b7d9e8");
    this.drawSkyline(MID_SKYLINE, this.bgOffset * 0.4, "#6f9bb3", "#8fb6c9");
  }

  private drawSkyline(list: SkylineBuilding[], offset: number, color: string, windowColor: string): void {
    const ctx = this.ctx;
    const off = ((offset % SKYLINE_LEN) + SKYLINE_LEN) % SKYLINE_LEN;
    ctx.fillStyle = color;
    for (let rep = 0; rep * SKYLINE_LEN - off < this.width + 100; rep++) {
      for (const b of list) {
        const x = b.x + rep * SKYLINE_LEN - off;
        if (x > this.width + 50 || x + b.w < -50) continue;
        const top = GROUND_Y - b.h;
        ctx.fillStyle = color;
        ctx.fillRect(x, top, b.w, b.h);
        if (b.roof === 1) {
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x + b.w / 2, top - 22);
          ctx.lineTo(x + b.w, top);
          ctx.fill();
        } else if (b.roof === 2) {
          ctx.fillRect(x + b.w / 2 - 2, top - 30, 4, 30);
        }
        ctx.fillStyle = windowColor;
        for (let wy = top + 12; wy < GROUND_Y - 14; wy += 22) {
          for (let wx = x + 8; wx < x + b.w - 12; wx += 16) ctx.fillRect(wx, wy, 7, 10);
        }
      }
    }
  }

  /** Sidewalk and road, only where there's land (up to the quay's edge). */
  private drawGround(game: Game): void {
    const ctx = this.ctx;
    const [x0, x1] = this.landRange(game).land;
    if (x1 - x0 < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, GROUND_Y - 10, x1 - x0, VIEW_H);
    ctx.clip();
    this.drawStreet();
    ctx.restore();
  }

  private drawStreet(): void {
    const ctx = this.ctx;
    const w = this.width + 40;
    // Sidewalk
    ctx.fillStyle = "#d9d4c7";
    ctx.fillRect(-20, GROUND_Y, w, 22);
    ctx.fillStyle = "#c2bcac";
    const off = this.bgOffset % 60;
    for (let x = -off; x < w; x += 60) ctx.fillRect(x, GROUND_Y, 3, 22);
    // Curb
    ctx.fillStyle = "#9e9a8f";
    ctx.fillRect(-20, GROUND_Y + 20, w, 5);
    // Road
    ctx.fillStyle = "#4a4e69";
    ctx.fillRect(-20, GROUND_Y + 25, w, VIEW_H - GROUND_Y);
    ctx.fillStyle = "#f2e9e4";
    const dash = this.bgOffset % 90;
    for (let x = -dash; x < w; x += 90) ctx.fillRect(x, GROUND_Y + 50, 46, 5);
    // Top edge line
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-20, GROUND_Y);
    ctx.lineTo(w, GROUND_Y);
    ctx.stroke();
  }

  // --- obstacles --------------------------------------------------------------

  private drawObstacle(o: Obstacle, time: number): void {
    if (o.bottom === "coral" || o.bottom === "rock") return this.drawSeaObstacle(o);
    if (o.bottom === "church") return drawChurch(this.ctx, o, time);
    const ctx = this.ctx;
    const [base] = obstacleRects(o);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // Bottom part
    if (o.bottom === "billboard") {
      this.drawBillboard(o, time);
    } else if (o.bottom === "chimney") {
      ctx.fillStyle = "#a44a3f";
      roundRect(ctx, base.x, base.y, base.w, base.h + 4, 4);
      ctx.fill();
      ctx.stroke();
      // Bricks
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 2;
      for (let y = base.y + 16, row = 0; y < GROUND_Y; y += 14, row++) {
        ctx.beginPath();
        ctx.moveTo(base.x + 3, y);
        ctx.lineTo(base.x + base.w - 3, y);
        ctx.stroke();
        for (let x = base.x + (row % 2 ? 10 : 22); x < base.x + base.w - 4; x += 24) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 14);
          ctx.stroke();
        }
      }
      // Cap
      ctx.fillStyle = "#6b2d26";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      roundRect(ctx, base.x - 6, base.y - 2, base.w + 12, 16, 3);
      ctx.fill();
      ctx.stroke();
      // Smoke puffs
      for (let i = 0; i < 3; i++) {
        const t = (time * 0.6 + i / 3) % 1;
        ctx.fillStyle = `rgba(230,230,230,${0.6 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(base.x + base.w / 2 - t * 30, base.y - 10 - t * 50, 8 + t * 12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = o.color;
      roundRect(ctx, base.x, base.y, base.w, base.h + 4, 5);
      ctx.fill();
      ctx.stroke();
      // Roof trim
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(base.x + 2, base.y + 2, base.w - 4, 8);
      // Windows
      const cols = Math.max(2, Math.floor((base.w - 16) / 22));
      const cw = (base.w - 16) / cols;
      for (let y = base.y + 20; y < GROUND_Y - 24; y += 30) {
        for (let c = 0; c < cols; c++) {
          const lit = rnd(o.seed + y * 0.37 + c * 3.1) > 0.45;
          ctx.fillStyle = lit ? "#ffe8a3" : "#3d405b";
          ctx.fillRect(base.x + 8 + c * cw + 3, y, cw - 6, 16);
        }
      }
      if (o.bottom === "tower") {
        // Antenna with blinking light on top of the tower roof.
        ctx.strokeStyle = OUTLINE;
        ctx.beginPath();
        ctx.moveTo(base.x + base.w / 2, base.y);
        ctx.lineTo(base.x + base.w / 2, base.y - 26);
        ctx.stroke();
        ctx.fillStyle = Math.sin(time * 6) > 0 ? "#ff4d4d" : "#7a1f1f";
        ctx.beginPath();
        ctx.arc(base.x + base.w / 2, base.y - 28, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Door at the bottom
      ctx.fillStyle = "#3d405b";
      ctx.fillRect(base.x + base.w / 2 - 10, GROUND_Y - 26, 20, 26);
    }

    for (const s of o.splats) drawSplat(ctx, o.x + s.dx, s.dy, s.r, s.seed, 1);
  }

  // --- power lines ------------------------------------------------------------

  private drawPowerLine(l: PowerLine, time: number): void {
    const ctx = this.ctx;
    const last = l.poles - 1;
    if (l.x > this.width + 60 || poleX(l, last) < -60) return;

    // Poles: wooden trunk, a cross-arm with an insulator per wire, a cap.
    for (let i = 0; i < l.poles; i++) {
      const r = poleRect(l, i);
      const px = poleX(l, i);
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = "#8b5e3c";
      ctx.fillRect(r.x, r.y, r.w, r.h + 4);
      ctx.strokeRect(r.x, r.y, r.w, r.h + 4);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 2;
      for (let y = r.y + 20; y < GROUND_Y - 10; y += 34 + rnd(l.seed + i + y) * 20) {
        ctx.beginPath();
        ctx.moveTo(r.x + 3, y);
        ctx.lineTo(r.x + 3, y + 14);
        ctx.stroke();
      }
      ctx.fillStyle = "#6f4a2f";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      roundRect(ctx, px - 9, l.topY - 6, 18, 8, 3);
      ctx.fill();
      ctx.stroke();
      for (const w of l.wires) {
        ctx.fillStyle = "#6f4a2f";
        ctx.fillRect(px - 20, w.y - 3, 40, 6);
        ctx.strokeRect(px - 20, w.y - 3, 40, 6);
        ctx.fillStyle = "#7ec8a9";
        for (const dx of [-15, 15]) {
          ctx.beginPath();
          ctx.ellipse(px + dx, w.y - 7, 4, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Wires: a parabola per span (a symmetric quadratic Bézier is exactly one).
    ctx.lineCap = "round";
    for (const w of l.wires) {
      for (let s = 0; s < last; s++) {
        const x0 = poleX(l, s);
        const x1 = x0 + l.span;
        ctx.beginPath();
        ctx.moveTo(x0, w.y);
        ctx.quadraticCurveTo((x0 + x1) / 2, w.y + 2 * w.sags[s], x1, w.y);
        ctx.strokeStyle = "#1b1b2a";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.lineCap = "butt";

    // Current running down the wires, so they read as live.
    l.wires.forEach((w, wi) => {
      const along = ((time * 0.45 + rnd(l.seed + wi) ) % 1) * last;
      const s = Math.min(last - 1, Math.floor(along));
      const t = along - s;
      const x = poleX(l, s) + t * l.span;
      const y = w.y + 4 * w.sags[s] * t * (1 - t);
      const flick = 0.6 + 0.4 * Math.sin(time * 40 + wi);
      ctx.fillStyle = `rgba(255,240,140,${0.35 * flick})`;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      drawStar(ctx, x, y, 5 + flick * 2, "#fff3b0");
    });

    for (const p of l.pigeons) this.drawPigeon(l, p, time);
  }

  /** Hot-air balloon: striped envelope, burner, ropes, wicker basket with passengers; after the pop a falling basket and rag. */
  private drawBalloon(b: Balloon, time: number): void {
    const ctx = this.ctx;
    if (b.rag) drawRag(ctx, b, time);
    if (b.x < -100 || b.x > this.width + 120) return;
    const cx = b.x;
    const cy = b.y;
    const mouthY = cy + BALLOON_RY;
    const basket = basketRect(b);
    ctx.strokeStyle = OUTLINE;
    ctx.lineCap = "round";

    if (!b.popped) {
      // Ropes from the envelope's mouth down to the basket.
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 14, mouthY - 2);
        ctx.lineTo(basket.x + basket.w / 2 + s * (basket.w / 2 - 3), basket.y);
        ctx.moveTo(cx + s * 6, mouthY);
        ctx.lineTo(cx + s * 10, basket.y);
        ctx.stroke();
      }
      // Burner frame and flame: a small pilot, or a roaring blast now and then.
      const by = basket.y - 22;
      const flick = Math.sin(time * 40 + b.seed) * 0.5 + 0.5;
      const flameH = b.burn > 0 ? 26 + Math.min(1, b.burn / 0.15) * 20 + flick * 8 : 7 + flick * 3;
      const glow = ctx.createRadialGradient(cx, by - flameH * 0.4, 1, cx, by - flameH * 0.4, flameH);
      glow.addColorStop(0, b.burn > 0 ? "rgba(255,220,120,0.55)" : "rgba(120,180,255,0.35)");
      glow.addColorStop(1, "rgba(255,200,100,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, by - flameH * 0.4, flameH, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.burn > 0 ? "#ff9f1c" : "#5aa9ff";
      flamePath(ctx, cx, by, b.burn > 0 ? 8 : 4, flameH);
      ctx.fill();
      ctx.fillStyle = b.burn > 0 ? "#fff3b0" : "#cfe8ff";
      flamePath(ctx, cx, by, b.burn > 0 ? 4 : 2, flameH * 0.6);
      ctx.fill();
      ctx.fillStyle = "#adb5bd";
      ctx.lineWidth = 2.5;
      roundRect(ctx, cx - 10, by, 20, 8, 2);
      ctx.fill();
      ctx.stroke();

      // Envelope: gores in two colours (nested ellipses clipped to the shape), a highlight, a skirt.
      ctx.save();
      envelopePath(ctx, cx, cy);
      ctx.clip();
      const [c1, c2] = b.colors;
      ctx.fillStyle = c1;
      ctx.fillRect(cx - BALLOON_RX - 2, cy - BALLOON_RY - 2, BALLOON_RX * 2 + 4, BALLOON_RY * 2 + 4);
      for (const [k, color] of [[0.66, c2], [0.33, c1]] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(cx, cy - BALLOON_RY * 0.1, BALLOON_RX * k, BALLOON_RY * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(cx - BALLOON_RX, cy + BALLOON_RY * 0.5, BALLOON_RX * 2, 7);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.ellipse(cx - BALLOON_RX * 0.45, cy - BALLOON_RY * 0.4, 10, 24, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 3;
      envelopePath(ctx, cx, cy);
      ctx.stroke();
      ctx.fillStyle = shadeHex(b.colors[0], -40);
      ctx.beginPath();
      ctx.moveTo(cx - 15, mouthY - 3);
      ctx.lineTo(cx + 15, mouthY - 3);
      ctx.lineTo(cx + 11, mouthY + 9);
      ctx.lineTo(cx - 11, mouthY + 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Passengers peeking over the rim; one of them waves.
      const n = b.passengers.length;
      b.passengers.forEach((p, i) => {
        const px = cx + (i - (n - 1) / 2) * 14;
        const hy = basket.y - 9 + Math.sin(time * 3 + p.seed) * 1.2;
        ctx.lineWidth = 2.5;
        ctx.fillStyle = p.color;
        roundRect(ctx, px - 6, hy + 4, 12, 12, 4);
        ctx.fill();
        ctx.stroke();
        if (i === n - 1) {
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(px + 5, hy + 6);
          ctx.lineTo(px + 12 + Math.sin(time * 9 + p.seed) * 4, hy - 8);
          ctx.stroke();
        }
        ctx.lineWidth = 2.5;
        ctx.fillStyle = "#f1c27d";
        ctx.beginPath();
        ctx.arc(px, hy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.seed % 2 > 1 ? "#3d405b" : "#6b4226";
        ctx.beginPath();
        ctx.arc(px, hy - 1.5, 6, Math.PI, Math.PI * 2);
        ctx.fill();
      });
    } else if (!b.landed) {
      // Limp ropes trailing above the falling basket.
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 20, basket.y);
        ctx.quadraticCurveTo(cx + s * (26 + Math.sin(time * 20 + s) * 4), basket.y - 18, cx + s * 14, basket.y - 34);
        ctx.stroke();
      }
    }

    // Wicker basket.
    ctx.save();
    if (b.landed) {
      ctx.translate(basket.x + basket.w / 2, basket.y + basket.h);
      ctx.rotate(0.12);
      ctx.translate(-(basket.x + basket.w / 2), -(basket.y + basket.h));
    }
    ctx.lineWidth = 3;
    ctx.fillStyle = "#c68b59";
    ctx.beginPath();
    ctx.moveTo(basket.x, basket.y);
    ctx.lineTo(basket.x + basket.w, basket.y);
    ctx.lineTo(basket.x + basket.w - 4, basket.y + basket.h);
    ctx.lineTo(basket.x + 4, basket.y + basket.h);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(90,50,20,0.45)";
    ctx.lineWidth = 1.5;
    for (let y = basket.y + 10; y < basket.y + basket.h; y += 6) {
      ctx.beginPath();
      ctx.moveTo(basket.x, y);
      ctx.lineTo(basket.x + basket.w, y);
      ctx.stroke();
    }
    for (let x = basket.x + 6; x < basket.x + basket.w; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, basket.y);
      ctx.lineTo(x, basket.y + basket.h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#8b5a2b";
    roundRect(ctx, basket.x - 3, basket.y - 3, basket.w + 6, 8, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.lineCap = "butt";
  }

  private drawPigeon(l: PowerLine, p: Pigeon, time: number): void {
    const ctx = this.ctx;
    const f = p.flyer;
    const w = p.wreck;
    if (w && w.landed >= 0) {
      if (w.x > -60 && w.x < this.width + 60) drawDroneWreck(ctx, w, p.seed, p.facing, time);
      return;
    }
    let x: number;
    let y: number;
    if (w) {
      x = w.x;
      y = w.y;
    } else if (f) {
      if (f.y < -40 || f.x < -40 || f.x > this.width + 40) return;
      x = f.x;
      y = f.y;
    } else {
      ({ x, y } = pigeonPos(l, p));
      if (p.startle > 0) y -= Math.sin((p.startle / 0.35) * Math.PI) * 10;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(PIGEON_SCALE * (f ? 1 : p.facing), PIGEON_SCALE);
    if (f) ctx.rotate(-0.35);
    if (w) {
      // Tumbling about its middle.
      ctx.translate(0, -12);
      ctx.rotate(w.rot);
      ctx.translate(0, 12);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;

    if (!f && !w) {
      // Feet gripping the wire
      ctx.strokeStyle = "#e07a5f";
      ctx.beginPath();
      ctx.moveTo(-3, -6);
      ctx.lineTo(-3, 0);
      ctx.moveTo(3, -6);
      ctx.lineTo(3, 0);
      ctx.stroke();
      ctx.strokeStyle = OUTLINE;
    }
    // Tail
    ctx.fillStyle = "#5c6370";
    ctx.beginPath();
    ctx.moveTo(-8, -12);
    ctx.lineTo(-19, -9);
    ctx.lineTo(-17, -4);
    ctx.lineTo(-6, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Body
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath();
    ctx.ellipse(0, -12, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Wing: folded, or flapping hard when flying off
    ctx.fillStyle = "#7d8691";
    ctx.save();
    ctx.translate(-2, -14);
    if (f) ctx.rotate(Math.sin(time * 30 + p.seed) * 1.1 - 0.4);
    ctx.beginPath();
    ctx.ellipse(-3, 0, 8, 4.5, f ? -0.3 : 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Head with an iridescent neck; sitting pigeons bob.
    const bob = f ? 0 : Math.max(0, Math.sin(time * 4 + p.seed)) * 3;
    const hx = 10 + bob;
    const hy = -20;
    ctx.fillStyle = "#6a994e";
    ctx.beginPath();
    ctx.ellipse(7 + bob * 0.5, -16, 4.5, 4, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a92a0";
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e9c46a";
    ctx.beginPath();
    ctx.moveTo(hx + 4, hy - 1);
    ctx.lineTo(hx + 9, hy + 1);
    ctx.lineTo(hx + 4, hy + 2);
    ctx.closePath();
    ctx.fill();
    if (w) {
      // Its cover's cracked: wires spill from the belly and the eye is a red LED.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, -19);
      ctx.lineTo(-3, -14);
      ctx.lineTo(-6, -10);
      ctx.lineTo(-2, -5);
      ctx.stroke();
      drawLooseWires(ctx, -3, -6, p.seed, time, 0.6);
      drawSplat(ctx, 2, -14, 6, p.seed, 1);
      drawLedEye(ctx, hx + 1.5, hy - 1.5, 1);
    } else if (f) {
      drawX(ctx, hx + 1, hy - 1, 2.2);
      // Splattered
      drawSplat(ctx, -2, -16, 7, p.seed, 1);
    } else if ((time * 0.6 + p.seed) % 7 < 0.12) {
      // Now and then the eye glints red. Nobody notices.
      drawLedEye(ctx, hx + 1.5, hy - 1.5, 0.7);
    } else {
      ctx.fillStyle = "#ff7b00";
      ctx.beginPath();
      ctx.arc(hx + 1.5, hy - 1.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Roadside billboard: the front page on a framed board, on a steel frame with a catwalk and lamps. */
  private drawBillboard(o: Obstacle, time: number): void {
    const ctx = this.ctx;
    const x = o.x;
    const w = o.w;
    const top = o.gapBottom;
    const boardBottom = top + BILLBOARD_H;
    const inset = w * BILLBOARD_LEGS_INSET;
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // Steel frame: two legs with cross bracing, filling the collision box below the board.
    const legW = 12;
    const lx = x + inset;
    const rx = x + w - inset - legW;
    ctx.strokeStyle = "#6c757d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let y = boardBottom; y < GROUND_Y - 4; y += 36) {
      const y2 = Math.min(GROUND_Y, y + 36);
      ctx.moveTo(lx + legW, y);
      ctx.lineTo(rx, y2);
      ctx.moveTo(rx, y);
      ctx.lineTo(lx + legW, y2);
      ctx.moveTo(lx + legW, y);
      ctx.lineTo(rx, y);
    }
    ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.fillStyle = "#495057";
    for (const legX of [lx, rx]) {
      ctx.fillRect(legX, boardBottom, legW, GROUND_Y - boardBottom + 4);
      ctx.strokeRect(legX, boardBottom, legW, GROUND_Y - boardBottom + 4);
    }

    // Catwalk under the board, with lamps shining up at it.
    ctx.fillStyle = "#343a40";
    ctx.fillRect(x + 6, boardBottom, w - 12, 7);
    ctx.strokeRect(x + 6, boardBottom, w - 12, 7);
    for (let i = 0; i < 3; i++) {
      const cx = x + w * (0.2 + i * 0.3);
      const glow = 0.18 + Math.sin(time * 3 + i + o.seed) * 0.03;
      ctx.fillStyle = `rgba(255,240,170,${glow})`;
      ctx.beginPath();
      ctx.moveTo(cx - 5, boardBottom - 2);
      ctx.lineTo(cx - 34, top + 10);
      ctx.lineTo(cx + 34, top + 10);
      ctx.lineTo(cx + 5, boardBottom - 2);
      ctx.closePath();
      ctx.fill();
    }

    // Board frame and the ad.
    ctx.fillStyle = "#2b2d42";
    roundRect(ctx, x, top, w, BILLBOARD_H, 4);
    ctx.fill();
    drawBillboardAd(ctx, x + 7, top + 7, w - 14, BILLBOARD_H - 14, o.tabloid, this.photos);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    roundRect(ctx, x, top, w, BILLBOARD_H, 4);
    ctx.stroke();
    // Lamp heads on the catwalk (drawn over the board's bottom edge).
    ctx.fillStyle = "#adb5bd";
    for (let i = 0; i < 3; i++) {
      const cx = x + w * (0.2 + i * 0.3);
      ctx.beginPath();
      ctx.moveTo(cx - 7, boardBottom + 2);
      ctx.lineTo(cx + 7, boardBottom + 2);
      ctx.lineTo(cx + 4, boardBottom - 6);
      ctx.lineTo(cx - 4, boardBottom - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- targets ----------------------------------------------------------------

  private drawTarget(t: Target, time: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.hitFlash > 0) ctx.translate(0, -Math.sin((t.hitFlash / 0.3) * Math.PI) * 6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    if (t.kind === "car") drawCar(ctx, t, time);
    else if (t.kind === "pedestrian") drawPedestrian(ctx, t, time);
    else if (t.kind === "paparazzo") drawPaparazzo(ctx, t, time);
    else if (t.kind === "kid") drawKid(ctx, t, time);
    else if (t.kind === "bride") drawBride(ctx, t, time);
    else if (t.kind === "groom") drawGroom(ctx, t, time);
    else if (t.kind === "guest") drawGuest(ctx, t, time);
    else if (t.kind === "photographer") drawWeddingPhotographer(ctx, t, time);
    else if (t.kind === "parachutist") drawParachutist(ctx, t, time);
    else drawStatue(ctx, t);
    drawTargetSplats(ctx, t.splats);
    ctx.restore();
  }

  // --- poops, particles, text -------------------------------------------------

  private drawPoops(game: Game): void {
    const ctx = this.ctx;
    for (const p of game.poops) drawPoopBlob(ctx, p.x, p.y, p.r, p.rot);
  }

  private drawParticles(game: Game): void {
    const ctx = this.ctx;
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFloaters(game: Game): void {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of game.floaters) {
      const t = 1 - f.life / f.maxLife;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - Math.min(0.2, (t - 0.15) * 0.5);
      ctx.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.3));
      ctx.font = `900 ${Math.round(f.size * pop)}px 'Trebuchet MS', sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawScreenSplats(game: Game): void {
    const ctx = this.ctx;
    for (const s of game.screenSplats) {
      const a = Math.min(0.85, s.life / 1.2);
      drawSplat(ctx, s.x, s.y + (2.5 - s.life) * 8, s.r, s.seed, a);
    }
  }

  // --- bird -------------------------------------------------------------------

  private drawBird(game: BirdLook): void {
    if (game.zapFlash > 0 && Math.floor(game.time * 24) % 2 === 0) return this.drawZappedBird(game);
    const ctx = this.ctx;
    const b = game.bird;
    const c = game.charge.charge;
    const stunned = game.stunned;
    const dead = game.phase !== "playing";
    const danger = game.overstrainProgress;
    const r = BIRD_RADIUS * (1 + c * 0.28);

    ctx.save();
    let shakeX = 0;
    let shakeY = 0;
    if (c > 0.6) {
      const amp = (c - 0.6) * 4 + danger * 4;
      shakeX = (Math.random() - 0.5) * amp;
      shakeY = (Math.random() - 0.5) * amp;
    }
    ctx.translate(b.x + shakeX, b.y + shakeY);
    ctx.rotate(b.rot);
    // Squash & stretch (preserve area)
    const sy = b.stretch;
    ctx.scale(1 / Math.sqrt(sy), sy);

    // Body color: yellow → red as it charges, charred after a zap.
    const body: RGB = game.zapped
      ? [74, 66, 60]
      : lerpColor([255, 209, 102], [239, 71, 111], Math.min(1, c * 1.1));
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // Tail
    ctx.fillStyle = shade(body, -30);
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.1);
    ctx.lineTo(-r * 1.45, -r * 0.55);
    ctx.lineTo(-r * 1.35, r * 0.05);
    ctx.lineTo(-r * 1.5, r * 0.4);
    ctx.lineTo(-r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Body
    ctx.fillStyle = rgb(body);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Belly
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, r * 0.4, r * 0.6, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    const flapping = b.flap > 0 || dead;
    const wingAngle = flapping ? Math.sin(game.time * 40) * 0.9 : c > 0 ? 0.5 + c * 0.4 : Math.sin(game.time * 5) * 0.25;
    ctx.save();
    ctx.translate(-r * 0.25, r * 0.05);
    ctx.rotate(-wingAngle);
    ctx.fillStyle = shade(body, -20);
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, 0, r * 0.55, r * 0.3, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Beak
    const clench = c > 0.3 ? 1 : 0;
    ctx.fillStyle = "#f78c3b";
    ctx.beginPath();
    ctx.moveTo(r * 0.8, -r * 0.12);
    ctx.lineTo(r * (1.45 - clench * 0.1), r * 0.08);
    ctx.lineTo(r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (clench) {
      // Gritted beak line
      ctx.beginPath();
      ctx.moveTo(r * 0.82, r * 0.09);
      for (let i = 1; i <= 4; i++) ctx.lineTo(r * (0.82 + i * 0.13), r * (0.09 + (i % 2 ? -0.05 : 0.05)));
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 3;
    }

    // Cheek blush
    if (c > 0.1 || b.relief > 0) {
      ctx.fillStyle = `rgba(214,40,57,${Math.min(0.75, c * 0.8 + (b.relief > 0 ? 0.2 : 0))})`;
      ctx.beginPath();
      ctx.ellipse(r * 0.45, r * 0.4, r * 0.22, r * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes
    const ex = r * 0.42;
    const ey = -r * 0.28;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = OUTLINE;
    if (dead || stunned) {
      drawX(ctx, ex, ey, r * 0.18);
    } else if (b.relief > 0) {
      // Blissful ^ ^
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ex, ey + 3, r * 0.17, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (c > 0.75) {
      // > < squeezed shut
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.18, ey - r * 0.14);
      ctx.lineTo(ex + r * 0.08, ey);
      ctx.lineTo(ex - r * 0.18, ey + r * 0.14);
      ctx.stroke();
    } else if (c > 0.3) {
      // Squinting: flattened eye
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.2, r * 0.2 * (1 - (c - 0.3) * 1.5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(ex + r * 0.05, ey, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = OUTLINE;
      const look = Math.max(-1, Math.min(1, b.vy / 400));
      ctx.beginPath();
      ctx.arc(ex + r * 0.07, ey + look * r * 0.07, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Brow: angled down as strain builds
    if (!dead && !stunned && (c > 0.05 || b.relief <= 0)) {
      const tilt = c * 0.35;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.25, ey - r * (0.32 + tilt * 0.3));
      ctx.lineTo(ex + r * 0.22, ey - r * (0.3 - tilt));
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    // Forehead veins at high strain
    if (c > 0.85 && !stunned) {
      ctx.strokeStyle = "#9d0208";
      ctx.lineWidth = 2;
      const vx = -r * 0.05;
      const vy = -r * 0.7;
      ctx.beginPath();
      ctx.moveTo(vx - 5, vy - 5);
      ctx.lineTo(vx, vy);
      ctx.lineTo(vx + 5, vy - 5);
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx, vy + 6);
      ctx.stroke();
    }
    ctx.restore();

    // Sweat drops (not rotated, they fall off)
    if (c > 0.55 && !stunned) {
      const n = c > 0.9 ? 3 : c > 0.75 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const t = (game.time * 1.6 + i * 0.37) % 1;
        const sx = b.x - r * 0.6 + i * 10 - t * 12;
        const syy = b.y - r * 0.9 + t * 26;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "#8ecae6";
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, syy - 7);
        ctx.quadraticCurveTo(sx + 5, syy, sx, syy + 3);
        ctx.quadraticCurveTo(sx - 5, syy, sx, syy - 7);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Dizzy stars while stunned
    if (stunned) {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 5 + (i * Math.PI * 2) / 3;
        drawStar(ctx, b.x + Math.cos(a) * 30, b.y - 34 + Math.sin(a) * 8, 7, "#ffd166");
      }
    }
  }

  /** The cartoon X-ray frame of an electrocution: glowing outline, skeleton inside. */
  private drawZappedBird(game: BirdLook): void {
    const ctx = this.ctx;
    const b = game.bird;
    const r = BIRD_RADIUS;
    ctx.save();
    ctx.translate(b.x + (Math.random() - 0.5) * 6, b.y + (Math.random() - 0.5) * 6);
    ctx.rotate(b.rot);
    ctx.fillStyle = "rgba(155,246,255,0.35)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d3557";
    ctx.strokeStyle = "#9bf6ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.1);
    ctx.lineTo(-r * 1.45, -r * 0.55);
    ctx.lineTo(-r * 1.5, r * 0.4);
    ctx.lineTo(-r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Skull, spine, ribs
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(r * 0.45, -r * 0.2, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d3557";
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.28, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, 0);
    ctx.lineTo(-r * 1.2, r * 0.05);
    for (let i = 0; i < 4; i++) {
      const x = -r * (0.05 + i * 0.25);
      ctx.moveTo(x, -r * 0.45);
      ctx.quadraticCurveTo(x - r * 0.12, 0, x, r * 0.45);
    }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(r * 0.8, -r * 0.12);
    ctx.lineTo(r * 1.45, r * 0.08);
    ctx.lineTo(r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawChargeMeter(game: Game): void {
    const ctx = this.ctx;
    const b = game.bird;
    const c = game.charge.charge;
    if (c <= 0 || game.stunned) return;
    const x = b.x - BIRD_RADIUS * 2.6;
    const h = 64;
    const w = 12;
    const y = b.y - h / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    const sweet = game.sweetSpot;
    const danger = game.overstrainProgress;
    let color = c < 0.5 ? "#8ac926" : c < 1 ? "#ffca3a" : "#ff595e";
    if (sweet) color = Math.sin(game.time * 40) > 0 ? "#ffd700" : "#fff3a0";
    else if (c >= 1 && Math.sin(game.time * (12 + danger * 30)) > 0) color = "#ff9f1c";
    ctx.fillStyle = color;
    const fh = (h - 4) * c;
    roundRect(ctx, x + 2, y + h - 2 - fh, w - 4, fh, 3);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    roundRect(ctx, x, y, w, h, 5);
    ctx.stroke();
    if (c >= 1) {
      // Overstrain fuse below the meter
      ctx.fillStyle = "#2b2d42";
      ctx.fillRect(x - 4, y + h + 5, w + 8, 5);
      ctx.fillStyle = sweet ? "#ffd700" : "#ff595e";
      ctx.fillRect(x - 4, y + h + 5, (w + 8) * danger, 5);
      ctx.font = "900 18px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = OUTLINE;
      const label = sweet ? "NOW!" : "!";
      ctx.strokeText(label, x + w / 2, y - 12);
      ctx.fillStyle = sweet ? "#ffd700" : "#ff595e";
      ctx.fillText(label, x + w / 2, y - 12);
    }
  }

  // --- slingshot kids -------------------------------------------------------------

  /**
   * The aim of a kid who's winding up: a dotted arc that reaches out further
   * the more he pulls, ending in a crosshair on the bird.
   */
  private drawKidAim(t: Target, game: Game): void {
    const k = t.kid;
    if (!k || k.state !== "aiming" || game.phase !== "playing") return;
    const ctx = this.ctx;
    const g = config.kidPebbleGravity;
    const s = slingshotPos(t);
    const pts: { x: number; y: number }[] = [];
    const step = 1 / 60;
    for (let i = 0; i < 180; i++) {
      const tt = i * step;
      const x = s.x + k.aimVx * tt;
      const y = s.y + k.aimVy * tt + 0.5 * g * tt * tt;
      pts.push({ x, y });
      if (x <= game.bird.x) break;
    }
    const shown = Math.ceil(pts.length * (0.3 + 0.7 * k.pull));
    const march = Math.floor(game.time * 30) % 3;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < shown; i++) {
      if ((i + march) % 3 !== 0) continue;
      const p = pts[i];
      ctx.globalAlpha = (0.35 + 0.65 * k.pull) * (1 - (i / pts.length) * 0.3);
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + k.pull * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (k.pull < 0.45) return;
    // Crosshair where the pebble's going
    const end = pts[pts.length - 1];
    const a = Math.min(1, (k.pull - 0.45) / 0.3);
    const r = 40 - k.pull * 10 + Math.sin(game.time * 20) * 1.5;
    ctx.save();
    ctx.translate(end.x, end.y);
    ctx.rotate(game.time * 2);
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#ff3b3b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      ctx.moveTo(Math.cos(ang) * (r - 7), Math.sin(ang) * (r - 7));
      ctx.lineTo(Math.cos(ang) * (r + 7), Math.sin(ang) * (r + 7));
    }
    ctx.stroke();
    ctx.restore();
  }

  // --- paparazzi ----------------------------------------------------------------

  /**
   * The paparazzo's timer: a ring with a camera that fills as he closes in.
   */
  private drawPaparazzoTimer(t: Target, game: Game): void {
    const p = t.pap;
    if (!p || p.state !== "watching" || game.phase !== "playing") return;
    const ctx = this.ctx;
    const urgent = p.timer > 0.7;
    const pulse = urgent ? 1 + Math.max(0, Math.sin(game.time * 18)) * 0.12 : 1;
    const r = 19 * pulse;
    const x = t.x;
    const y = t.y - t.h - 30;

    // Disc, then the remaining time as a shrinking wedge.
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = urgent ? "#ff3b3b" : "#ff8fab";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.timer);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Camera icon
    ctx.fillStyle = OUTLINE;
    roundRect(ctx, x - 10, y - 6, 20, 14, 3);
    ctx.fill();
    ctx.fillRect(x - 4, y - 9, 8, 4);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y + 1, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(x, y + 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The fresh shot pops up as a polaroid in the top corner. */
  private drawPolaroid(game: Game): void {
    const p = game.polaroid;
    if (!p) return;
    const ctx = this.ctx;
    const age = p.maxLife - p.life;
    if (p.wedding) {
      // The official wedding photo: a big framed print in the top corner, developing from white.
      const pop = age < 0.22 ? 0.3 + (age / 0.22) * 0.8 : 1.1 - Math.min(0.1, (age - 0.22) * 0.8);
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 0.4);
      ctx.translate(this.width - 140, 140);
      ctx.rotate(-0.05 + Math.sin(age * 2) * 0.01);
      ctx.scale(pop, pop);
      drawWeddingPrint(ctx, -110, -100, 220, p.wedding, this.photos.get(p.photoId), Math.max(0, 1 - age / 0.7));
      ctx.restore();
      return;
    }
    const pop = age < 0.18 ? 0.4 + (age / 0.18) * 0.75 : 1.15 - Math.min(0.15, (age - 0.18) * 1.2);
    const alpha = Math.min(1, p.life / 0.35);
    const w = 120;
    const h = 142;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.width - 110, 120);
    ctx.rotate(0.12 - age * 0.02);
    ctx.scale(pop, pop);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    ctx.fillStyle = "#fffdf7";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    // The photo develops: it starts white and fades in.
    drawPhoto(ctx, this.photos.get(p.photoId), -w / 2 + 8, -h / 2 + 8, w - 16, w - 16);
    const develop = Math.max(0, 1 - age / 0.6);
    if (develop > 0) {
      ctx.fillStyle = `rgba(255,255,255,${develop})`;
      ctx.fillRect(-w / 2 + 8, -h / 2 + 8, w - 16, w - 16);
    }
    ctx.fillStyle = OUTLINE;
    ctx.font = "italic 700 15px 'Comic Sans MS', 'Trebuchet MS', cursive";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("gotcha ;)", 0, h / 2 - 11);
    ctx.restore();
  }

  /**
   * Over the couple: the photographer's countdown in a heart (3… 2… 1…), then
   * a pulsing "KISS!" heart whose ring runs out with the jackpot window. A
   * ruined kiss breaks the heart. The run's first wedding gets a hint.
   */
  private drawWeddingCue(w: Wedding, game: Game): void {
    const ctx = this.ctx;
    const x = weddingX(w);
    if (x < -80 || x > this.width + 80) return;
    const y = GROUND_Y - 185;
    const playing = game.phase === "playing";
    if (w.phase === "countdown" && playing) {
      const toKiss = (x - game.bird.x - config.weddingKissLead) / Math.max(1, game.speed);
      const into = Math.min(1, Math.max(0, w.count - toKiss / Math.max(0.05, config.weddingBeat)));
      const pop = 1 + 0.45 * (1 - into) ** 3;
      drawHeart(ctx, x, y, 24 * pop, "#ff8fab");
      outlinedText(ctx, String(w.count), x, y + 1, 28 * pop, "#fff");
    } else if (w.phase === "kiss" && playing) {
      const left = 1 - Math.min(1, w.t / Math.max(0.05, config.weddingKissTime));
      const pulse = 1 + Math.max(0, Math.sin(game.time * 16)) * 0.12;
      ctx.lineCap = "round";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(x, y, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.lineCap = "butt";
      drawHeart(ctx, x, y, 34 * pulse, "#ff3b6b");
      outlinedText(ctx, "KISS!", x, y + 2, 20 * pulse, "#fff");
      // Little hearts floating up from the couple
      for (let i = 0; i < 4; i++) {
        const k = (game.time * 1.4 + i / 4) % 1;
        ctx.globalAlpha = 1 - k;
        drawHeart(ctx, x + Math.sin(k * 9 + i) * 10 + (i - 1.5) * 6, GROUND_Y - 50 - k * 70, 5 + k * 3, "#ff8fab");
      }
      ctx.globalAlpha = 1;
    } else if (w.outcome === "ruined" && w.t < 1.8) {
      // The heart cracks in two and the halves fall apart.
      const k = Math.min(1, w.t / 1.2);
      ctx.globalAlpha = Math.min(1, (1.8 - w.t) / 0.5);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(x + s * (4 + k * 22), y + k * k * 60);
        ctx.rotate(s * k * 0.6);
        ctx.beginPath();
        ctx.rect(s < 0 ? -60 : 0, -60, 60, 120);
        ctx.clip();
        drawHeart(ctx, 0, 0, 34, "#7a4a1e");
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    // The furious bride winds up: a warning over her head.
    if (w.outcome === "ruined" && !w.thrown && w.t > WEDDING_WINDUP - 0.5 && playing) {
      const b = w.bride;
      outlinedText(ctx, "!", b.x, b.y - b.h - 34 + Math.sin(game.time * 30) * 2, 26, "#ff595e");
    }
    if (w.tutorial && !w.outcome && playing && w.phase !== "kiss") {
      const bob = Math.sin(game.time * 6) * 4;
      outlinedText(ctx, "\u{1F48B} Drop it on the KISS!", x, y - 52 + bob, 20, "#ffd60a");
    }
  }

  /**
   * The official wedding photo, composed at the moment it's taken: the couple
   * under the arch with the church behind and the guests around, and the
   * bird photobombing from the corner. In face mode `face` (the player's
   * face at the kiss) is stuck on the bird. Kept in memory for this run only.
   */
  captureWedding(game: Game, face: Photo | null): Photo | null {
    const w = game.wedding;
    if (!w) return null;
    const W = 320;
    const H = 240;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d");
    if (!octx) return null;
    const sky = octx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#8ecae6");
    sky.addColorStop(0.7, "#ffe8d6");
    sky.addColorStop(1, "#ffd6a5");
    octx.fillStyle = sky;
    octx.fillRect(0, 0, W, H);

    // World → photo: the couple slightly left of centre, the church on the right.
    const s = 1.6;
    const focusX = weddingX(w) + 12;
    const feet = GROUND_Y + 20;
    const groundY = 228;
    const toWorld = (px: number, py: number) => ({ x: focusX + (px - W / 2) / s, y: feet + (py - groundY) / s });
    const ruined = w.outcome === "ruined";
    const birdAt = { x: W * 0.82, y: H * 0.22 };
    const birdCharge = ruined ? 0 : 0.9;

    const main = this.ctx;
    const b = game.bird;
    const savedBird = { ...b };
    const savedCharge = game.charge;
    const savedZap = game.zapFlash;
    this.ctx = octx;
    try {
      octx.setTransform(s, 0, 0, s, W / 2 - focusX * s, groundY - feet * s);
      octx.fillStyle = "#d9d4c7";
      octx.fillRect(focusX - 200, GROUND_Y, 400, 22);
      octx.fillStyle = "#9e9a8f";
      octx.fillRect(focusX - 200, GROUND_Y + 20, 400, 5);
      octx.fillStyle = "#4a4e69";
      octx.fillRect(focusX - 200, GROUND_Y + 25, 400, 80);
      drawChurch(octx, w.church, game.time);
      drawWeddingBackdrop(octx, w, game.time);
      for (const t of [...w.guests, w.groom, w.bride]) this.drawTarget(t, game.time);
      // Whatever's flying (splatter, the veil, confetti) is in the shot too.
      this.drawParticles(game);
      // The bird photobombs: straining if the kiss went through, blissfully relieved if it just let go on them.
      const at = toWorld(birdAt.x, birdAt.y);
      Object.assign(b, { x: at.x, y: at.y, rot: -0.3, stretch: 1, stretchV: 0, relief: ruined ? 0.4 : 0, flap: 0 });
      game.charge = { ...savedCharge, charge: birdCharge };
      game.zapFlash = 0;
      this.drawBird(game);
    } finally {
      this.ctx = main;
      Object.assign(b, savedBird);
      game.charge = savedCharge;
      game.zapFlash = savedZap;
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);

    if (face && face.width > 0 && face.height > 0) {
      // The player's face on the bird's body, with the beak stuck back on top.
      const r = BIRD_RADIUS * (1 + birdCharge * 0.28) * s;
      octx.save();
      octx.translate(birdAt.x, birdAt.y);
      octx.rotate(-0.3);
      const fr = r * 0.95;
      octx.save();
      octx.beginPath();
      octx.arc(r * 0.1, -r * 0.05, fr, 0, Math.PI * 2);
      octx.clip();
      const k = Math.max((fr * 2) / face.width, (fr * 2) / face.height);
      octx.drawImage(face, r * 0.1 - (face.width * k) / 2, -r * 0.05 - (face.height * k) / 2, face.width * k, face.height * k);
      octx.restore();
      octx.strokeStyle = OUTLINE;
      octx.lineWidth = 3;
      octx.beginPath();
      octx.arc(r * 0.1, -r * 0.05, fr, 0, Math.PI * 2);
      octx.stroke();
      octx.fillStyle = "#f78c3b";
      octx.beginPath();
      octx.moveTo(r * 0.9, -r * 0.12);
      octx.lineTo(r * 1.55, r * 0.08);
      octx.lineTo(r * 0.9, r * 0.3);
      octx.closePath();
      octx.fill();
      octx.stroke();
      octx.restore();
    }
    // The photographer's lens got splatted: so did the photo.
    const smudges = Math.min(3, w.photographer.splats.length);
    for (let i = 0; i < smudges; i++) {
      drawSplat(octx, 40 + rnd(w.photographer.seed + i) * 240, 40 + rnd(w.photographer.seed + i + 9) * 160, 45 + i * 10, w.photographer.seed + i, 0.85);
    }
    // Soft vignette
    const v = octx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, "rgba(80,40,20,0)");
    v.addColorStop(1, "rgba(80,40,20,0.35)");
    octx.fillStyle = v;
    octx.fillRect(0, 0, W, H);
    return out;
  }

  // --- ocean ------------------------------------------------------------------

  private drawOcean(game: Game): void {
    const ctx = this.ctx;
    const w = this.width + 40;
    const time = game.time;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "#48cae4");
    g.addColorStop(0.35, "#1b8fb5");
    g.addColorStop(0.75, "#0f5f8a");
    g.addColorStop(1, "#0a3f63");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w, VIEW_H + 40);

    // Light rays from the surface, drifting slowly.
    for (let i = 0; i < 6; i++) {
      const span = w + 360;
      const x0 = ((((i * 237 - this.bgOffset * 0.12 + Math.sin(time * 0.4 + i) * 30) % span) + span) % span) - 180;
      const top = 34 + rnd(i + 40) * 30;
      ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.03 * Math.sin(time * 0.9 + i * 1.7)})`;
      ctx.beginPath();
      ctx.moveTo(x0, SURFACE_Y);
      ctx.lineTo(x0 + top, SURFACE_Y);
      ctx.lineTo(x0 - 90 + top * 2.6, GROUND_Y);
      ctx.lineTo(x0 - 150, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }

    // Far rock silhouettes (slow), then kelp (faster).
    const rockOff = ((this.bgOffset * 0.15) % SKYLINE_LEN + SKYLINE_LEN) % SKYLINE_LEN;
    ctx.fillStyle = "#0c4d6e";
    for (let rep = 0; rep * SKYLINE_LEN - rockOff < this.width + 100; rep++) {
      for (const b of FAR_ROCKS) {
        const x = b.x + rep * SKYLINE_LEN - rockOff;
        if (x > this.width + 50 || x + b.w < -50) continue;
        const top = GROUND_Y - b.h;
        ctx.beginPath();
        ctx.moveTo(x - 10, GROUND_Y);
        ctx.quadraticCurveTo(x, top, x + b.w / 2, top);
        ctx.quadraticCurveTo(x + b.w, top, x + b.w + 10, GROUND_Y);
        ctx.fill();
      }
    }
    const kelpOff = ((this.bgOffset * 0.4) % SKYLINE_LEN + SKYLINE_LEN) % SKYLINE_LEN;
    ctx.lineCap = "round";
    for (let rep = 0; rep * SKYLINE_LEN - kelpOff < this.width + 100; rep++) {
      for (const k of KELP) {
        const x = k.x + rep * SKYLINE_LEN - kelpOff;
        if (x > this.width + 60 || x < -60) continue;
        ctx.strokeStyle = "#1d7a5f";
        ctx.lineWidth = 7;
        ctx.beginPath();
        const segs = 8;
        let px = x;
        let py = GROUND_Y;
        ctx.moveTo(px, py);
        for (let i = 1; i <= segs; i++) {
          const f = i / segs;
          px = x + Math.sin(time * 1.3 + k.phase + f * 3) * 14 * f;
          py = GROUND_Y - k.h * f;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = "#2a9d73";
        for (let i = 2; i <= segs; i += 2) {
          const f = i / segs;
          const lx = x + Math.sin(time * 1.3 + k.phase + f * 3) * 14 * f;
          const ly = GROUND_Y - k.h * f;
          ctx.beginPath();
          ctx.ellipse(lx + (i % 4 ? 9 : -9), ly, 10, 4, i % 4 ? 0.5 : -0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.lineCap = "butt";

    // Rising bubbles
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    const span = this.width + 100;
    const depth = GROUND_Y - SURFACE_Y;
    for (let i = 0; i < 28; i++) {
      const rise = 25 + rnd(i + 60) * 45;
      const bx = ((((rnd(i + 50) * span - this.bgOffset * 0.5) % span) + span) % span) - 50 + Math.sin(time * 2 + i) * 6;
      const by = GROUND_Y - ((time * rise + rnd(i + 70) * depth) % depth);
      const br = 2 + rnd(i + 80) * 4;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The surface seen from below: a bright, rippling band.
    ctx.fillStyle = "#a9ecf5";
    ctx.beginPath();
    ctx.moveTo(-20, -20);
    ctx.lineTo(w, -20);
    for (let x = w; x >= -20; x -= 20) {
      ctx.lineTo(x, SURFACE_Y + Math.sin(x * 0.03 + time * 2 + this.bgOffset * 0.03) * 4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Sea floor
    ctx.fillStyle = "#e9cf94";
    ctx.beginPath();
    ctx.moveTo(-20, VIEW_H + 20);
    for (let x = -20; x <= w; x += 20) {
      ctx.lineTo(x, GROUND_Y + Math.sin((x + this.bgOffset) * 0.02) * 3);
    }
    ctx.lineTo(w, VIEW_H + 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();
    // Ripples and pebbles
    ctx.strokeStyle = "rgba(160,120,60,0.35)";
    ctx.lineWidth = 2;
    const rip = this.bgOffset % 70;
    for (let x = -rip; x < w; x += 70) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 32);
      ctx.quadraticCurveTo(x + 15, GROUND_Y + 26, x + 30, GROUND_Y + 32);
      ctx.stroke();
    }
    const peb = this.bgOffset % 130;
    for (let i = 0, x = -peb; x < w; x += 130, i++) {
      const seed = Math.floor((this.bgOffset + x) / 130);
      ctx.fillStyle = rnd(seed) > 0.5 ? "#c9a86a" : "#f4a3a8";
      ctx.beginPath();
      ctx.ellipse(x + rnd(seed + 1) * 60, GROUND_Y + 50 + rnd(seed + 2) * 20, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSeaObstacle(o: Obstacle): void {
    const ctx = this.ctx;
    const [base] = obstacleRects(o);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    if (o.bottom === "rock") {
      // Stacked boulders filling the column.
      ctx.fillStyle = o.color;
      roundRect(ctx, base.x, base.y, base.w, base.h + 4, 16);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      for (let y = base.y + 34, i = 0; y < GROUND_Y - 10; y += 38, i++) {
        ctx.beginPath();
        ctx.moveTo(base.x + 4, y);
        ctx.quadraticCurveTo(base.x + base.w * (0.3 + rnd(o.seed + i) * 0.4), y + 10, base.x + base.w - 4, y - 2);
        ctx.stroke();
      }
      // Moss & a starfish
      ctx.fillStyle = "#4a7c59";
      roundRect(ctx, base.x + 4, base.y + 2, base.w - 8, 9, 4);
      ctx.fill();
      drawStar(ctx, base.x + base.w * 0.6, base.y + 40 + rnd(o.seed) * 60, 9, "#ff9f43");
    } else {
      // Coral column: scalloped top, polyps.
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.moveTo(base.x, GROUND_Y + 4);
      ctx.lineTo(base.x, base.y + 12);
      const bumps = Math.max(2, Math.round(base.w / 22));
      const bw = base.w / bumps;
      for (let i = 0; i < bumps; i++) ctx.arc(base.x + bw * (i + 0.5), base.y + 12, bw / 2, Math.PI, 0);
      ctx.lineTo(base.x + base.w, GROUND_Y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (let i = 0; i < 14; i++) {
        const px = base.x + 8 + rnd(o.seed + i) * (base.w - 16);
        const py = base.y + 24 + rnd(o.seed + i + 20) * Math.max(0, base.h - 34);
        if (py > GROUND_Y - 6) continue;
        ctx.beginPath();
        ctx.arc(px, py, 3 + rnd(o.seed + i + 40) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(base.x + base.w - 12, base.y + 18, 9, Math.max(0, base.h - 18));
    }
  }

  private drawJelly(j: Jelly, time: number, poppable: boolean): void {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(time * 3 + j.phase) * 0.08;
    const r = j.r;
    ctx.save();
    ctx.translate(j.x, j.y);
    // Tentacles
    ctx.strokeStyle = `hsla(${j.hue},70%,62%,0.9)`;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const tx = -r * 0.6 + (i * r * 1.2) / 3;
      ctx.beginPath();
      ctx.moveTo(tx, r * 0.2);
      for (let k = 1; k <= 5; k++) {
        ctx.lineTo(tx + Math.sin(time * 4 + j.phase + i + k) * 4, r * 0.2 + (k * r * 1.5) / 5);
      }
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    // Bell
    ctx.scale(1 / pulse, pulse);
    ctx.fillStyle = `hsla(${j.hue},85%,78%,0.85)`;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r, r * 0.25);
    ctx.bezierCurveTo(-r, -r * 1.1, r, -r * 1.1, r, r * 0.25);
    for (let i = 4; i >= 0; i--) ctx.quadraticCurveTo(-r + (i + 0.5) * (r / 2.5), r * 0.45, -r + i * (r / 2.5), r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = OUTLINE;
    for (const ex of [-r * 0.25, r * 0.25]) {
      ctx.beginPath();
      ctx.arc(ex, -r * 0.05, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Spiked fish can pop it: a pulsing gold ring says so.
    if (poppable) {
      ctx.strokeStyle = `rgba(255,214,0,${0.5 + 0.4 * Math.sin(time * 10)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(j.x, j.y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /**
   * The pufferfish: olive speckled back, spotted yellow flank, white belly. Deflated it's a
   * slim torpedo; puffing rounds it into a ball with a sagging white belly. Fins and eye keep
   * their size while the body inflates.
   */
  private drawFish(game: Game): void {
    const ctx = this.ctx;
    const b = game.bird;
    const f = game.fish;
    const dead = game.phase !== "playing";
    const stunned = game.stunned;
    const danger = game.popProgress;
    const warn = game.popWarning;
    const holding = !!game.transition && game.holdTransition;
    let r = game.bodyRadius;
    if (holding) r *= 1 + Math.sin(game.time * 5) * 0.06;
    const puff = Math.min(1, Math.max(0, f.puff));
    const shape = fishShape(r, puff);
    const { L, H, B, q } = shape;
    const S = BIRD_RADIUS; // fin and eye scale: these don't inflate

    ctx.save();
    let jx = 0;
    let jy = 0;
    if (danger > 0.4) {
      const amp = (danger - 0.4) * 8;
      jx = (Math.random() - 0.5) * amp;
      jy = (Math.random() - 0.5) * amp;
    }
    ctx.translate(b.x + jx, b.y + jy);
    ctx.rotate(b.rot);
    const sy = b.stretch;
    ctx.scale(1 / Math.sqrt(sy), sy);
    ctx.lineJoin = "round";

    // Spines (behind the body): short prickles on the inflated belly, long spikes all round when spiked.
    const prickle = r * 0.12 * Math.min(1, Math.max(0, (puff - 0.5) * 2.5));
    const spineLen = r * 0.42 * f.spikes;
    if (prickle + spineLen > 1 && !stunned) {
      ctx.fillStyle = "#ece6cf";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      const n = 22;
      const half = 1.4 + r * 0.05;
      for (let i = 0; i < n; i++) {
        const a = -2.2 + (i / (n - 1)) * 4.4;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const ry = sa < 0 ? H : B;
        const x = ca * L * 0.9;
        const y = sa * ry * 0.9;
        const nl = Math.hypot(ca * ry, sa * L) || 1;
        const nx = (ca * ry) / nl;
        const ny = (sa * L) / nl;
        const len = spineLen * (sa < 0 ? 0.8 : 1) + (sa > 0.25 ? prickle : 0);
        if (len < 1) continue;
        ctx.beginPath();
        ctx.moveTo(x - ny * half, y + nx * half);
        ctx.lineTo(x + nx * (len + r * 0.1), y + ny * (len + r * 0.1));
        ctx.lineTo(x + ny * half, y - nx * half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Tail, dorsal and anal fins (behind the body).
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    const finFill = stunned ? "#a9a283" : "#8f7e3c";
    const finRay = "rgba(60,48,18,0.55)";
    const moving = Math.abs(b.vy) / 150;
    const tailA = dead ? 0 : Math.sin(game.time * (10 + moving * 8)) * 0.3;
    ctx.save();
    ctx.translate(-L + 1, 0);
    ctx.rotate(tailA);
    const tl = S * 0.8;
    const th = S * 0.55;
    ctx.fillStyle = finFill;
    ctx.beginPath();
    ctx.moveTo(1, -q * 0.9);
    ctx.quadraticCurveTo(-tl * 0.5, -th * 0.7, -tl, -th);
    ctx.quadraticCurveTo(-tl * 0.86, -th * 0.5, -tl * 0.95, 0);
    ctx.quadraticCurveTo(-tl * 0.86, th * 0.5, -tl, th);
    ctx.quadraticCurveTo(-tl * 0.5, th * 0.7, 1, q * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = finRay;
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-tl * 0.1, (i * q) / 5);
      ctx.lineTo(-tl * 0.9, (i * th) / 3.6);
      ctx.stroke();
    }
    ctx.restore();

    const finFlap = dead ? 0 : Math.sin(game.time * 9) * 0.12;
    for (const dir of [-1, 1]) {
      // Dorsal (top) and anal (bottom) fins sit just ahead of the tail.
      const base0 = fishEdgePoint(shape, dir, 0.42);
      const base1 = fishEdgePoint(shape, dir, 0.72);
      const fl = S * 0.42;
      ctx.save();
      ctx.translate(base1.x, base1.y);
      ctx.rotate(finFlap * dir);
      const bx0 = base0.x - base1.x;
      const by0 = base0.y - base1.y;
      ctx.fillStyle = finFill;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx0, by0 - dir * 2);
      ctx.quadraticCurveTo(bx0 - fl * 0.2, by0 + dir * fl * 0.9, -fl * 0.75, dir * fl * 0.75);
      ctx.quadraticCurveTo(-fl * 0.35, dir * fl * 0.25, 2, -dir * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = finRay;
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        ctx.beginPath();
        ctx.moveTo(bx0 * (1 - t), by0 * (1 - t));
        ctx.lineTo(bx0 * (1 - t) - fl * (0.45 + t * 0.3), by0 * (1 - t) + dir * fl * (0.65 + t * 0.1));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Body, coloured in layers inside its own outline.
    fishBodyPath(ctx, shape);
    ctx.save();
    ctx.clip();
    const top = -H - 2;
    const bottom = B + 2;
    ctx.fillStyle = "#d4bd55"; // yellow flank band
    ctx.fillRect(-L - 2, top, L * 2 + 4, bottom - top);

    // Olive back: dips toward the mouth, rises toward the tail to bare the spotted band.
    const back = ctx.createLinearGradient(0, -H, 0, H * 0.2);
    back.addColorStop(0, "#463d22");
    back.addColorStop(1, "#6f6634");
    ctx.fillStyle = back;
    ctx.beginPath();
    ctx.moveTo(L + 2, H * 0.12 + B * 0.05);
    ctx.bezierCurveTo(L * 0.4, B * 0.1, -L * 0.1, -H * 0.3, -L - 2, -q);
    ctx.lineTo(-L - 2, top);
    ctx.lineTo(L + 2, top);
    ctx.closePath();
    ctx.fill();

    // Mottling on the back, then the big dark spots (band and rear back).
    for (let i = 0; i < 46; i++) {
      const u = rnd(i * 3.1 + 1) * 2 - 1;
      const v = -rnd(i * 5.7 + 2) * 0.95;
      ctx.fillStyle = i % 3 ? "rgba(214,204,140,0.35)" : "rgba(30,24,10,0.35)";
      ctx.beginPath();
      ctx.arc(u * L, v * H, 0.6 + rnd(i * 7.3 + 3) * (0.6 + r * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(38,30,12,0.88)";
    for (const [u, v, k] of FISH_SPOTS) {
      const R = v < 0 ? H : B;
      ctx.beginPath();
      ctx.ellipse(u * L, v * R, k * (1 + L * 0.05), k * (1 + R * 0.075), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // White belly: grows up the flanks as the fish inflates.
    const beltV = 0.42 - 0.26 * puff;
    const belly = ctx.createLinearGradient(0, beltV * B, 0, B);
    belly.addColorStop(0, "#f7f6ef");
    belly.addColorStop(0.65, "#e6e5dc");
    belly.addColorStop(1, "#b9b8ad");
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.moveTo(L + 2, H * 0.12 + B * 0.18);
    ctx.bezierCurveTo(L * 0.4, beltV * B, -L * 0.3, beltV * B, -L - 2, q * 0.7);
    ctx.lineTo(-L - 2, bottom);
    ctx.lineTo(L + 2, bottom);
    ctx.closePath();
    ctx.fill();
    // Stretched belly skin
    if (puff > 0.3) {
      ctx.fillStyle = `rgba(150,148,135,${(puff - 0.3) * 0.5})`;
      for (let i = 0; i < 24; i++) {
        const u = rnd(i * 2.3 + 9) * 1.6 - 0.8;
        const v = beltV + 0.1 + rnd(i * 4.1 + 5) * (0.85 - beltV);
        ctx.beginPath();
        ctx.arc(u * L, v * B, 0.8 + r * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Roundness: light from above-front, shadow at the rim.
    const shine = ctx.createRadialGradient(L * 0.15, -H * 0.45, 0, 0, 0, Math.max(L, B, H) * 1.15);
    shine.addColorStop(0, "rgba(255,255,230,0.22)");
    shine.addColorStop(0.5, "rgba(255,255,230,0)");
    shine.addColorStop(1, "rgba(20,16,5,0.35)");
    ctx.fillStyle = shine;
    ctx.fillRect(-L - 2, top, L * 2 + 4, bottom - top);

    // Strained red as the pop nears, flashing on the warning; washed out while stunned.
    if (stunned) ctx.fillStyle = "rgba(205,205,190,0.55)";
    else if (warn && Math.sin(game.time * 40) > 0) ctx.fillStyle = "rgba(255,90,90,0.55)";
    else ctx.fillStyle = `rgba(239,71,111,${Math.min(0.55, danger * 0.6)})`;
    ctx.fillRect(-L - 2, top, L * 2 + 4, bottom - top);
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    fishBodyPath(ctx, shape);
    ctx.stroke();

    // Pectoral fin, fluttering, behind the eye.
    ctx.save();
    ctx.translate(L * 0.28, H * 0.05);
    ctx.rotate(-0.15 + (dead ? 0 : Math.sin(game.time * 14) * 0.35));
    const pw = S * 0.55;
    const ph = S * 0.5;
    ctx.fillStyle = finFill;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -ph * 0.3);
    ctx.quadraticCurveTo(-pw * 0.45, -ph * 0.85, -pw, -ph * 0.5);
    ctx.quadraticCurveTo(-pw * 0.78, -ph * 0.1, -pw * 0.92, ph * 0.12);
    ctx.quadraticCurveTo(-pw * 0.55, ph * 0.75, 0, ph * 0.3);
    ctx.quadraticCurveTo(pw * 0.12, 0, 0, -ph * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = finRay;
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-pw * 0.05, i * ph * 0.08);
      ctx.lineTo(-pw * 0.85, i * ph * 0.2 - ph * 0.12);
      ctx.stroke();
    }
    ctx.restore();

    // Eye: green iris in a gold ring, high on the head.
    const ex = L * 0.56;
    const ey = -H * 0.5;
    const er = S * 0.2 + r * 0.05;
    ctx.strokeStyle = OUTLINE;
    if (dead || stunned) {
      ctx.fillStyle = OUTLINE;
      drawX(ctx, ex, ey, er * 0.8);
    } else {
      ctx.fillStyle = "#d9c45a";
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      const iris = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 0.78);
      iris.addColorStop(0, "#9cc94a");
      iris.addColorStop(1, "#4d7a26");
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(ex, ey, er * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      const pr = warn ? er * 0.2 : er * 0.42;
      const look = Math.max(-1, Math.min(1, b.vy / 200));
      ctx.beginPath();
      ctx.arc(ex + er * 0.15, ey + look * er * 0.25, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex - er * 0.15, ey - er * 0.3, er * 0.18, 0, Math.PI * 2);
      ctx.fill();
      // Worried brow when spiked
      if (f.spikes > 0.5) {
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex - er * 1.1, ey - er * 1.25);
        ctx.lineTo(ex + er * 0.9, ey - er * (1.25 + danger * 0.6));
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }

    // Mouth: small pursed lips at the blunt snout; an "o" when puffed hard.
    const mx = L;
    const my = shape.noseY;
    const lip = S * 0.15;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#e3d3a2";
    ctx.beginPath();
    ctx.ellipse(mx, my, lip, lip * 1.05, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.stroke();
    if (puff > 0.6 && !stunned && !dead) {
      ctx.fillStyle = "#5a1f1f";
      ctx.beginPath();
      ctx.ellipse(mx + lip * 0.45, my, lip * 0.3, lip * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx + lip, my);
      ctx.lineTo(mx + lip * 0.3, my);
      ctx.stroke();
    }
    ctx.lineJoin = "miter";
    ctx.restore();

    // Spike-out flash ring
    if (f.flare > 0) {
      const k = 1 - f.flare / 0.35;
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * (1.3 + k * 1.2), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (stunned) {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 5 + (i * Math.PI * 2) / 3;
        drawStar(ctx, b.x + Math.cos(a) * 30, b.y - r - 12 + Math.sin(a) * 8, 7, "#ffd166");
      }
    }
  }

  /** Puff meter next to the fish, with the hover level and the spike threshold marked. */
  private drawPuffMeter(game: Game): void {
    if (game.stunned) return;
    const ctx = this.ctx;
    const b = game.bird;
    const p = game.fish.puff;
    const r = game.bodyRadius;
    const h = 72;
    const w = 12;
    const x = b.x - r - 40;
    const y = b.y - h / 2;
    const yAt = (v: number) => y + h - 2 - (h - 4) * v;
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    const warn = game.popWarning;
    const spiked = game.spike.spiked;
    let color = p < config.oceanHoverPuff ? "#4cc9f0" : p < config.oceanSpikeThreshold ? "#ffca3a" : "#ff595e";
    if (warn) color = Math.sin(game.time * 40) > 0 ? "#ff1f4b" : "#fff3a0";
    else if (spiked && Math.sin(game.time * (12 + game.popProgress * 30)) > 0) color = "#ff9f1c";
    ctx.fillStyle = color;
    const fh = (h - 4) * p;
    roundRect(ctx, x + 2, y + h - 2 - fh, w - 4, fh, 3);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    roundRect(ctx, x, y, w, h, 5);
    ctx.stroke();
    // Marks: hover (blue) and spike threshold (red)
    for (const [v, c] of [[config.oceanHoverPuff, "#3a86ff"], [config.oceanSpikeThreshold, "#ef476f"]] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 5, yAt(v));
      ctx.lineTo(x + w + 5, yAt(v));
      ctx.stroke();
    }
    if (spiked) {
      // Pop fuse below the meter
      ctx.fillStyle = "#2b2d42";
      ctx.fillRect(x - 4, y + h + 5, w + 8, 5);
      ctx.fillStyle = warn ? "#ff1f4b" : "#ff9f1c";
      ctx.fillRect(x - 4, y + h + 5, (w + 8) * game.popProgress, 5);
      ctx.font = "900 16px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 4;
      ctx.strokeStyle = OUTLINE;
      const label = warn ? "DEFLATE!" : "!";
      ctx.strokeText(label, x + w / 2, y - 12);
      ctx.fillStyle = warn ? "#ff1f4b" : "#ff9f1c";
      ctx.fillText(label, x + w / 2, y - 12);
    }
  }
}

// --- shape helpers ---------------------------------------------------------------

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 26 * s, 0, Math.PI * 2);
  ctx.arc(x + 28 * s, y - 12 * s, 32 * s, 0, Math.PI * 2);
  ctx.arc(x + 62 * s, y, 24 * s, 0, Math.PI * 2);
  ctx.arc(x + 30 * s, y + 8 * s, 26 * s, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPoopBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(rot) * 0.3);
  ctx.lineWidth = Math.max(1.5, r * 0.25);
  ctx.strokeStyle = POOP_DARK;
  ctx.fillStyle = POOP;
  // Three stacked swirls
  ctx.beginPath();
  ctx.ellipse(0, r * 0.35, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.15, r * 0.72, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.45);
  ctx.quadraticCurveTo(0, -r * 1.2, r * 0.25, -r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, r * 0.2, r * 0.18, r * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSplat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = POOP;
  // Smooth blob: quadratic curves through the midpoints of jittered points.
  const n = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.6 + rnd(seed + i) * 0.6);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6]);
  }
  ctx.beginPath();
  const mid = (i: number): [number, number] => {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  ctx.moveTo(...mid(0));
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    ctx.quadraticCurveTo(p[0], p[1], ...mid(i));
  }
  ctx.closePath();
  ctx.fill();
  // Droplets
  for (let i = 0; i < 4; i++) {
    const a = rnd(seed + 20 + i) * Math.PI * 2;
    const d = r * (1.1 + rnd(seed + 30 + i) * 0.6);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, r * 0.14 + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#9c6b3a";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.2, y - r * 0.15, r * 0.25, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTargetSplats(ctx: CanvasRenderingContext2D, splats: Splat[]): void {
  for (const s of splats) drawSplat(ctx, s.dx, s.dy, s.r, s.seed, 1);
}

function drawCar(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.w;
  const h = t.h;
  ctx.save();
  ctx.scale(t.facing, 1);
  // Body
  ctx.fillStyle = t.color;
  roundRect(ctx, -w / 2, -h * 0.62, w, h * 0.5, 8);
  ctx.fill();
  ctx.stroke();
  // Cabin
  ctx.beginPath();
  ctx.moveTo(-w * 0.32, -h * 0.6);
  ctx.lineTo(-w * 0.2, -h);
  ctx.lineTo(w * 0.18, -h);
  ctx.lineTo(w * 0.32, -h * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#bde0fe";
  ctx.beginPath();
  ctx.moveTo(-w * 0.26, -h * 0.64);
  ctx.lineTo(-w * 0.17, -h * 0.92);
  ctx.lineTo(-w * 0.02, -h * 0.92);
  ctx.lineTo(-w * 0.02, -h * 0.64);
  ctx.closePath();
  ctx.moveTo(w * 0.02, -h * 0.64);
  ctx.lineTo(w * 0.02, -h * 0.92);
  ctx.lineTo(w * 0.15, -h * 0.92);
  ctx.lineTo(w * 0.26, -h * 0.64);
  ctx.closePath();
  ctx.fill();
  // Headlight
  ctx.fillStyle = "#fff3b0";
  ctx.fillRect(w / 2 - 8, -h * 0.5, 6, 6);
  if (t.wedding) drawGetawayDecor(ctx, t, time);
  // Wheels
  for (const wx of [-w * 0.3, w * 0.3]) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(wx, -h * 0.12, h * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#adb5bd";
    ctx.beginPath();
    ctx.arc(wx, -h * 0.12, h * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  void time;
}

function drawPedestrian(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const walk = Math.sin(time * 9 + t.seed) * 0.5;
  const h = t.h;
  ctx.save();
  ctx.scale(t.facing, 1);
  ctx.lineCap = "round";
  // Legs
  ctx.lineWidth = 5;
  ctx.strokeStyle = OUTLINE;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.38);
    ctx.lineTo(Math.sin(walk * s) * 10, 0);
    ctx.stroke();
  }
  // Body
  ctx.lineWidth = 3;
  ctx.fillStyle = t.color;
  roundRect(ctx, -9, -h * 0.75, 18, h * 0.4, 6);
  ctx.fill();
  ctx.stroke();
  // Arms
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.68);
  ctx.lineTo(-Math.sin(walk) * 10, -h * 0.42);
  ctx.stroke();
  // Head
  ctx.lineWidth = 3;
  ctx.fillStyle = "#f1c27d";
  ctx.beginPath();
  ctx.arc(0, -h * 0.87, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Hat / hair
  ctx.fillStyle = t.seed % 2 > 1 ? "#3d405b" : "#6b4226";
  ctx.beginPath();
  ctx.arc(0, -h * 0.9, 8, Math.PI, Math.PI * 2);
  ctx.fill();
  // Eye
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(4, -h * 0.87, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineCap = "butt";
}

function drawStatue(ctx: CanvasRenderingContext2D, t: Target): void {
  const h = t.h;
  const w = t.w;
  // Plinth
  ctx.fillStyle = "#adb5bd";
  ctx.fillRect(-w / 2, -h * 0.3, w, h * 0.3);
  ctx.strokeRect(-w / 2, -h * 0.3, w, h * 0.3);
  ctx.fillStyle = "#6c757d";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("HERO", 0, -h * 0.12);
  // Figure (bronze-green)
  ctx.fillStyle = t.color;
  ctx.beginPath();
  ctx.moveTo(-12, -h * 0.3);
  ctx.lineTo(-9, -h * 0.72);
  ctx.lineTo(9, -h * 0.72);
  ctx.lineTo(12, -h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Raised arm
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(7, -h * 0.68);
  ctx.lineTo(20, -h * 0.95);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = t.color;
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  // Head
  ctx.fillStyle = t.color;
  ctx.beginPath();
  ctx.arc(0, -h * 0.8, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** The envelope outline: a dome on top, tapering down to the mouth. */
function envelopePath(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const rx = BALLOON_RX;
  const ry = BALLOON_RY;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + ry);
  ctx.bezierCurveTo(cx - rx * 0.75, cy + ry * 0.6, cx - rx, cy + ry * 0.25, cx - rx, cy - ry * 0.1);
  ctx.ellipse(cx, cy - ry * 0.1, rx, ry * 0.9, 0, Math.PI, Math.PI * 2);
  ctx.bezierCurveTo(cx + rx, cy + ry * 0.25, cx + rx * 0.75, cy + ry * 0.6, cx + 14, cy + ry);
  ctx.closePath();
}

/** A flame standing on (x, y): a teardrop `h` tall and `w` wide at its base. */
function flamePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 0.9, y - h * 0.55, x, y - h);
  ctx.quadraticCurveTo(x + w * 0.9, y - h * 0.55, x + w, y);
  ctx.closePath();
}

/** The popped envelope: a crumpled, flapping rag that falls and lies flat on the street. */
function drawRag(ctx: CanvasRenderingContext2D, b: Balloon, time: number): void {
  const r = b.rag!;
  if (r.x < -100) return;
  const flat = r.landed ? 0.45 : 1;
  const n = 12;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = r.landed ? 0 : Math.sin(time * 11 + i * 1.7 + b.seed) * 4;
    const rad = 26 + rnd(b.seed + i) * 14 + wob;
    pts.push({ x: r.x + Math.cos(a) * rad * 1.3, y: r.y + Math.sin(a) * rad * 0.7 * flat });
  }
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = b.colors[0];
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = b.colors[1];
  for (let i = -2; i <= 2; i += 2) {
    ctx.beginPath();
    ctx.ellipse(r.x + i * 14, r.y, 6, 40, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** A bailed-out balloon passenger: tumbling with arms flailing, then hanging under a striped canopy. */
function drawParachutist(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const c = t.chute!;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  if (c.open) {
    // Swing like a pendulum under the canopy; it pops open with a little overshoot.
    const age = c.t - c.openAt;
    const pop = age < 0.25 ? 0.4 + (age / 0.25) * 0.75 : 1.15 - Math.min(0.15, (age - 0.25) * 0.6);
    ctx.translate(0, -96);
    ctx.rotate(Math.sin(time * 1.8 + t.seed) * 0.13);
    ctx.translate(0, 96);
    // Lines
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const dx of [-25, -9, 9, 25]) {
      ctx.moveTo(dx * pop, -74);
      ctx.lineTo(Math.sign(dx) * 5, -38);
    }
    ctx.stroke();
    // Canopy with a white centre panel and a scalloped hem.
    ctx.save();
    ctx.translate(0, -76);
    ctx.scale(pop, pop);
    ctx.beginPath();
    ctx.arc(0, 0, 26, Math.PI, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const x0 = 26 - i * 13;
      ctx.quadraticCurveTo(x0 - 6.5, 6, x0 - 13, 0);
    }
    ctx.closePath();
    ctx.fillStyle = c.canopy;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(-6, -30, 12, 40);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  } else {
    // Tumbling
    ctx.translate(0, -24);
    ctx.rotate(c.t * 9 * (t.facing || 1));
    ctx.translate(0, 24);
  }
  const flail = c.open ? Math.sin(time * 3 + t.seed) * 0.2 : Math.sin(time * 30 + t.seed);
  // Legs
  ctx.lineWidth = 5;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(s * (5 + flail * 4), 0);
    ctx.stroke();
  }
  // Body (with a backpack)
  ctx.lineWidth = 3;
  ctx.fillStyle = "#6c757d";
  roundRect(ctx, -11 * t.facing - 3, -36, 6, 14, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.color;
  roundRect(ctx, -8, -38, 16, 21, 6);
  ctx.fill();
  ctx.stroke();
  // Arms: holding the lines, or windmilling.
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const s of [1, -1]) {
    ctx.moveTo(s * 5, -34);
    if (c.open) ctx.lineTo(s * 6, -46);
    else ctx.lineTo(s * 14 + flail * 6, -46 + s * flail * 8);
  }
  ctx.stroke();
  // Head, with a mouth wide open in freefall.
  ctx.lineWidth = 3;
  ctx.fillStyle = "#f1c27d";
  ctx.beginPath();
  ctx.arc(0, -45, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.seed % 2 > 1 ? "#3d405b" : "#6b4226";
  ctx.beginPath();
  ctx.arc(0, -47, 8, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(-3, -45, 1.4, 0, Math.PI * 2);
  ctx.arc(3, -45, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  if (c.open) ctx.arc(0, -41, 2, 0.1 * Math.PI, 0.9 * Math.PI);
  else ctx.ellipse(0, -40.5, 2.2, 3, 0, 0, Math.PI * 2);
  if (c.open) {
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else ctx.fill();
  ctx.restore();
  ctx.lineCap = "butt";
}

/** A drone's eye: a red LED with a glow. */
function drawLedEye(ctx: CanvasRenderingContext2D, x: number, y: number, glow: number): void {
  ctx.fillStyle = `rgba(255,45,45,${0.35 * glow})`;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff2d2d";
  ctx.beginPath();
  ctx.arc(x, y, 1.9, 0, Math.PI * 2);
  ctx.fill();
}

const WIRE_COLORS = ["#e63946", "#ffd166", "#3a86ff", "#06d6a0"];

/** Coloured wires curling out of a broken drone from (x, y), with bare copper ends that spark. */
function drawLooseWires(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, time: number, sparks: number): void {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < WIRE_COLORS.length; i++) {
    const r = Math.sin(seed * 7.3 + i * 12.9) * 0.5 + 0.5;
    const a = -Math.PI * (0.15 + 0.7 * (i + r * 0.8) / WIRE_COLORS.length);
    const len = 9 + r * 8;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const wob = Math.sin(time * 3 + i) * 1.5;
    ctx.strokeStyle = WIRE_COLORS[i];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.9) * len * 0.6, y + Math.sin(a + 0.9) * len * 0.6 + wob, ex, ey);
    ctx.stroke();
    // Bare copper tip
    ctx.strokeStyle = "#e09f3e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(a) * 2.5, ey + Math.sin(a) * 2.5);
    ctx.stroke();
    if (Math.sin(time * 23 + seed + i * 2.1) > 1 - sparks * 0.25) {
      // Spark: a little yellow burst
      const sx = ex + Math.cos(a) * 3;
      const sy = ey + Math.sin(a) * 3;
      ctx.strokeStyle = "#fff3b0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const b = (k / 4) * Math.PI + time * 9;
        ctx.moveTo(sx - Math.cos(b) * 3, sy - Math.sin(b) * 3);
        ctx.lineTo(sx + Math.cos(b) * 3, sy + Math.sin(b) * 3);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Jagged break across a drone's body, top to bottom (pigeon space). */
const DRONE_BREAK: [number, number][] = [[1, -23], [-2, -19], [2, -15], [-1, -11], [2, -7], [0, -2]];

/** Clips to one side of the break: the tail half (-1) or the head half (1). */
function clipDroneHalf(ctx: CanvasRenderingContext2D, side: 1 | -1): void {
  ctx.beginPath();
  ctx.moveTo(side * 40, -40);
  for (const [bx, by] of DRONE_BREAK) ctx.lineTo(bx, by);
  ctx.lineTo(0, 4);
  ctx.lineTo(side * 40, 4);
  ctx.closePath();
  ctx.clip();
}

/** The open break: circuitry inside a metal shell. */
function drawDroneInnards(ctx: CanvasRenderingContext2D, side: 1 | -1, seed: number): void {
  ctx.fillStyle = "#343a40";
  ctx.beginPath();
  ctx.ellipse(0, -12, 3.5, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // A sliver of green circuit board with solder dots
  ctx.fillStyle = "#2d6a4f";
  ctx.fillRect(-1.5 + side, -17, 3, 9);
  ctx.fillStyle = "#e9c46a";
  for (let i = 0; i < 3; i++) ctx.fillRect(-0.5 + side, -15.5 + i * 3 + (seed % 1), 1, 1);
  // The torn edge, metallic
  ctx.strokeStyle = "#adb5bd";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  DRONE_BREAK.forEach(([bx, by], i) => (i ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by)));
  ctx.stroke();
}

/** A pigeon drone broken in two on the street: the halves apart, wires spilling out, its eye still blinking. */
function drawDroneWreck(ctx: CanvasRenderingContext2D, w: DroneWreck, seed: number, facing: 1 | -1, time: number): void {
  ctx.save();
  ctx.translate(w.x, w.y);
  // A bit bigger than a live pigeon, so the guts read at a glance.
  ctx.scale(PIGEON_SCALE * 1.3 * facing, PIGEON_SCALE * 1.3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  // Smoke curling up from the break
  for (let i = 0; i < 3; i++) {
    const k = (time * 0.6 + i / 3 + seed) % 1;
    ctx.fillStyle = `rgba(108,117,125,${0.35 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(Math.sin(k * 5 + i) * 4, -10 - k * 34, 3 + k * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tail half, on its belly, rocked back from the break
  ctx.save();
  ctx.translate(-5, 0);
  ctx.rotate(-0.18);
  ctx.save();
  clipDroneHalf(ctx, -1);
  ctx.fillStyle = "#5c6370";
  ctx.beginPath();
  ctx.moveTo(-8, -12);
  ctx.lineTo(-19, -9);
  ctx.lineTo(-17, -4);
  ctx.lineTo(-6, -8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#9aa3ad";
  ctx.beginPath();
  ctx.ellipse(0, -12, 12, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#7d8691";
  ctx.beginPath();
  ctx.ellipse(-5, -14, 8, 4.5, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawDroneInnards(ctx, -1, seed);
  ctx.restore();
  drawSplat(ctx, -6, -15, 5, seed, 1);
  ctx.restore();

  // Head half, nosed over forward onto its beak
  ctx.save();
  ctx.translate(6, 0);
  ctx.rotate(0.45);
  ctx.save();
  clipDroneHalf(ctx, 1);
  ctx.fillStyle = "#9aa3ad";
  ctx.beginPath();
  ctx.ellipse(0, -12, 12, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawDroneInnards(ctx, 1, seed);
  ctx.restore();
  ctx.fillStyle = "#6a994e";
  ctx.beginPath();
  ctx.ellipse(7, -16, 4.5, 4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8a92a0";
  ctx.beginPath();
  ctx.arc(10, -20, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e9c46a";
  ctx.beginPath();
  ctx.moveTo(14, -21);
  ctx.lineTo(19, -19);
  ctx.lineTo(14, -18);
  ctx.closePath();
  ctx.fill();
  // A bent antenna popped out of its head
  ctx.strokeStyle = "#adb5bd";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(9, -25);
  ctx.lineTo(7, -31);
  ctx.lineTo(11, -35);
  ctx.stroke();
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.arc(11, -35, 1.4, 0, Math.PI * 2);
  ctx.fill();
  // Still recording.
  if (Math.sin(time * 6 + seed) > -0.3) drawLedEye(ctx, 11.5, -21.5, 1);
  else {
    ctx.fillStyle = "#6a040f";
    ctx.beginPath();
    ctx.arc(11.5, -21.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Wires spilling across the gap between the halves
  drawLooseWires(ctx, 0, -10, seed, time, 1);
  ctx.restore();
}

function drawX(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

type RGB = [number, number, number];

// --- pufferfish body -----------------------------------------------------------

interface FishShape {
  /** Half length, nose to tail root. */
  L: number;
  /** Height above the midline (back). */
  H: number;
  /** Depth below the midline (belly). */
  B: number;
  /** Half height of the tail root. */
  q: number;
  /** Mouth height. */
  noseY: number;
}

/** Slim torpedo at puff 0, ball with a sagging belly at puff 1 (r already grows with puff). */
function fishShape(r: number, puff: number): FishShape {
  const lerp = (a: number, b: number) => a + (b - a) * puff;
  const H = r * lerp(0.74, 0.9);
  return { L: r * lerp(1.42, 1.06), H, B: r * lerp(0.7, 1.08), q: BIRD_RADIUS * 0.24, noseY: H * 0.12 };
}

function fishBodyPath(ctx: CanvasRenderingContext2D, s: FishShape): void {
  const { L, H, B, q, noseY } = s;
  ctx.beginPath();
  ctx.moveTo(L, noseY - B * 0.12);
  ctx.bezierCurveTo(L, -H * 0.7, L * 0.5, -H, L * 0.05, -H);
  ctx.bezierCurveTo(-L * 0.5, -H, -L * 0.8, -q * 1.4, -L, -q);
  ctx.lineTo(-L, q);
  ctx.bezierCurveTo(-L * 0.8, q * 1.4, -L * 0.5, B, L * 0.05, B);
  ctx.bezierCurveTo(L * 0.55, B, L, B * 0.65, L, noseY + B * 0.12);
  ctx.closePath();
}

/** A point on the rear back (dir −1) or rear belly (dir 1) outline, t from the crown (0) to the tail root (1). */
function fishEdgePoint(s: FishShape, dir: number, t: number): { x: number; y: number } {
  const { L, q } = s;
  const R = dir < 0 ? s.H : s.B;
  const u = 1 - t;
  const bez = (p0: number, p1: number, p2: number, p3: number) =>
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  return { x: bez(L * 0.05, -L * 0.5, -L * 0.8, -L), y: dir * bez(R, R, q * 1.4, q) };
}

/** Dark spots as [u, v, size]: u along the body (−1 tail … 1 nose), v up (−) or down (+) as a fraction of H or B. */
const FISH_SPOTS: [number, number, number][] = [
  [-0.05, 0.02, 1.1], [0.15, -0.1, 0.9], [-0.28, -0.08, 1.2], [-0.5, 0.0, 1.0], [-0.68, -0.12, 0.85],
  [-0.84, 0.02, 0.65], [-0.2, 0.2, 0.9], [-0.42, 0.22, 0.8], [-0.62, 0.18, 0.7], [0.08, 0.2, 0.75],
  [-0.35, -0.42, 0.9], [-0.6, -0.36, 0.8], [-0.1, -0.5, 0.8], [0.18, -0.55, 0.65], [-0.8, -0.3, 0.55],
  [0.38, -0.25, 0.55], [0.3, -0.72, 0.55],
];

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c: RGB, d: number): string {
  return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v + d)))).join(",")})`;
}

/** `shade` for a "#rrggbb" colour. */
function shadeHex(hex: string, d: number): string {
  const n = parseInt(hex.slice(1), 16);
  return shade([(n >> 16) & 255, (n >> 8) & 255, n & 255], d);
}

function rgb(c: RGB): string {
  return `rgb(${c.map((v) => Math.round(v)).join(",")})`;
}

// --- paparazzi --------------------------------------------------------------

function drawPaparazzo(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const p = t.pap;
  if (!p) return;
  // Drawn a bit larger than a pedestrian so the camera reads at a glance.
  const k = 1.2;
  const h = t.h / k;
  const snapped = p.state === "snapped";
  const smashed = p.state === "smashed";
  // Walking while he closes in (only the first one actually moves), a victory hop once he has the shot.
  const walking = p.state === "watching" && t.speed !== 0;
  const stride = walking ? Math.sin(time * 9 + t.seed) * 0.5 : 0;
  const hop = snapped ? Math.abs(Math.sin(time * 10 + t.seed)) * 5 : 0;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(0, -hop);
  ctx.lineCap = "round";

  // Legs
  ctx.lineWidth = 5;
  ctx.strokeStyle = OUTLINE;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.38);
    ctx.lineTo(walking ? Math.sin(stride * s) * 10 : s * 6, 0);
    ctx.stroke();
  }
  // Trench coat
  ctx.lineWidth = 3;
  ctx.fillStyle = "#c9a66b";
  ctx.beginPath();
  ctx.moveTo(-9, -h * 0.78);
  ctx.lineTo(9, -h * 0.78);
  ctx.lineTo(12, -h * 0.3);
  ctx.lineTo(-12, -h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.76);
  ctx.lineTo(0, -h * 0.32);
  ctx.moveTo(-11, -h * 0.5);
  ctx.lineTo(11, -h * 0.5);
  ctx.stroke();

  // Head
  const headY = -h * 0.88;
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = "#f1c27d";
  ctx.beginPath();
  ctx.arc(0, headY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Fedora with a PRESS card
  ctx.fillStyle = "#3d405b";
  ctx.fillRect(-12, headY - 6, 24, 4);
  ctx.strokeRect(-12, headY - 6, 24, 4);
  roundRect(ctx, -8, headY - 15, 16, 10, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillRect(-5, headY - 13, 9, 5);
  ctx.fillStyle = "#d62828";
  ctx.font = "900 4px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PRESS", -0.5, headY - 10.5);
  // Shades, or a scowl once the camera's gone
  ctx.fillStyle = OUTLINE;
  if (smashed) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, headY - 2);
    ctx.lineTo(-2, headY);
    ctx.moveTo(6, headY - 2);
    ctx.lineTo(2, headY);
    ctx.moveTo(-3, headY + 5);
    ctx.quadraticCurveTo(0, headY + 3, 3, headY + 5);
    ctx.stroke();
  } else {
    ctx.fillRect(-7, headY - 2, 14, 4);
    // Grin once he has the shot
    if (snapped) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, headY + 3, 3.5, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }

  // Camera: aimed at the bird while watching, held up in triumph after the shot, drooping when smashed.
  const shoulderY = -h * 0.72;
  const aim = smashed ? 1.3 : snapped ? -Math.PI / 2 - 0.3 : p.aim;
  const camDist = snapped ? 14 : 8;
  const camX = Math.cos(aim) * camDist;
  const camY = shoulderY + Math.sin(aim) * camDist;
  // Arms to the camera
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(-4, shoulderY + 2);
  ctx.lineTo(camX, camY);
  ctx.moveTo(4, shoulderY + 2);
  ctx.lineTo(camX, camY + 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(camX, camY);
  ctx.rotate(aim);
  if (Math.cos(aim) < 0) ctx.scale(1, -1); // keep the flash unit on top
  ctx.lineWidth = 2.5;
  // Body
  ctx.fillStyle = "#2b2d42";
  roundRect(ctx, -9, -7, 16, 13, 2);
  ctx.fill();
  ctx.stroke();
  // Flash unit
  ctx.fillStyle = "#adb5bd";
  ctx.fillRect(-6, -13, 8, 6);
  ctx.strokeRect(-6, -13, 8, 6);
  // Long lens
  ctx.fillStyle = "#495057";
  ctx.fillRect(6, -5, 18, 10);
  ctx.strokeRect(6, -5, 18, 10);
  ctx.fillStyle = smashed ? "#6c757d" : "#8ecae6";
  ctx.fillRect(23, -4, 3, 8);
  if (smashed) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, -4);
    ctx.lineTo(15, 1);
    ctx.lineTo(12, 4);
    ctx.moveTo(15, 1);
    ctx.lineTo(21, -3);
    ctx.stroke();
  }
  // Red light, blinking faster as the timer fills
  if (p.state === "watching" && Math.sin(time * (8 + p.timer * 30)) > 0) {
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(-4, -1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Flash burst
  if (p.flash > 0) {
    const k = p.flash / 0.25;
    ctx.fillStyle = `rgba(255,255,220,${k})`;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 8 : 26 + (1 - k) * 20;
      ctx.lineTo(-2 + Math.cos(a) * r, -10 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
  ctx.lineCap = "butt";
}

/**
 * A slingshot kid: propeller beanie, striped shirt, and a slingshot whose band
 * stretches back as he winds up. `t.x, t.y` is the origin (his feet).
 */
function drawKid(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const k = t.kid;
  if (!k) return;
  // Drawn larger than his proportions suggest, so the slingshot reads at a glance.
  const scale = KID_SCALE;
  const h = t.h / scale;
  const f = t.facing;
  const moving = t.speed !== 0;
  const stride = moving ? Math.sin(time * (k.state === "crying" ? 18 : 11) + t.seed) * 0.6 : 0;
  const hop =
    k.state === "cheering" ? Math.abs(Math.sin(time * 11 + t.seed)) * 9 :
    k.state === "taunting" ? Math.abs(Math.sin(time * 7 + t.seed)) * 3 : 0;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(0, -hop);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const hipY = -h * 0.34;
  const shoulderY = -h * 0.62;
  const headY = -h * 0.8;

  // Legs (planted wide while aiming) and sneakers
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  const aiming = k.state === "aiming" || k.state === "reloading";
  const feet: number[] = [];
  for (const s of [1, -1]) {
    const footX = moving ? Math.sin(stride * s) * 9 : aiming ? s * 7 : s * 4;
    feet.push(footX);
    ctx.beginPath();
    ctx.moveTo(s * 3, hipY);
    ctx.lineTo(footX, -2);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 2;
  for (const fx of feet) {
    roundRect(ctx, fx - 3 + f * 1, -5, 8, 5, 2);
    ctx.fill();
    ctx.stroke();
  }
  // Shorts
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "#3a86ff";
  roundRect(ctx, -8, -h * 0.44, 16, h * 0.13, 3);
  ctx.fill();
  ctx.stroke();
  // Striped shirt
  ctx.save();
  roundRect(ctx, -8.5, -h * 0.68, 17, h * 0.27, 5);
  ctx.fillStyle = t.color;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let i = 0; i < 4; i++) ctx.fillRect(-10, -h * 0.66 + i * 3.4, 20, 1.6);
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  roundRect(ctx, -8.5, -h * 0.68, 17, h * 0.27, 5);
  ctx.stroke();

  // Arms and slingshot (screen space, so the aim angle works both ways)
  drawKidArms(ctx, t, time, shoulderY);

  // Head
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = "#f1c27d";
  ctx.beginPath();
  ctx.arc(0, headY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Propeller beanie: spins faster when he's excited
  const cap = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4"];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cap[i];
    ctx.beginPath();
    ctx.moveTo(0, headY - 3);
    ctx.arc(0, headY - 3, 10.5, Math.PI + (i * Math.PI) / 4, Math.PI + ((i + 1) * Math.PI) / 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, headY - 3, 10.5, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, headY - 13);
  ctx.lineTo(0, headY - 18);
  ctx.stroke();
  const spin = time * (k.state === "cheering" || k.state === "crying" ? 40 : k.state === "aiming" ? 6 + k.pull * 30 : 12) + t.seed;
  const blade = Math.cos(spin) * 9;
  ctx.fillStyle = "#ffca3a";
  ctx.beginPath();
  ctx.ellipse(blade / 2, headY - 18, Math.abs(blade / 2) + 0.8, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(-blade / 2, headY - 18, Math.abs(blade / 2) + 0.8, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Face (facing direction)
  ctx.save();
  ctx.scale(f, 1);
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.8;
  const ey = headY + 1;
  if (k.state === "crying") {
    // Squeezed-shut eyes and a wailing mouth
    for (const ex of [1, 7]) {
      ctx.beginPath();
      ctx.moveTo(ex - 2.5, ey - 1);
      ctx.lineTo(ex + 0.5, ey + 1);
      ctx.lineTo(ex - 2.5, ey + 2.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(4, headY + 6.5, 3, 3.5 + Math.sin(time * 20) * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (k.state === "aiming") {
    // One eye squinted, tongue poking out in concentration
    ctx.beginPath();
    ctx.arc(7, ey, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.5, ey);
    ctx.lineTo(3, ey);
    ctx.stroke();
    ctx.fillStyle = "#ff8fab";
    ctx.beginPath();
    ctx.ellipse(7.5, headY + 6.5, 2.2, 1.8, 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(1.5, ey, 1.6, 0, Math.PI * 2);
    ctx.arc(7, ey, 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (k.state === "taunting") {
      // Nyah nyah: big tongue out
      ctx.beginPath();
      ctx.arc(4.5, headY + 5.5, 3, 0, Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#ff5d8f";
      roundRect(ctx, 3, headY + 6, 3.4, 4.5 + Math.sin(time * 9) * 1, 1.7);
      ctx.fill();
    } else if (k.state === "cheering") {
      ctx.fillStyle = "#6a040f";
      ctx.beginPath();
      ctx.arc(4.5, headY + 5, 3.5, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    } else {
      // A cheeky grin
      ctx.beginPath();
      ctx.arc(3.5, headY + 4, 3.5, 0.3, Math.PI - 0.6);
      ctx.stroke();
    }
  }
  // Freckles
  ctx.fillStyle = "#c68642";
  for (const [fx, fy] of [[-1, 3.5], [1, 4.8], [8.5, 4], [6.8, 5.2]]) ctx.fillRect(fx, headY + fy, 1.1, 1.1);
  ctx.restore();

  // Tears fountaining off both sides
  if (k.state === "crying") {
    ctx.fillStyle = "#8ecae6";
    for (let i = 0; i < 6; i++) {
      const ph = (time * 2.6 + i / 6) % 1;
      const side = i % 2 ? 1 : -1;
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.arc(side * (6 + ph * 22), headY + 1 - ph * 10 + ph * ph * 34, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Warning: a "!" that grows and flashes as the band stretches
  if (k.state === "aiming") {
    const s = 0.8 + k.pull * 0.6;
    const flash = k.pull > 0.65 && Math.sin(time * 30) > 0;
    ctx.save();
    ctx.translate(0, headY - 34 - k.pull * 4);
    ctx.scale(s, s);
    ctx.fillStyle = flash ? "#fff" : "#ff3b3b";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = flash ? "#ff3b3b" : "#fff";
    ctx.font = "900 17px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 0, 1);
    ctx.restore();
  }
  ctx.restore();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

function drawKidArms(ctx: CanvasRenderingContext2D, t: Target, time: number, shoulderY: number): void {
  const k = t.kid!;
  const f = t.facing;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.5;
  const arm = (x: number, y: number) => {
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + 1);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  if (k.state === "crying") {
    // Arms flailing over his head, slingshot dropped
    const w = Math.sin(time * 22) * 4;
    arm(-8 + w, shoulderY - 12);
    arm(8 - w, shoulderY - 12);
    return;
  }
  if (k.state === "cheering") {
    const wave = Math.sin(time * 14) * 3;
    arm(-15, shoulderY - 15 + wave);
    drawSlingshotFork(ctx, 15, shoulderY - 15 - wave, -Math.PI / 2, 0, 0, false);
    arm(15, shoulderY - 15 - wave);
    return;
  }
  if (k.state === "taunting" || k.state === "walking" || (k.state === "reloading" && t.speed !== 0)) {
    // Slingshot dangling at his side; when taunting, a waggle at the bird
    const swing = Math.sin(time * 11 + t.seed) * 3;
    drawSlingshotFork(ctx, -f * 6, shoulderY + 14 + swing, Math.PI / 2, 0, 0, false);
    arm(-f * 6, shoulderY + 14 + swing);
    if (k.state === "taunting") {
      const wag = Math.sin(time * 16) * 3;
      arm(f * 11, shoulderY - 8 + wag);
    } else arm(f * 6, shoulderY + 13 - swing);
    return;
  }
  // Aiming / reloading: front arm out along the aim, back hand pulls the pouch.
  const a = Math.atan2(k.aimVy, k.aimVx);
  const forkX = Math.cos(a) * 13;
  const forkY = shoulderY + Math.sin(a) * 13;
  const pull = k.state === "aiming" ? k.pull : 0;
  const shake = pull > 0.8 ? (Math.random() - 0.5) * 1.5 : 0;
  const twang = k.twang > 0 ? Math.sin(time * 90) * k.twang * 20 : 0;
  const back = 4 + pull * 15 - twang;
  drawSlingshotFork(ctx, forkX + shake, forkY + shake, a, back, pull, k.state === "aiming");
  arm(forkX + shake, forkY + shake);
  arm(forkX - Math.cos(a) * back, forkY - Math.sin(a) * back);
}

/**
 * A Y-shaped slingshot at (x, y), shooting along angle `a`. The band runs from
 * the prong tips back to a pouch `back` px behind the fork.
 */
function drawSlingshotFork(
  ctx: CanvasRenderingContext2D, x: number, y: number, a: number, back: number, pull: number, loaded: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  // In this frame +x is the shot direction; the prongs point "up" (-y) across it.
  const tipA = { x: 2, y: -8 };
  const tipB = { x: -1, y: -9 };
  ctx.lineCap = "round";
  // Band behind
  ctx.strokeStyle = pull > 0.7 ? "#d00000" : "#9d0208";
  ctx.lineWidth = 1.6 + (1 - pull) * 0.6;
  ctx.beginPath();
  ctx.moveTo(tipB.x, tipB.y);
  ctx.lineTo(-back, -4);
  ctx.lineTo(tipA.x, tipA.y);
  ctx.stroke();
  // Wooden fork
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -2);
  ctx.lineTo(tipA.x, tipA.y);
  ctx.moveTo(0, -2);
  ctx.lineTo(tipB.x, tipB.y);
  ctx.stroke();
  ctx.strokeStyle = "#a47148";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // Pebble in the pouch
  if (loaded) {
    ctx.fillStyle = "#8d99ae";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-back, -4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A pebble: a lumpy grey rock with a speed streak. */
function drawPebble(ctx: CanvasRenderingContext2D, p: Pebble): void {
  const sp = Math.hypot(p.vx, p.vy) || 1;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = PEBBLE_R * 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - (p.vx / sp) * 26, p.y - (p.vy / sp) * 26);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = "#8d99ae";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    // Drawn a bit larger than its hit radius so it reads in flight.
    const r = PEBBLE_R * 1.35 * (0.85 + 0.3 * rnd(i * 13.7 + p.from.seed));
    ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.arc(-1.5, -1.5, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draws `photo` cover-cropped into the rect, or a "no photo" placeholder. */
function drawPhoto(ctx: CanvasRenderingContext2D, photo: Photo | undefined, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (photo && photo.width > 0 && photo.height > 0) {
    const s = Math.max(w / photo.width, h / photo.height);
    const dw = photo.width * s;
    const dh = photo.height * s;
    ctx.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#495057";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#adb5bd";
    ctx.font = `900 ${Math.round(h * 0.5)}px 'Trebuchet MS', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x + w / 2, y + h / 2);
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

/** Breaks `text` into lines that fit `maxWidth` in the current font. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A tabloid front page with the photo and headline, laid out to fit w×h (for
 * the game-over screen; the billboard uses drawBillboardAd).
 */
export function drawFrontPage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tabloid: Tabloid | null,
  photos: ReadonlyMap<number, Photo>,
): void {
  const pad = w * 0.06;
  ctx.save();
  // Paper
  ctx.fillStyle = "#f5f1e6";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // Masthead
  const mastH = h * 0.14;
  ctx.fillStyle = "#d62828";
  ctx.fillRect(x + 1.5, y + 1.5, w - 3, mastH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = mastH * 0.62;
  ctx.font = `italic 900 ${size}px Georgia, 'Times New Roman', serif`;
  const mast = "The Daily Dropping";
  const mw = ctx.measureText(mast).width;
  if (mw > w - pad * 2) {
    size *= (w - pad * 2) / mw;
    ctx.font = `italic 900 ${size}px Georgia, 'Times New Roman', serif`;
  }
  ctx.fillText(mast, x + w / 2, y + 1.5 + mastH / 2 + 1);

  // Headline
  const headline = tabloid?.headline ?? "EXCLUSIVE";
  let hs = w * 0.13;
  let lines: string[] = [];
  for (; hs > 6; hs *= 0.9) {
    ctx.font = `900 ${hs}px Impact, 'Arial Black', 'Trebuchet MS', sans-serif`;
    lines = wrapText(ctx, headline, w - pad * 2);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= w - pad * 2)) break;
  }
  ctx.fillStyle = "#111";
  const headTop = y + mastH + pad * 0.8;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, headTop + hs * (0.55 + i * 1.02)));

  // Photo
  const photoTop = headTop + hs * (lines.length * 1.02 + 0.2);
  const footer = h * 0.12;
  const photoH = Math.max(10, y + h - footer - photoTop);
  drawPhoto(ctx, tabloid ? photos.get(tabloid.photoId) : undefined, x + pad, photoTop, w - pad * 2, photoH);
  // EXCLUSIVE badge
  ctx.save();
  ctx.translate(x + w - pad - w * 0.12, photoTop + w * 0.1);
  ctx.rotate(0.3);
  drawStar(ctx, 0, 0, w * 0.15, "#ffd60a");
  ctx.fillStyle = "#d62828";
  ctx.font = `900 ${w * 0.045}px 'Trebuchet MS', sans-serif`;
  ctx.fillText("EXCL!", 0, 1);
  ctx.restore();
  // Body text
  ctx.fillStyle = "#adb5bd";
  const lineH = footer / 3;
  for (let i = 0; i < 2; i++) {
    const ly = y + h - footer + lineH * (i + 0.8);
    ctx.fillRect(x + pad, ly, (w - pad * 2) * (i ? 0.7 : 1), Math.max(1.5, lineH * 0.35));
  }
  ctx.restore();
}

/** The billboard's landscape layout: masthead across the top, the photo on the left, the headline beside it. */
function drawBillboardAd(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tabloid: Tabloid | null,
  photos: ReadonlyMap<number, Photo>,
): void {
  const pad = 6;
  ctx.save();
  ctx.fillStyle = "#f5f1e6";
  ctx.fillRect(x, y, w, h);
  // Masthead
  const mastH = h * 0.2;
  ctx.fillStyle = "#d62828";
  ctx.fillRect(x, y, w, mastH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `italic 900 ${mastH * 0.66}px Georgia, 'Times New Roman', serif`;
  ctx.fillText("The Daily Dropping", x + w / 2, y + mastH / 2 + 1, w - pad * 2);

  // Photo on the left
  const photoY = y + mastH + pad;
  const photoH = y + h - pad - photoY;
  const photoW = Math.min(photoH * 0.95, w * 0.45);
  drawPhoto(ctx, tabloid ? photos.get(tabloid.photoId) : undefined, x + pad, photoY, photoW, photoH);

  // Headline on the right, as big as fits in up to 4 lines
  const tx = x + pad * 2 + photoW;
  const tw = x + w - pad - tx;
  const headline = tabloid?.headline ?? "EXCLUSIVE";
  let hs = photoH * 0.34;
  let lines: string[] = [];
  for (; hs > 6; hs *= 0.92) {
    ctx.font = `900 ${hs}px Impact, 'Arial Black', 'Trebuchet MS', sans-serif`;
    lines = wrapText(ctx, headline, tw);
    if (lines.length * hs * 1.05 <= photoH && lines.every((l) => ctx.measureText(l).width <= tw)) break;
  }
  ctx.fillStyle = "#111";
  const textTop = photoY + (photoH - lines.length * hs * 1.05) / 2;
  lines.forEach((l, i) => ctx.fillText(l, tx + tw / 2, textTop + hs * (0.55 + i * 1.05)));

  // EXCLUSIVE badge on the photo's corner
  ctx.save();
  ctx.translate(x + pad + photoW - 4, photoY + 6);
  ctx.rotate(0.3);
  drawStar(ctx, 0, 0, 18, "#ffd60a");
  ctx.fillStyle = "#d62828";
  ctx.font = "900 7px 'Trebuchet MS', sans-serif";
  ctx.fillText("EXCL!", 0, 1);
  ctx.restore();
  ctx.restore();
}

// --- wedding -----------------------------------------------------------------

/** Black-outlined bold text, centred. */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `900 ${Math.round(size)}px 'Trebuchet MS', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.lineJoin = "miter";
}

/** A heart centred roughly on (x, y), `r` about half its width. */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.95);
  ctx.bezierCurveTo(x - r * 1.7, y - r * 0.15, x - r * 0.75, y - r * 1.3, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.75, y - r * 1.3, x + r * 1.7, y - r * 0.15, x, y + r * 0.95);
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  heartPath(ctx, x, y, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Shine
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.5, y - r * 0.45, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Lean, hop and kiss of the couple, from how the wedding is going. */
function couplePose(w: Wedding, time: number): { lean: number; hop: number; kissing: boolean } {
  if (w.phase === "countdown") return { lean: (4 - w.count) * 0.05, hop: 0, kissing: false };
  if (w.phase === "kiss") return { lean: 0.32, hop: 0, kissing: true };
  if (w.outcome === "married") return { lean: 0, hop: Math.abs(Math.sin(time * 9)) * 4, kissing: false };
  return { lean: 0, hop: 0, kissing: false };
}

/** A hand-tied bouquet: stems and a ribbon below, flowers on top. (x, y) is where it's held. */
function drawBouquetFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = "#2d6a4f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const dx of [-3, 0, 3]) {
    ctx.moveTo(dx * 0.5, 0);
    ctx.lineTo(dx, 9);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffb3c6";
  ctx.fillRect(-3, 1, 6, 3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  const flowers: [number, number, string][] = [
    [-5, -3, "#fb6f92"], [5, -3, "#ffffff"], [0, -7, "#ff8fab"], [-3, -9, "#ffffff"], [4, -9, "#c9184a"], [0, -2, "#ffe5ec"],
  ];
  ctx.fillStyle = "#52b788";
  ctx.beginPath();
  ctx.ellipse(-7, -1, 4, 2, -0.5, 0, Math.PI * 2);
  ctx.ellipse(7, -1, 4, 2, 0.5, 0, Math.PI * 2);
  ctx.fill();
  for (const [fx, fy, c] of flowers) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(fx, fy, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** The flying bouquet: tossed (catch it!) or thrown in fury. */
function drawBouquet(ctx: CanvasRenderingContext2D, q: Bouquet): void {
  if (!q.angry) {
    ctx.fillStyle = "rgba(255,240,170,0.35)";
    ctx.beginPath();
    ctx.arc(q.x, q.y - 4, BOUQUET_R + 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(q.x, q.y);
  ctx.rotate(q.rot);
  drawBouquetFlowers(ctx, 0, 4, 1.4);
  ctx.restore();
  if (!q.angry) outlinedText(ctx, "CATCH!", q.x, q.y - BOUQUET_R - 22, 16, "#ffb3c6");
}

/** A released white dove, flapping hard. */
function drawDove(ctx: CanvasRenderingContext2D, d: Dove, time: number): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(d.vx < 0 ? -1.2 : 1.2, 1.2);
  ctx.rotate(-0.4);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.fillStyle = "#ffffff";
  // Tail
  ctx.beginPath();
  ctx.moveTo(-7, -1);
  ctx.lineTo(-16, -4);
  ctx.lineTo(-15, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Body and head
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(9, -4, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f4a261";
  ctx.beginPath();
  ctx.moveTo(13, -5);
  ctx.lineTo(17, -3.5);
  ctx.lineTo(13, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(10, -5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  // Wing
  const flap = Math.sin(time * 22 + d.seed) * 1.1;
  ctx.save();
  ctx.translate(-1, -3);
  ctx.rotate(-0.3 + flap * 0.8);
  ctx.fillStyle = "#f1f3f5";
  ctx.beginPath();
  ctx.ellipse(-2, -7, 5, 9, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * The church: a nave with stained-glass windows, a tower with a swinging
 * bell, a door with a ribbon, and a spire whose tip is the gap's bottom edge.
 */
function drawChurch(ctx: CanvasRenderingContext2D, o: Obstacle, time: number): void {
  const { cx, towerTop, naveTop } = churchGeometry(o);
  const x = o.x;
  const w = o.w;
  const tw = CHURCH_TOWER_W;
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  // Nave roof and walls
  ctx.fillStyle = "#a44a3f";
  ctx.beginPath();
  ctx.moveTo(x - 8, naveTop + 2);
  ctx.lineTo(x + 6, naveTop - 16);
  ctx.lineTo(x + w - 6, naveTop - 16);
  ctx.lineTo(x + w + 8, naveTop + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = o.color;
  ctx.fillRect(x, naveTop, w, GROUND_Y - naveTop + 4);
  ctx.strokeRect(x, naveTop, w, GROUND_Y - naveTop + 4);

  // Stained-glass windows either side of the tower
  const winH = Math.min(50, GROUND_Y - naveTop - 34);
  if (winH > 16) {
    for (const wx of [x + (w - tw) / 4, x + w - (w - tw) / 4]) {
      const top = naveTop + 16;
      ctx.beginPath();
      ctx.moveTo(wx - 9, top + winH);
      ctx.lineTo(wx - 9, top + 9);
      ctx.arc(wx, top + 9, 9, Math.PI, 0);
      ctx.lineTo(wx + 9, top + winH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, top + winH);
      g.addColorStop(0, "#ff8fab");
      g.addColorStop(0.45, "#5390d9");
      g.addColorStop(1, "#ffd166");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(wx, top);
      ctx.lineTo(wx, top + winH);
      ctx.moveTo(wx - 9, top + winH * 0.55);
      ctx.lineTo(wx + 9, top + winH * 0.55);
      ctx.stroke();
      ctx.lineWidth = 3;
    }
  }
  // Bunting along the eaves
  const flags = ["#ff8fab", "#ffffff", "#ffd166", "#a2d2ff"];
  ctx.lineWidth = 1.5;
  for (const [x0, x1] of [[x + 4, cx - tw / 2], [cx + tw / 2, x + w - 4]]) {
    const n = Math.max(1, Math.floor((x1 - x0) / 11));
    for (let i = 0; i < n; i++) {
      const fx = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const sag = Math.sin(((i + 0.5) / n) * Math.PI) * 4;
      ctx.fillStyle = flags[i % flags.length];
      ctx.beginPath();
      ctx.moveTo(fx - 4.5, naveTop + 3 + sag);
      ctx.lineTo(fx + 4.5, naveTop + 3 + sag);
      ctx.lineTo(fx, naveTop + 12 + sag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.lineWidth = 3;

  // Tower
  ctx.fillStyle = "#e9dcc3";
  ctx.fillRect(cx - tw / 2, towerTop, tw, GROUND_Y - towerTop + 4);
  ctx.strokeRect(cx - tw / 2, towerTop, tw, GROUND_Y - towerTop + 4);
  const towerH = GROUND_Y - towerTop;
  const by = towerTop + 10;
  if (towerH > 110) {
    // Belfry with the bell swinging
    ctx.fillStyle = "#3d405b";
    ctx.beginPath();
    ctx.moveTo(cx - 13, by + 36);
    ctx.lineTo(cx - 13, by + 13);
    ctx.arc(cx, by + 13, 13, Math.PI, 0);
    ctx.lineTo(cx + 13, by + 36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 13, by - 2, 26, 38);
    ctx.clip();
    ctx.translate(cx, by + 6);
    ctx.rotate(Math.sin(time * 5) * 0.55);
    ctx.fillStyle = "#e9c46a";
    ctx.beginPath();
    ctx.moveTo(-10, 22);
    ctx.quadraticCurveTo(-9, 4, 0, 3);
    ctx.quadraticCurveTo(9, 4, 10, 22);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#b08968";
    ctx.beginPath();
    ctx.arc(0, 23, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (towerH > 160) {
    // Rose window
    const ry = by + 62;
    ctx.fillStyle = "#ff8fab";
    ctx.beginPath();
    ctx.arc(cx, ry, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.moveTo(cx, ry);
      ctx.lineTo(cx + Math.cos(a) * 11, ry + Math.sin(a) * 11);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(cx, ry, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 3;
  }
  // Door with a ribbon bow
  ctx.fillStyle = "#6b4226";
  ctx.beginPath();
  ctx.moveTo(cx - 15, GROUND_Y + 2);
  ctx.lineTo(cx - 15, GROUND_Y - 30);
  ctx.arc(cx, GROUND_Y - 30, 15, Math.PI, 0);
  ctx.lineTo(cx + 15, GROUND_Y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, GROUND_Y - 45);
  ctx.lineTo(cx, GROUND_Y);
  ctx.stroke();
  ctx.fillStyle = "#ffb3c6";
  ctx.beginPath();
  ctx.ellipse(cx - 6, GROUND_Y - 50, 6, 4, -0.3, 0, Math.PI * 2);
  ctx.ellipse(cx + 6, GROUND_Y - 50, 6, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, GROUND_Y - 50, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 3;

  // Spire with a cross on the tip
  ctx.fillStyle = "#5c677d";
  ctx.beginPath();
  ctx.moveTo(cx - tw / 2 - 5, towerTop);
  ctx.lineTo(cx, o.gapBottom);
  ctx.lineTo(cx + tw / 2 + 5, towerTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = o.gapBottom + (CHURCH_SPIRE_H * i) / 4;
    const half = ((tw / 2 + 5) * i) / 4;
    ctx.moveTo(cx - half, yy);
    ctx.lineTo(cx + half, yy);
  }
  ctx.stroke();
  ctx.strokeStyle = "#e9c46a";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, o.gapBottom);
  ctx.lineTo(cx, o.gapBottom - 15);
  ctx.moveTo(cx - 5, o.gapBottom - 10);
  ctx.lineTo(cx + 5, o.gapBottom - 10);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.strokeStyle = OUTLINE;

  for (const sp of o.splats) drawSplat(ctx, o.x + sp.dx, sp.dy, sp.r, sp.seed, 1);
}

/** On the sidewalk in front of the church: the red carpet, and the flower arch with the couple's names. */
function drawWeddingBackdrop(ctx: CanvasRenderingContext2D, w: Wedding, time: number): void {
  const x = weddingX(w);
  if (x < -120) return;
  const ground = GROUND_Y + 20;
  const { cx: doorX } = churchGeometry(w.church);
  // Red carpet out of the church door
  ctx.fillStyle = "#c1121f";
  ctx.beginPath();
  ctx.moveTo(x - 52, ground);
  ctx.lineTo(doorX + 16, ground);
  ctx.lineTo(doorX + 12, GROUND_Y + 1);
  ctx.lineTo(x - 46, GROUND_Y + 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#e9c46a";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Flower arch
  const ah = 100;
  const ar = 40;
  const top = ground - ah;
  ctx.lineCap = "round";
  for (const [lw, col] of [[8, OUTLINE], [4.5, "#fffdf8"]] as const) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - ar, ground);
    ctx.lineTo(x - ar, top);
    ctx.arc(x, top, ar, Math.PI, 0);
    ctx.lineTo(x + ar, ground);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  // Flowers and leaves along it: up the left post, over the top, down the right post.
  const along = (u: number): { x: number; y: number } => {
    const post = ah / (ah * 2 + Math.PI * ar);
    if (u < post) return { x: x - ar, y: ground - (u / post) * ah };
    if (u > 1 - post) return { x: x + ar, y: top + ((u - (1 - post)) / post) * ah };
    const a = Math.PI + ((u - post) / (1 - 2 * post)) * Math.PI;
    return { x: x + Math.cos(a) * ar, y: top + Math.sin(a) * ar };
  };
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  for (let i = 0; i < 26; i++) {
    const u = 0.1 + (i / 25) * 0.8;
    const p = along(u);
    const r = rnd(i + 3.3);
    if (i % 2 === 0) {
      ctx.fillStyle = "#52b788";
      ctx.beginPath();
      ctx.ellipse(p.x + (r - 0.5) * 8, p.y + 3, 5, 2.5, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ["#fb6f92", "#ffffff", "#ffb3c6", "#c9184a", "#ffe5ec"][i % 5];
    ctx.beginPath();
    ctx.arc(p.x + (r - 0.5) * 5, p.y + (rnd(i + 7.1) - 0.5) * 5, 3.5 + r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Name banner on the crown
  ctx.font = "italic 700 13px Georgia, 'Times New Roman', serif";
  const tw = ctx.measureText(w.names).width + 18;
  const by = top - ar + 2 + Math.sin(time * 2) * 1.5;
  ctx.fillStyle = "#ffe5ec";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * (tw / 2 - 4), by - 6);
    ctx.lineTo(x + s * (tw / 2 + 10), by - 4);
    ctx.lineTo(x + s * (tw / 2 + 5), by + 4);
    ctx.lineTo(x + s * (tw / 2 + 10), by + 12);
    ctx.lineTo(x + s * (tw / 2 - 4), by + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  roundRect(ctx, x - tw / 2, by - 9, tw, 18, 3);
  ctx.fillStyle = "#fff5f8";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#c9184a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(w.names, x, by + 1);
}

/** The bride: a big white gown with a train, a veil, and her bouquet (until she lets it go). */
function drawBride(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.wedding;
  if (!w) return;
  const h = t.h;
  const pose = couplePose(w, time);
  const ruined = w.outcome === "ruined";
  const married = w.outcome === "married";
  const shrieking = ruined && w.t < WEDDING_WINDUP - 0.5;
  const windingUp = ruined && !w.thrown && !shrieking;
  ctx.save();
  ctx.scale(t.facing, 1);
  ctx.translate(0, -pose.hop);
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  // Train behind her, then the skirt
  ctx.fillStyle = "#fffdf8";
  ctx.beginPath();
  ctx.moveTo(-4, -h * 0.35);
  ctx.quadraticCurveTo(-20, -8, -36, 0);
  ctx.lineTo(4, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-7, -h * 0.5);
  ctx.bezierCurveTo(-12, -h * 0.3, -18, -h * 0.12, -19, 0);
  ctx.lineTo(19, 0);
  ctx.bezierCurveTo(18, -h * 0.12, 12, -h * 0.3, 7, -h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) ctx.arc(i * 5.2, -2, 2.6, Math.PI, 0);
  ctx.stroke();
  ctx.lineWidth = 3;

  // Upper body, leaning toward the groom
  ctx.save();
  ctx.translate(0, -h * 0.5);
  ctx.rotate(pose.lean);
  ctx.translate(0, h * 0.5);
  ctx.fillStyle = "#fffdf8";
  roundRect(ctx, -7, -h * 0.76, 14, h * 0.27, 5);
  ctx.fill();
  ctx.stroke();
  const hy = -h * 0.86;
  // Veil, flowing back
  const flutter = Math.sin(time * 3 + t.seed) * 2;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.strokeStyle = "rgba(43,45,66,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-1, hy - 9);
  ctx.quadraticCurveTo(-22 + flutter, hy + 4, -19 + flutter, -h * 0.34);
  ctx.lineTo(-7, -h * 0.42);
  ctx.quadraticCurveTo(-9, hy + 4, 3, hy - 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  // Head, hair in a bun, tiara
  ctx.fillStyle = ruined && !shrieking ? "#f4a29a" : "#f1c27d";
  ctx.beginPath();
  ctx.arc(0, hy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#d4a24c";
  ctx.beginPath();
  ctx.arc(0, hy - 1, 8, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-6, hy - 6, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffd60a";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-4, hy - 7);
  ctx.lineTo(-2, hy - 12);
  ctx.lineTo(0, hy - 8);
  ctx.lineTo(2, hy - 13);
  ctx.lineTo(4, hy - 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Face
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.8;
  if (pose.kissing) {
    ctx.beginPath();
    ctx.arc(3.5, hy - 1, 2, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.fillStyle = "#e5383b";
    ctx.beginPath();
    ctx.arc(7.5, hy + 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (shrieking) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(3.5, hy - 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(4, hy - 2, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4, hy + 4, 2.4, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (ruined) {
    // Furious: brow down, teeth gritted
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0.5, hy - 5.5);
    ctx.lineTo(6.5, hy - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(4, hy - 1.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(1.5, hy + 2.5, 5.5, 2.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(1.5, hy + 2.5, 5.5, 2.5);
  } else {
    ctx.beginPath();
    ctx.arc(3.5, hy - 1, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.5, hy + 2, 3, 0.3, Math.PI - 0.6);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,105,135,0.5)";
    ctx.beginPath();
    ctx.arc(1.5, hy + 2.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Arms and the bouquet
  ctx.strokeStyle = "#f1c27d";
  ctx.lineWidth = 3.5;
  const shoulder = { x: 3, y: -h * 0.72 };
  let hand: { x: number; y: number };
  if (shrieking) hand = { x: 6, y: hy + 6 };
  else if (windingUp) hand = { x: -12, y: hy - 12 };
  else if (ruined) hand = { x: 7, y: hy - 14 + Math.sin(time * 22) * 3 };
  else if (married && w.thrown) hand = { x: 4 + Math.sin(time * 7) * 3, y: hy - 15 };
  else hand = { x: 10, y: -h * 0.55 };
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  if (shrieking) {
    ctx.moveTo(-3, shoulder.y);
    ctx.lineTo(-5, hy + 6);
  }
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  if (!w.thrown) drawBouquetFlowers(ctx, hand.x, hand.y, 1);
  else if (ruined) {
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  ctx.lineCap = "butt";
}

/** The groom: tailcoat, bow tie and top hat. If the kiss is ruined he faints flat on his back. */
function drawGroom(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.wedding;
  if (!w) return;
  const h = t.h;
  const pose = couplePose(w, time);
  const ruined = w.outcome === "ruined";
  const faint = ruined ? Math.min(1, w.t / 0.45) : 0;
  ctx.save();
  ctx.scale(t.facing, 1);
  ctx.translate(0, -pose.hop);
  if (faint > 0) {
    // Topples backwards, away from the bride, and lands with a little bounce.
    const bounce = faint >= 1 ? Math.max(0, Math.sin(Math.min(Math.PI, (w.t - 0.45) * 12))) * 0.08 : 0;
    ctx.translate(-6 * faint, -4 * faint);
    ctx.rotate(-(faint * faint) * 1.45 + bounce);
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  // Legs
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.42);
  ctx.lineTo(-5, 0);
  ctx.moveTo(0, -h * 0.42);
  ctx.lineTo(5, 0);
  ctx.stroke();
  // Upper body, leaning toward the bride
  ctx.save();
  ctx.translate(0, -h * 0.5);
  ctx.rotate(pose.lean);
  ctx.translate(0, h * 0.5);
  ctx.lineWidth = 3;
  ctx.fillStyle = "#3d3d5c";
  // Tails
  ctx.beginPath();
  ctx.moveTo(-9, -h * 0.5);
  ctx.lineTo(-12, -h * 0.3);
  ctx.lineTo(-5, -h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, -10, -h * 0.79, 20, h * 0.4, 5);
  ctx.fill();
  ctx.stroke();
  // Shirt, bow tie, buttonhole
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(-4, -h * 0.79);
  ctx.lineTo(5, -h * 0.79);
  ctx.lineTo(1, -h * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c9184a";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(1, -h * 0.765);
  ctx.lineTo(-3, -h * 0.79);
  ctx.lineTo(-3, -h * 0.74);
  ctx.closePath();
  ctx.moveTo(1, -h * 0.765);
  ctx.lineTo(5, -h * 0.79);
  ctx.lineTo(5, -h * 0.74);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ff8fab";
  ctx.beginPath();
  ctx.arc(-6, -h * 0.7, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Arm: holding her hand, waving once married, flung out when he faints
  const married = w.outcome === "married";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(4, -h * 0.72);
  if (married) ctx.lineTo(6 + Math.sin(time * 9) * 3, -h * 1.02);
  else if (ruined) ctx.lineTo(-2, -h * 1.05);
  else ctx.lineTo(13, -h * 0.5);
  ctx.stroke();
  // Head and hair
  const hy = -h * 0.88;
  ctx.lineWidth = 3;
  ctx.fillStyle = "#e0ac69";
  ctx.beginPath();
  ctx.arc(0, hy, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3b2414";
  ctx.beginPath();
  ctx.arc(0, hy - 1, 8.5, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  // Top hat (it flew off if the kiss was ruined)
  if (!ruined) {
    ctx.fillStyle = "#22223b";
    ctx.fillRect(-7, hy - 22, 14, 14);
    ctx.strokeRect(-7, hy - 22, 14, 14);
    ctx.fillRect(-11, hy - 9, 22, 3);
    ctx.strokeRect(-11, hy - 9, 22, 3);
    ctx.fillStyle = "#ff8fab";
    ctx.fillRect(-6, hy - 12, 12, 3);
  }
  // Face
  ctx.fillStyle = OUTLINE;
  ctx.lineWidth = 1.8;
  if (ruined) {
    ctx.lineWidth = 1.6;
    drawX(ctx, 3.5, hy - 1, 2);
    ctx.fillStyle = "#ff8fab";
    ctx.beginPath();
    ctx.ellipse(5, hy + 4.5, 1.8, 2.6, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (pose.kissing) {
    ctx.beginPath();
    ctx.arc(3.5, hy - 1, 2, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8, hy + 3, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(3.5, hy - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.5, hy + 2, 3, 0.3, Math.PI - 0.6);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  ctx.lineCap = "butt";
  // Little birds circling the fainted groom's head
  if (faint >= 1) {
    for (let i = 0; i < 3; i++) {
      const a = time * 4 + (i * Math.PI * 2) / 3;
      drawStar(ctx, -t.facing * 58 + Math.cos(a) * 14, -14 + Math.sin(a) * 5, 4.5, "#ffd166");
    }
  }
}

/** A wedding guest in their best outfit: claps, holds their breath, cheers, or gasps. */
function drawGuest(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.wedding;
  const h = t.h;
  const ruined = w?.outcome === "ruined";
  const married = w?.outcome === "married";
  const gasp = ruined && (w?.t ?? 0) < 3;
  const hop = married ? Math.abs(Math.sin(time * 8 + t.seed)) * 6 : 0;
  const dress = rnd(t.seed) > 0.5;
  ctx.save();
  ctx.scale(t.facing, 1);
  ctx.translate(0, -hop);
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.4);
  ctx.lineTo(-4, 0);
  ctx.moveTo(0, -h * 0.4);
  ctx.lineTo(4, 0);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.fillStyle = t.color;
  if (dress) {
    ctx.beginPath();
    ctx.moveTo(-6, -h * 0.76);
    ctx.lineTo(6, -h * 0.76);
    ctx.lineTo(12, -h * 0.22);
    ctx.lineTo(-12, -h * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    roundRect(ctx, -9, -h * 0.77, 18, h * 0.42, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(-3, -h * 0.77);
    ctx.lineTo(3, -h * 0.77);
    ctx.lineTo(0, -h * 0.64);
    ctx.closePath();
    ctx.fill();
  }
  // Arms
  const hy = -h * 0.87;
  const sh = -h * 0.7;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (gasp) {
    ctx.moveTo(-4, sh);
    ctx.lineTo(-7, hy + 3);
    ctx.moveTo(4, sh);
    ctx.lineTo(7, hy + 3);
  } else if (married) {
    const wave = Math.sin(time * 10 + t.seed) * 4;
    ctx.moveTo(-4, sh);
    ctx.lineTo(-9 + wave, hy - 14);
    ctx.moveTo(4, sh);
    ctx.lineTo(9 - wave, hy - 14);
  } else if (w && (w.phase === "countdown" || w.phase === "kiss")) {
    // Hands clasped, holding their breath
    ctx.moveTo(-4, sh);
    ctx.lineTo(5, sh + 8);
    ctx.moveTo(4, sh);
    ctx.lineTo(6, sh + 8);
  } else {
    // Polite clapping
    const clap = Math.abs(Math.sin(time * 7 + t.seed)) * 4;
    ctx.moveTo(-4, sh);
    ctx.lineTo(7 - clap, sh + 6);
    ctx.moveTo(4, sh);
    ctx.lineTo(8 + clap * 0.5, sh + 5);
  }
  ctx.stroke();
  // Head, hair and hat
  ctx.lineWidth = 3;
  ctx.fillStyle = rnd(t.seed + 1) > 0.5 ? "#f1c27d" : "#c68642";
  ctx.beginPath();
  ctx.arc(0, hy, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ["#3b2414", "#d4a24c", "#6b4226", "#adb5bd"][Math.floor(rnd(t.seed + 2) * 4)];
  ctx.beginPath();
  ctx.arc(0, hy - 1, 7.5, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  if (dress) {
    // Fascinator with a feather
    ctx.fillStyle = t.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(-2, hy - 8, 6, 2.5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-4, hy - 9);
    ctx.quadraticCurveTo(-10, hy - 18, -2, hy - 20);
    ctx.stroke();
  }
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(3, hy - 1, 1.3, 0, Math.PI * 2);
  ctx.fill();
  if (gasp) {
    ctx.beginPath();
    ctx.ellipse(3.5, hy + 3.5, 1.8, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(3, hy + 1.5, 2.6, 0.3, Math.PI - 0.6);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineCap = "butt";
  if (gasp) outlinedText(ctx, "!", 0, -h - 14 - hop, 18, "#ff595e");
}

/** The wedding photographer: an old plate camera on a tripod, a black hood, and a flash pan held high. */
function drawWeddingPhotographer(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.wedding;
  const h = t.h;
  ctx.save();
  ctx.scale(t.facing, 1);
  ctx.lineCap = "round";
  const camX = 14;
  const camY = -h * 0.66;
  // Tripod
  ctx.strokeStyle = "#6b4226";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const fx of [camX - 9, camX + 1, camX + 9]) {
    ctx.moveTo(camX, camY + 6);
    ctx.lineTo(fx, 0);
  }
  ctx.stroke();
  // Him: legs, coat
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-5, -h * 0.4);
  ctx.lineTo(-9, 0);
  ctx.moveTo(-5, -h * 0.4);
  ctx.lineTo(-1, 0);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.fillStyle = "#6c757d";
  roundRect(ctx, -13, -h * 0.78, 16, h * 0.42, 5);
  ctx.fill();
  ctx.stroke();
  // Flash pan up high in one hand
  const fx = -16;
  const fy = -h * 1.08;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-9, -h * 0.72);
  ctx.lineTo(fx, fy + 4);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "#adb5bd";
  ctx.beginPath();
  ctx.moveTo(fx - 8, fy);
  ctx.lineTo(fx + 8, fy);
  ctx.lineTo(fx + 6, fy + 3);
  ctx.lineTo(fx - 6, fy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The black hood draped from the camera's back over his head
  ctx.fillStyle = "#22223b";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(camX - 7, camY - 8);
  ctx.quadraticCurveTo(-4, -h * 1.02, -13, -h * 0.9);
  ctx.lineTo(-15, -h * 0.62);
  ctx.quadraticCurveTo(-4, -h * 0.66, camX - 7, camY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Camera: wooden box, bellows, brass lens
  ctx.fillStyle = "#8b5e3c";
  roundRect(ctx, camX - 8, camY - 8, 12, 14, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3d405b";
  ctx.beginPath();
  ctx.moveTo(camX + 4, camY - 6);
  ctx.lineTo(camX + 12, camY - 3);
  ctx.lineTo(camX + 12, camY + 3);
  ctx.lineTo(camX + 4, camY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.splats.length ? "#7a4a1e" : "#e9c46a";
  ctx.beginPath();
  ctx.arc(camX + 14, camY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Flash: a burst and a puff of smoke
  if (w && w.flash > 0) {
    const k = w.flash / 0.3;
    ctx.fillStyle = `rgba(255,255,220,${k})`;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = i % 2 ? 9 : 30 + (1 - k) * 18;
      ctx.lineTo(fx + Math.cos(a) * r, fy - 6 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (w && w.outcome && w.t < 2) {
    const s = Math.min(1, w.t * 2);
    ctx.fillStyle = `rgba(220,220,220,${0.7 * (1 - w.t / 2)})`;
    ctx.beginPath();
    ctx.arc(fx - 4 * s, fy - 12 - w.t * 20, 6 + s * 8, 0, Math.PI * 2);
    ctx.arc(fx + 7 * s, fy - 18 - w.t * 24, 5 + s * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.lineCap = "butt";
  void time;
}

/** The getaway car: a ribbon on the bonnet, a JUST MARRIED sign and tin cans on strings. */
function drawGetawayDecor(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const w = t.w;
  const h = t.h;
  // Cans dragging behind (local −x is the back of the car)
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  for (let i = 0; i < 3; i++) {
    const cx = -w / 2 - 12 - i * 9;
    const cy = -4 - (i % 2) * 2 + Math.sin(time * 6 + i) * 0.8;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, -h * 0.3);
    ctx.lineTo(cx + 3, cy - 3);
    ctx.stroke();
    ctx.fillStyle = "#adb5bd";
    ctx.fillRect(cx, cy - 6, 6, 7);
    ctx.strokeRect(cx, cy - 6, 6, 7);
  }
  // Ribbon over the bonnet
  ctx.strokeStyle = "#ff8fab";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.3, -h * 0.6);
  ctx.lineTo(w * 0.48, -h * 0.4);
  ctx.stroke();
  ctx.fillStyle = "#ff8fab";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(w * 0.36, -h * 0.62, 5, 3, -0.4, 0, Math.PI * 2);
  ctx.ellipse(w * 0.44, -h * 0.66, 5, 3, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Sign on the boot, unmirrored so it reads either way round
  const sx = -w * 0.32;
  const sy = -h * 0.42;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(t.facing, 1);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-15, -6, 30, 12);
  ctx.strokeRect(-15, -6, 30, 12);
  ctx.fillStyle = "#c9184a";
  ctx.font = "900 5px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("JUST", 0, -2);
  ctx.fillText("MARRIED", 0, 3);
  ctx.restore();
  ctx.lineWidth = 3;
}

/**
 * The official wedding photo as a framed print: gilt frame, the photo, the
 * couple's names and a caption. `develop` (0..1) whites the photo out while
 * it develops. Returns the print's height.
 */
export function drawWeddingPrint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  info: WeddingPhoto,
  photo: Photo | undefined,
  develop = 0,
): number {
  const pad = w * 0.06;
  const pw = w - pad * 2;
  const ph = pw * 0.75;
  const capH = w * 0.2;
  const h = pad + ph + capH;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 5, y + 7, w, h);
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + pad * 0.35, y + pad * 0.35, w - pad * 0.7, h - pad * 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + pad * 0.55, y + pad * 0.55, w - pad * 1.1, h - pad * 1.1);
  drawPhoto(ctx, photo, x + pad, y + pad, pw, ph);
  if (develop > 0) {
    ctx.fillStyle = `rgba(255,255,255,${develop})`;
    ctx.fillRect(x + pad, y + pad, pw, ph);
  }
  // Caption
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6d4c41";
  ctx.font = `italic 700 ${Math.round(w * 0.075)}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(info.names, x + w / 2, y + pad + ph + capH * 0.36, pw);
  ctx.fillStyle = "#8d6e63";
  ctx.font = `italic ${Math.round(w * 0.05)}px Georgia, 'Times New Roman', serif`;
  const date = new Date().toLocaleDateString("de-CH");
  const caption = info.ruined ? `“Best day of our lives” · ${date}` : `Just married ♥ ${date}`;
  ctx.fillText(caption, x + w / 2, y + pad + ph + capH * 0.72, pw);
  // A sticker in the corner
  ctx.font = `${Math.round(w * 0.1)}px sans-serif`;
  ctx.translate(x + w - pad * 0.6, y + pad * 0.6);
  ctx.rotate(0.3);
  ctx.fillText(info.ruined ? "\u{1F4A9}" : "\u{1F496}", 0, 0);
  ctx.restore();
  return h;
}
