// Canvas rendering. Simple shapes, chunky outlines, no image assets.

import { config } from "./config";
import {
  BIRD_RADIUS,
  GROUND_Y,
  SURFACE_Y,
  TABLOID_H,
  TABLOID_W,
  TRANSITION_HOLD_AT,
  TRANSITION_SWAP_AT,
  VIEW_H,
  obstacleRects,
  type Game,
  type Jelly,
  type Obstacle,
  type Splat,
  type Tabloid,
  type Target,
} from "./game";

/** A captured photo: a face crop from the webcam, or a crop of the game canvas around the bird. */
export type Photo = HTMLCanvasElement;

const OUTLINE = "#2b2d42";
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
    if (ocean) {
      this.drawOcean(game);
    } else {
      this.drawSky(game);
      this.drawGround(game);
    }
    for (const d of game.decals) drawSplat(ctx, d.x, d.y, d.r, d.seed, 0.45);
    for (const t of game.targets) if (t.kind !== "car") this.drawTarget(t, game.time);
    for (const o of game.obstacles) this.drawObstacle(o, game.time);
    for (const t of game.targets) if (t.kind === "car") this.drawTarget(t, game.time);
    // Over the buildings, so a paparazzo's timer is never hidden.
    for (const t of game.targets) if (t.pap) this.drawPaparazzoTimer(t, game);
    for (const j of game.jellies) this.drawJelly(j, game.time, game.spike.spiked);
    this.drawPoops(game);
    // During a transition the splash covers the creature, and particles fly over the splash.
    if (!game.transition) this.drawParticles(game);
    if (ocean) this.drawFish(game);
    else this.drawBird(game);
    if (game.transition) {
      this.drawTransition(game);
      this.drawParticles(game);
    } else if (game.phase === "playing") {
      if (ocean) this.drawPuffMeter(game);
      else this.drawChargeMeter(game);
    }
    this.drawFloaters(game);
    this.drawScreenSplats(game);
    this.drawPolaroid(game);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, game.flash * 1.2)})`;
      ctx.fillRect(-40, -40, this.width + 80, VIEW_H + 80);
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

  private drawGround(game: Game): void {
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
    void game;
  }

  // --- obstacles --------------------------------------------------------------

  private drawObstacle(o: Obstacle, time: number): void {
    if (o.bottom === "harbour") return this.drawHarbourGate(o, time);
    if (o.bottom === "reef") return this.drawReefGate(o, time);
    if (o.bottom === "coral" || o.bottom === "rock") return this.drawSeaObstacle(o, time);
    const ctx = this.ctx;
    const rects = obstacleRects(o);
    const base = rects[0];
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // Bottom part
    if (o.bottom === "chimney") {
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

    // Top part
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    if (o.top === "girder") {
      const r = rects[1];
      ctx.fillStyle = "#f4a259";
      ctx.fillRect(r.x, r.y - 5, r.w, r.h + 5);
      ctx.strokeRect(r.x, r.y - 5, r.w, r.h + 5);
      // Lattice
      ctx.strokeStyle = "#b5651d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let y = r.y; y < r.y + r.h - 4; y += 28) {
        ctx.moveTo(r.x + 4, y);
        ctx.lineTo(r.x + r.w - 4, Math.min(y + 28, r.y + r.h));
        ctx.moveTo(r.x + r.w - 4, y);
        ctx.lineTo(r.x + 4, Math.min(y + 28, r.y + r.h));
      }
      ctx.stroke();
      // Hazard stripe at the bottom edge
      ctx.fillStyle = "#2b2d42";
      ctx.fillRect(r.x, r.y + r.h - 10, r.w, 10);
      ctx.fillStyle = "#ffd166";
      for (let x = r.x; x < r.x + r.w; x += 16) ctx.fillRect(x, r.y + r.h - 10, 8, 10);
    } else if (o.top === "tabloid") {
      const cable = rects[1];
      const box = rects[2];
      ctx.strokeStyle = "#2b2d42";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cable.x + cable.w / 2, -5);
      ctx.lineTo(cable.x + cable.w / 2, box.y + 4);
      ctx.stroke();
      const sway = Math.sin(time * 1.3 + o.seed) * 0.03;
      ctx.save();
      ctx.translate(box.x + box.w / 2, box.y);
      ctx.rotate(sway);
      // Only the bottom of the page shows when the gap is high up.
      drawFrontPage(ctx, -TABLOID_W / 2, box.h - TABLOID_H, TABLOID_W, TABLOID_H, o.tabloid, this.photos);
      ctx.restore();
    } else {
      const cable = rects[1];
      const box = rects[2];
      ctx.strokeStyle = "#2b2d42";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cable.x + cable.w / 2, -5);
      ctx.lineTo(cable.x + cable.w / 2, box.y + 4);
      ctx.stroke();
      if (o.top === "sign") {
        const sway = Math.sin(time * 1.5 + o.seed) * 0.04;
        ctx.save();
        ctx.translate(box.x + box.w / 2, box.y);
        ctx.rotate(sway);
        ctx.fillStyle = "#ef476f";
        roundRect(ctx, -box.w / 2, 0, box.w, box.h, 8);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const words = ["EAT!", "SALE", "HOTEL", "PIZZA", "BAR", "LOL"];
        ctx.fillText(words[Math.floor(rnd(o.seed) * words.length)], 0, box.h / 2 + 1);
        ctx.restore();
      } else {
        // Balloon cluster
        const cx = box.x + box.w / 2;
        const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"];
        const pos = [
          [-26, 18], [0, 10], [26, 18], [-14, 38], [14, 38],
        ];
        pos.forEach(([dx, dy], i) => {
          const bob = Math.sin(time * 2 + i + o.seed) * 2;
          ctx.strokeStyle = OUTLINE;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, box.y);
          ctx.lineTo(cx + dx, box.y + dy + bob);
          ctx.stroke();
          ctx.fillStyle = colors[(i + Math.floor(o.seed)) % colors.length];
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(cx + dx, box.y + dy + bob, 16, 19, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.beginPath();
          ctx.ellipse(cx + dx - 5, box.y + dy + bob - 6, 4, 6, -0.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    for (const s of o.splats) drawSplat(ctx, o.x + s.dx, s.dy, s.r, s.seed, 1);
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

  private drawBird(game: Game): void {
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

    // Body color: yellow → red as it charges
    const body = lerpColor([255, 209, 102], [239, 71, 111], Math.min(1, c * 1.1));
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

  // --- paparazzi ----------------------------------------------------------------

  /**
   * The paparazzo's timer: a ring with a camera that fills as he closes in,
   * and on the run's first one a bouncing "SPLAT HIM!" arrow.
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

    if (!p.tutorial) return;
    const bob = Math.sin(game.time * 6) * 5;
    const ay = y - r - 16 + bob;
    ctx.fillStyle = "#ffd60a";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 9, ay - 14);
    ctx.lineTo(x + 9, ay - 14);
    ctx.lineTo(x + 9, ay - 4);
    ctx.lineTo(x + 16, ay - 4);
    ctx.lineTo(x, ay + 10);
    ctx.lineTo(x - 16, ay - 4);
    ctx.lineTo(x - 9, ay - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = "900 24px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeText("💩 SPLAT HIM!", x, ay - 34);
    ctx.fillStyle = "#ffd60a";
    ctx.fillText("💩 SPLAT HIM!", x, ay - 34);
  }

  /** The fresh shot pops up as a polaroid in the top corner. */
  private drawPolaroid(game: Game): void {
    const p = game.polaroid;
    if (!p) return;
    const ctx = this.ctx;
    const age = 2.2 - p.life;
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

  private drawSeaObstacle(o: Obstacle, time: number): void {
    const ctx = this.ctx;
    const rects = obstacleRects(o);
    const base = rects[0];
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

    // Top part
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    if (o.top === "net") {
      const r = rects[1];
      ctx.fillStyle = "rgba(214,190,140,0.35)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.strokeStyle = "#8d6e4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sway = Math.sin(time * 1.2 + o.seed) * 4;
      for (let k = -r.h; k < r.w + r.h; k += 16) {
        ctx.moveTo(r.x + k, r.y);
        ctx.lineTo(r.x + k + r.h * 0.7 + sway, r.y + r.h);
        ctx.moveTo(r.x + k, r.y);
        ctx.lineTo(r.x + k - r.h * 0.7 + sway, r.y + r.h);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#5c4326";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + r.h - 2);
      ctx.lineTo(r.x + r.w, r.y + r.h - 2);
      ctx.moveTo(r.x + 2, r.y);
      ctx.lineTo(r.x + 2, r.y + r.h);
      ctx.moveTo(r.x + r.w - 2, r.y);
      ctx.lineTo(r.x + r.w - 2, r.y + r.h);
      ctx.stroke();
      // Lead weights and floats
      ctx.fillStyle = "#495057";
      for (let x = r.x + 8; x < r.x + r.w - 4; x += 22) {
        ctx.beginPath();
        ctx.arc(x, r.y + r.h - 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ff8c42";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      for (let x = r.x + 12; x < r.x + r.w; x += 30) {
        ctx.beginPath();
        ctx.ellipse(x, SURFACE_Y - 2, 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (o.top === "hull") {
      const r = rects[1];
      ctx.fillStyle = "#8b5a2b";
      roundRect(ctx, r.x, r.y - 10, r.w, r.h + 10, 22);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      for (let y = r.y + 14; y < r.y + r.h - 26; y += 14) {
        ctx.beginPath();
        ctx.moveTo(r.x + 4, y);
        ctx.lineTo(r.x + r.w - 4, y);
        ctx.stroke();
      }
      // Anti-fouling paint and barnacles
      ctx.save();
      roundRect(ctx, r.x, r.y - 10, r.w, r.h + 10, 22);
      ctx.clip();
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(r.x, r.y + r.h - 24, r.w, 24);
      ctx.restore();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      roundRect(ctx, r.x, r.y - 10, r.w, r.h + 10, 22);
      ctx.stroke();
      ctx.fillStyle = "#f1faee";
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(r.x + 14 + rnd(o.seed + i) * (r.w - 28), r.y + r.h - 6 - rnd(o.seed + i + 9) * 14, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Anchor on a chain
      const cable = rects[1];
      const box = rects[2];
      const cx = cable.x + cable.w / 2;
      ctx.strokeStyle = "#6c757d";
      ctx.lineWidth = 3;
      for (let y = -6, i = 0; y < box.y + 6; y += 11, i++) {
        ctx.beginPath();
        if (i % 2) ctx.ellipse(cx, y, 2, 6, 0, 0, Math.PI * 2);
        else ctx.ellipse(cx, y, 5, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sway = Math.sin(time * 1.1 + o.seed) * 0.05;
      ctx.save();
      ctx.translate(cx, box.y);
      ctx.rotate(sway);
      const h = box.h;
      const aw = box.w / 2;
      ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = "#6c757d";
      ctx.lineWidth = 3;
      // Ring, stock, shank
      ctx.beginPath();
      ctx.arc(0, 6, 6, 0, Math.PI * 2);
      ctx.stroke();
      roundRect(ctx, -aw * 0.55, 14, aw * 1.1, 8, 3);
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, -5, 12, 10, h - 16, 3);
      ctx.fill();
      ctx.stroke();
      // Arms and flukes
      ctx.lineWidth = 8;
      ctx.strokeStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(0, h - 26, aw * 0.85, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#6c757d";
      ctx.stroke();
      for (const sx of [-1, 1]) {
        ctx.fillStyle = "#6c757d";
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const fx = sx * aw * 0.82;
        const fy = h - 26 + Math.sin(Math.PI * 0.15) * aw * 0.85;
        ctx.moveTo(fx, fy - 12);
        ctx.lineTo(fx + sx * 9, fy - 2);
        ctx.lineTo(fx - sx * 3, fy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** City → ocean gate: a harbour building whose gap is a doorway into the sea. */
  private drawHarbourGate(o: Obstacle, time: number): void {
    const ctx = this.ctx;
    const [base, top] = obstacleRects(o);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // The gap: a doorway full of sea, with arrows pointing down.
    const gx = o.x + 6;
    const gw = o.w - 12;
    const gh = o.gapBottom - o.gapTop;
    const water = ctx.createLinearGradient(0, o.gapTop, 0, o.gapBottom);
    water.addColorStop(0, "rgba(72,202,228,0.35)");
    water.addColorStop(1, "rgba(15,95,138,0.6)");
    ctx.fillStyle = water;
    ctx.fillRect(gx, o.gapTop, gw, gh);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = o.gapTop + ((time * 40 + (i * gh) / 4) % gh);
      ctx.beginPath();
      for (let x = gx; x <= gx + gw; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.15 + time * 3) * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    const bob = Math.sin(time * 5) * 5;
    for (let i = 0; i < 2; i++) {
      const ay = o.gapTop + gh * (0.35 + i * 0.3) + bob;
      const ax = o.x + o.w / 2;
      ctx.beginPath();
      ctx.moveTo(ax - 16, ay - 8);
      ctx.lineTo(ax, ay + 8);
      ctx.lineTo(ax + 16, ay - 8);
      ctx.lineTo(ax + 10, ay - 12);
      ctx.lineTo(ax, ay - 2);
      ctx.lineTo(ax - 10, ay - 12);
      ctx.closePath();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 6 - i);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Door frame posts on both sides of the gap
    ctx.fillStyle = "#e0c097";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    for (const px of [o.x, o.x + o.w - 6]) {
      ctx.fillRect(px, o.gapTop, 6, gh);
      ctx.strokeRect(px, o.gapTop, 6, gh);
    }

    // Upper building with portholes, and a striped lintel over the door.
    ctx.fillStyle = o.color;
    roundRect(ctx, top.x, top.y - 5, top.w, top.h + 5, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffe8a3";
    for (let y = top.y + 24; y < top.y + top.h - 70; y += 40) {
      for (let x = top.x + 26; x < top.x + top.w - 16; x += 38) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    const lintelY = top.y + top.h - 22;
    ctx.save();
    ctx.beginPath();
    ctx.rect(top.x, lintelY, top.w, 22);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(top.x, lintelY, top.w, 22);
    ctx.fillStyle = "#e63946";
    for (let x = top.x - 22; x < top.x + top.w; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, lintelY + 22);
      ctx.lineTo(x + 11, lintelY + 22);
      ctx.lineTo(x + 22, lintelY);
      ctx.lineTo(x + 11, lintelY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeRect(top.x, lintelY, top.w, 22);
    // Sign
    if (top.h > 70) {
      const sy = lintelY - 34;
      ctx.fillStyle = "#1d3557";
      roundRect(ctx, top.x + 8, sy, top.w - 16, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚓ HARBOUR", top.x + top.w / 2, sy + 15);
    }

    // Pier below: stone blocks, a life ring and a bollard.
    ctx.fillStyle = "#8d99ae";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    roundRect(ctx, base.x, base.y, base.w, base.h + 4, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 2;
    for (let y = base.y + 18, row = 0; y < GROUND_Y; y += 18, row++) {
      ctx.beginPath();
      ctx.moveTo(base.x + 3, y);
      ctx.lineTo(base.x + base.w - 3, y);
      ctx.stroke();
      for (let x = base.x + (row % 2 ? 14 : 34); x < base.x + base.w - 4; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#3d405b";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    roundRect(ctx, base.x + base.w / 2 - 10, base.y - 14, 20, 16, 5);
    ctx.fill();
    ctx.stroke();
    if (base.h > 70) {
      const rx = base.x + base.w / 2;
      const ry = base.y + 44;
      ctx.lineWidth = 9;
      ctx.strokeStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(rx, ry, 16, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = i % 2 ? "#fff" : "#ff6b35";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(rx, ry, 16, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
        ctx.stroke();
      }
    }
    for (const s of o.splats) drawSplat(ctx, o.x + s.dx, s.dy, s.r, s.seed, 1);
  }

  /** Ocean → city gate: a reef arch whose gap holds a glowing bubble ring up to the surface. */
  private drawReefGate(o: Obstacle, time: number): void {
    const ctx = this.ctx;
    const [base, top] = obstacleRects(o);
    const cx = o.x + o.w / 2;
    const cy = (o.gapTop + o.gapBottom) / 2;
    const gh = o.gapBottom - o.gapTop;

    // A shaft of surface light through the gap.
    ctx.fillStyle = `rgba(255,255,220,${0.18 + 0.06 * Math.sin(time * 3)})`;
    ctx.fillRect(o.x + 4, o.gapTop, o.w - 8, gh);

    // Rock overhang and rock column
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = o.color;
    roundRect(ctx, top.x, top.y - 10, top.w, top.h + 10, 18);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, base.x, base.y, base.w, base.h + 6, 18);
    ctx.fill();
    ctx.stroke();
    // Kelp hanging from the overhang, coral on the column
    ctx.strokeStyle = "#2a9d73";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const kx = top.x + 16 + i * ((top.w - 32) / 2);
      ctx.beginPath();
      ctx.moveTo(kx, top.y + top.h - 4);
      ctx.quadraticCurveTo(kx + Math.sin(time * 2 + i) * 8, top.y + top.h + 10, kx + Math.sin(time * 2 + i + 1) * 5, top.y + top.h + 20);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.fillStyle = "#ff7f6e";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(base.x + 18 + i * ((base.w - 36) / 2), base.y + 4, 8, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
    }

    // The bubble ring
    const rx = o.w * 0.42;
    const ry = gh * 0.42;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + time * 0.8;
      const bx = cx + Math.cos(a) * rx;
      const by = cy + Math.sin(a) * ry;
      const br = 4 + (Math.sin(time * 4 + i) + 1) * 1.6;
      ctx.fillStyle = "rgba(224,251,252,0.55)";
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Arrow up
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    const ay = cy + Math.sin(time * 5) * 6;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 6);
    ctx.beginPath();
    ctx.moveTo(cx, ay - 18);
    ctx.lineTo(cx + 16, ay);
    ctx.lineTo(cx + 6, ay);
    ctx.lineTo(cx + 6, ay + 16);
    ctx.lineTo(cx - 6, ay + 16);
    ctx.lineTo(cx - 6, ay);
    ctx.lineTo(cx - 16, ay);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (top.h > 60) {
      ctx.font = "900 14px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText("SURFACE", cx, top.y + top.h - 20);
      ctx.fillStyle = "#e0fbfc";
      ctx.fillText("SURFACE", cx, top.y + top.h - 20);
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
    const puff = f.puff;

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

    // Sandy yellow → strained red as the pop nears; pale while stunned.
    let body: RGB = lerpColor([255, 214, 120], [239, 71, 111], Math.min(1, danger * 1.1));
    if (warn && Math.sin(game.time * 40) > 0) body = [255, 120, 120];
    if (stunned) body = [214, 214, 170];
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // Spines (behind the body). Little nubs when puffed, real spikes when spiked.
    const spineLen = r * (0.08 * Math.min(1, puff * 1.5) + 0.42 * f.spikes);
    if (spineLen > 1 && !stunned) {
      ctx.fillStyle = shade(body, -40);
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const half = 0.11;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - half) * r * 0.95, Math.sin(a - half) * r * 0.95);
        ctx.lineTo(ca * (r + spineLen), sa * (r + spineLen));
        ctx.lineTo(Math.cos(a + half) * r * 0.95, Math.sin(a + half) * r * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Tail fin
    const moving = Math.abs(b.vy) / 150;
    const tailA = Math.sin(game.time * (10 + moving * 8)) * 0.35;
    ctx.save();
    ctx.translate(-r * 0.92, 0);
    ctx.rotate(tailA);
    ctx.fillStyle = shade(body, -25);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.6, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.45, 0, -r * 0.6, r * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Body
    ctx.fillStyle = rgb(body);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.04, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Belly
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(r * 0.05, r * 0.42, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Spots
    ctx.fillStyle = shade(body, -55);
    for (let i = 0; i < 5; i++) {
      const sx = (-0.55 + i * 0.25) * r;
      const syy = (-0.45 - (i % 2) * 0.15) * r;
      ctx.beginPath();
      ctx.arc(sx, syy, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pectoral fin
    ctx.save();
    ctx.translate(-r * 0.05, r * 0.15);
    ctx.rotate(-0.4 + Math.sin(game.time * 14) * 0.4);
    ctx.fillStyle = shade(body, -20);
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, 0, r * 0.3, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Eye
    const ex = r * 0.45;
    const ey = -r * 0.22;
    const er = Math.max(6, Math.min(12, r * 0.3));
    ctx.strokeStyle = OUTLINE;
    if (dead || stunned) {
      ctx.fillStyle = OUTLINE;
      drawX(ctx, ex, ey, er * 0.6);
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = OUTLINE;
      const pr = warn ? er * 0.25 : er * 0.48;
      const look = Math.max(-1, Math.min(1, b.vy / 200));
      ctx.beginPath();
      ctx.arc(ex + er * 0.25, ey + look * er * 0.3, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex + er * 0.05, ey - er * 0.3, er * 0.18, 0, Math.PI * 2);
      ctx.fill();
      // Worried brow when spiked
      if (f.spikes > 0.5) {
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex - er, ey - er * 1.3);
        ctx.lineTo(ex + er * 0.8, ey - er * (1.3 + danger * 0.6));
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }

    // Mouth: a puckered "o" when puffed, a little smile when deflated.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    const mx = r * 0.93;
    const my = r * 0.18;
    if (puff > 0.45 && !stunned && !dead) {
      ctx.fillStyle = "#d62839";
      ctx.beginPath();
      ctx.ellipse(mx, my, r * 0.09, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(mx - r * 0.12, my - r * 0.04, r * 0.12, 0.2, 1.4);
      ctx.stroke();
    }
    // Cheek blush
    if (puff > 0.55 && !stunned) {
      ctx.fillStyle = `rgba(214,40,57,${Math.min(0.6, (puff - 0.55) * 1.5 + danger * 0.3)})`;
      ctx.beginPath();
      ctx.ellipse(r * 0.55, r * 0.22, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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

  /** Splash between stages: water rises over the city (dive) or the sky drops over the sea (surface). */
  private drawTransition(game: Game): void {
    const tr = game.transition;
    if (!tr) return;
    const ctx = this.ctx;
    const w = this.width + 40;
    const t = tr.t / tr.duration;
    const time = game.time;
    if (!tr.swapped) {
      const k = Math.min(1, t / TRANSITION_SWAP_AT);
      const cover = k * k * (3 - 2 * k);
      const wave = (x: number) => Math.sin(x * 0.025 + time * 9) * 14 + Math.sin(x * 0.06 - time * 5) * 6;
      ctx.beginPath();
      if (tr.to === "ocean") {
        const level = VIEW_H + 40 - cover * (VIEW_H + 110);
        const g = ctx.createLinearGradient(0, level, 0, VIEW_H);
        g.addColorStop(0, "#48cae4");
        g.addColorStop(1, "#0f5f8a");
        ctx.fillStyle = g;
        ctx.moveTo(-20, VIEW_H + 20);
        for (let x = -20; x <= w; x += 16) ctx.lineTo(x, level + wave(x));
        ctx.lineTo(w, VIEW_H + 20);
      } else {
        const level = -40 + cover * (VIEW_H + 110);
        const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, level));
        g.addColorStop(0, "#5ec8f2");
        g.addColorStop(1, "#bfeaf7");
        ctx.fillStyle = g;
        ctx.moveTo(-20, -20);
        for (let x = -20; x <= w; x += 16) ctx.lineTo(x, level + wave(x));
        ctx.lineTo(w, -20);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Foam clears between the swap and the hold point.
      const k = Math.min(1, Math.max(0, (t - TRANSITION_SWAP_AT) / (TRANSITION_HOLD_AT - TRANSITION_SWAP_AT)));
      const a = (1 - k) * 0.85;
      if (a > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`;
        ctx.fillRect(-20, -20, w, VIEW_H + 40);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        for (let i = 0; i < 18; i++) {
          const fx = rnd(i + 200) * this.width;
          const fy = rnd(i + 210) * VIEW_H - k * 200 * (tr.to === "ocean" ? 1 : -1);
          ctx.beginPath();
          ctx.arc(fx, fy, 20 + rnd(i + 220) * 40 * (1 - k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
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

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c: RGB, d: number): string {
  return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v + d)))).join(",")})`;
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
 * A tabloid front page with the photo and headline, laid out to fit w×h. Used
 * for the billboard hanging in the city and for the game-over screen.
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
