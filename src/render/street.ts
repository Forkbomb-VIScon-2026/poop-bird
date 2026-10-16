// The street's targets: cars, pedestrians (and their rage) and statues; the specials draw in their own modules.

import type { Rage, Target } from "../game";
import { drawPhoto as drawRtxPhoto, RTX, rtxCar, rtxWalker } from "../rtx";
import { drawParachutist } from "./balloons";
import { drawKid } from "./kids";
import { drawPaparazzo } from "./paparazzi";
import { circle, line, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";
import { drawBride, drawGetawayDecor, drawGroom, drawGuest, drawWeddingPhotographer } from "./wedding";

function drawCar(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on) {
    ctx.save();
    ctx.scale(t.facing, 1);
    const ok = rtxCar(ctx, t);
    if (ok && t.wedding) drawGetawayDecor(ctx, t, time);
    ctx.restore();
    if (ok) return;
  }
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
    circle(ctx, wx, -h * 0.12, h * 0.2);
    ctx.fillStyle = "#adb5bd";
    circle(ctx, wx, -h * 0.12, h * 0.08);
  }
  ctx.restore();
  void time;
}

function drawPedestrian(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on) {
    // A photo passer-by: swaying as they walk, stamping on the spot when furious.
    ctx.save();
    if (t.rage) ctx.translate(0, -Math.abs(Math.sin(time * 14)) * 3);
    ctx.scale(t.facing || 1, 1);
    const ok = rtxWalker(ctx, t.seed, t.h * 1.15, t.rage ? 0 : Math.sin(time * 6 + t.seed) * 0.03);
    ctx.restore();
    if (ok) {
      if (t.rage) drawRage(ctx, t.rage, t.h, time);
      return;
    }
  }
  const rage = t.rage;
  const walk = rage ? 0 : Math.sin(time * 9 + t.seed) * 0.5;
  const h = t.h;
  ctx.save();
  // Furious: stamping on the spot.
  if (rage) ctx.translate(0, -Math.abs(Math.sin(time * 14)) * 3);
  ctx.scale(t.facing, 1);
  ctx.lineCap = "round";
  // Legs
  ctx.lineWidth = 5;
  ctx.strokeStyle = OUTLINE;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.38);
    ctx.lineTo(rage ? s * 6 : Math.sin(walk * s) * 10, 0);
    ctx.stroke();
  }
  // Body
  ctx.lineWidth = 3;
  ctx.fillStyle = t.color;
  roundRect(ctx, -9, -h * 0.75, 18, h * 0.4, 6);
  ctx.fill();
  ctx.stroke();
  // Arms: a fist shaken at the bird when angry.
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.68);
  if (rage) {
    const fx = 16 + Math.sin(time * 24) * 3;
    const fy = -h * 1.02 + Math.cos(time * 24) * 3;
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = "#f1c27d";
    ctx.lineWidth = 2;
    circle(ctx, fx, fy, 4, true);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.68);
    ctx.lineTo(-7, -h * 0.4);
  } else {
    ctx.lineTo(-Math.sin(walk) * 10, -h * 0.42);
  }
  ctx.stroke();
  // Head (red in the face when angry)
  ctx.lineWidth = 3;
  ctx.fillStyle = rage ? "#f2785c" : "#f1c27d";
  circle(ctx, 0, -h * 0.87, 8, true);
  // Hat / hair
  ctx.fillStyle = t.seed % 2 > 1 ? "#3d405b" : "#6b4226";
  ctx.beginPath();
  ctx.arc(0, -h * 0.9, 8, Math.PI, Math.PI * 2);
  ctx.fill();
  // Eye
  ctx.fillStyle = OUTLINE;
  circle(ctx, 4, -h * 0.87, 1.6);
  if (rage) {
    // A furious brow and a shouting mouth.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.8;
    line(ctx, 1.5, -h * 0.87 - 4.5, 7, -h * 0.87 - 1.5);
    ctx.beginPath();
    ctx.ellipse(5, -h * 0.87 + 4, 2, 1.6 + Math.abs(Math.sin(time * 18)), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.lineCap = "butt";
  if (rage) drawRage(ctx, rage, h, time);
}

/** Steam off the head and a grawlix speech bubble, popping in, over a cursing pedestrian. */
function drawRage(ctx: CanvasRenderingContext2D, rage: Rage, h: number, time: number): void {
  // Steam puffs rising off the head.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 2; i++) {
    const k = (time * 1.6 + i * 0.5) % 1;
    const side = i === 0 ? -1 : 1;
    ctx.globalAlpha = 1 - k;
    circle(ctx, side * (7 + k * 6), -h - 2 - k * 14, 2.5 + k * 3);
  }
  ctx.globalAlpha = 1;
  // Bubble pops in with a little overshoot, then wobbles.
  const pop = Math.min(1, rage.t / 0.15);
  const scale = pop < 1 ? pop * 1.15 : 1 + Math.sin(time * 20) * 0.03;
  const by = -h - 30;
  ctx.save();
  ctx.translate(0, by);
  ctx.scale(scale, scale);
  ctx.font = "900 15px 'Trebuchet MS', sans-serif";
  const w = ctx.measureText(rage.curse).width + 16;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-4, 11);
  ctx.lineTo(2, 22);
  ctx.lineTo(6, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, -w / 2, -12, w, 24, 9);
  ctx.fill();
  ctx.stroke();
  // Cover the tail's joint so the bubble reads as one shape.
  ctx.fillRect(-3, 8, 8, 5);
  ctx.fillStyle = "#e63946";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(rage.curse, 0, 1);
  ctx.restore();
}

function drawStatue(ctx: CanvasRenderingContext2D, t: Target): void {
  if (RTX.on && drawRtxPhoto(ctx, "statue", 0, 0, 0, t.h)) return;
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
  circle(ctx, 0, -h * 0.8, 9, true);
}

export function drawTarget(view: View, t: Target, time: number): void {
  const ctx = view.ctx;
  ctx.save();
  ctx.translate(t.x, t.y);
  if (t.hitFlash > 0) ctx.translate(0, -Math.sin((t.hitFlash / 0.3) * Math.PI) * 6);
  drawTargetBody(ctx, t, time);
  if (t.splats.length) view.splatter.draw(ctx, t, time);
  ctx.restore();
}

/** A target as it looks (without its splats), at its feet. */
export function drawTargetBody(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
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
}
