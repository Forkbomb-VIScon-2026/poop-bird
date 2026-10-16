// Poops, splats, particles, score floaters, screen splats and the polaroid of the latest photo.

import { VIEW_H, type Game } from "../game";
import { rnd } from "../random";
import { drawPhoto as drawRtxPhoto, RTX } from "../rtx";
import { drawTrophyPrint, drawWeddingPrint } from "./prints";
import { circle, drawPhoto, oval } from "./shapes";
import { OUTLINE, POOP, POOP_DARK, type View } from "./view";

export function drawPoopBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  if (RTX.on && drawRtxPhoto(ctx, "poop", x, y, Math.sin(rot) * 0.3, r)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(rot) * 0.3);
  ctx.lineWidth = Math.max(1.5, r * 0.25);
  ctx.strokeStyle = POOP_DARK;
  ctx.fillStyle = POOP;
  // Three stacked swirls
  oval(ctx, 0, r * 0.35, r, r * 0.55, 0, true);
  oval(ctx, 0, -r * 0.15, r * 0.72, r * 0.42, 0, true);
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.45);
  ctx.quadraticCurveTo(0, -r * 1.2, r * 0.25, -r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  oval(ctx, -r * 0.35, r * 0.2, r * 0.18, r * 0.1, -0.4);
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
    circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, r * 0.14 + 1);
  }
  ctx.fillStyle = "#9c6b3a";
  oval(ctx, x - r * 0.2, y - r * 0.15, r * 0.25, r * 0.12);
  ctx.restore();
}

export function drawPoops(view: View, game: Game): void {
  const ctx = view.ctx;
  for (const p of game.poops) drawPoopBlob(ctx, p.x, p.y, p.r, p.rot);
}

export function drawParticles(view: View, game: Game): void {
  const ctx = view.ctx;
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
    ctx.fillStyle = p.color;
    circle(ctx, p.x, p.y, p.size);
  }
  ctx.globalAlpha = 1;
}

export function drawFloaters(view: View, game: Game): void {
  const ctx = view.ctx;
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

export function drawScreenSplats(view: View, game: Game): void {
  const ctx = view.ctx;
  for (const s of game.screenSplats) {
    const a = Math.min(0.85, s.life / 1.2);
    drawSplat(ctx, s.x, s.y + (2.5 - s.life) * 8, s.r, s.seed, a);
  }
}

/** The fresh shot pops up as a polaroid in the top corner. */
export function drawPolaroid(view: View, game: Game): void {
  const p = game.polaroid;
  if (!p) return;
  const ctx = view.ctx;
  const age = p.maxLife - p.life;
  if (p.wedding) {
    // The official wedding photo: a big framed print in the top corner, developing from white.
    const pop = age < 0.22 ? 0.3 + (age / 0.22) * 0.8 : 1.1 - Math.min(0.1, (age - 0.22) * 0.8);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 0.4);
    ctx.translate(view.width - 140, 140);
    ctx.rotate(-0.05 + Math.sin(age * 2) * 0.01);
    ctx.scale(pop, pop);
    drawWeddingPrint(ctx, -110, -100, 220, p.wedding, view.photos.get(p.photoId), Math.max(0, 1 - age / 0.7));
    ctx.restore();
    return;
  }
  if (p.trophy) {
    // The fisherman's trophy photo: a big snapshot in the middle, developing from white.
    const pop = age < 0.22 ? 0.3 + (age / 0.22) * 0.8 : 1.1 - Math.min(0.1, (age - 0.22) * 0.8);
    ctx.save();
    ctx.translate(view.width / 2, VIEW_H / 2 + 10);
    ctx.rotate(0.06 + Math.sin(age * 2) * 0.01);
    ctx.scale(pop, pop);
    drawTrophyPrint(ctx, -130, -120, 260, view.photos.get(p.photoId), Math.max(0, 1 - age / 0.7));
    ctx.restore();
    return;
  }
  const pop = age < 0.18 ? 0.4 + (age / 0.18) * 0.75 : 1.15 - Math.min(0.15, (age - 0.18) * 1.2);
  const alpha = Math.min(1, p.life / 0.35);
  const w = 120;
  const h = 142;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(view.width - 110, 120);
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
  drawPhoto(ctx, view.photos.get(p.photoId), -w / 2 + 8, -h / 2 + 8, w - 16, w - 16);
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
