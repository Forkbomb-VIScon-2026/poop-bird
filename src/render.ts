// Canvas rendering. Simple shapes, chunky outlines, no image assets.

import {
  BIRD_RADIUS,
  GROUND_Y,
  VIEW_H,
  obstacleRects,
  type Game,
  type Obstacle,
  type Splat,
  type Target,
} from "./game";

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  width = 1000;
  /** Background scroll offset, accumulates even between runs. */
  private bgOffset = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
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
    this.bgOffset += game.phase === "playing" ? game.scrollSpeed * dt : 0;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (game.shake > 0) {
      const s = game.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    this.drawSky(game);
    this.drawGround(game);
    for (const d of game.decals) drawSplat(ctx, d.x, d.y, d.r, d.seed, 0.45);
    for (const t of game.targets) if (t.kind !== "car") this.drawTarget(t, game.time);
    for (const o of game.obstacles) this.drawObstacle(o, game.time);
    for (const t of game.targets) if (t.kind === "car") this.drawTarget(t, game.time);
    this.drawPoops(game);
    this.drawParticles(game);
    this.drawBird(game);
    if (game.phase === "playing") this.drawChargeMeter(game);
    this.drawFloaters(game);
    this.drawScreenSplats(game);
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
