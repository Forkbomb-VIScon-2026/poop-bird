// Paparazzi and the timer ring of their shot.

import type { Game, Target } from "../game";
import { drawPhoto as drawRtxPhoto, RTX } from "../rtx";
import { circle, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

export function drawPaparazzo(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
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

  const photo = RTX.on && drawRtxPhoto(ctx, "paparazzo", 0, 0, 0, h * 1.1);
  if (!photo) {
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
  circle(ctx, 0, headY, 8, true);
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

  }

  // Camera: aimed at the bird while watching, held up in triumph after the shot, drooping when smashed.
  const shoulderY = -h * 0.72;
  const aim = smashed ? 1.3 : snapped ? -Math.PI / 2 - 0.3 : p.aim;
  const camDist = snapped ? 14 : 8;
  const camX = Math.cos(aim) * camDist;
  const camY = shoulderY + Math.sin(aim) * camDist;
  if (!photo) {
  // Arms to the camera
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(-4, shoulderY + 2);
  ctx.lineTo(camX, camY);
  ctx.moveTo(4, shoulderY + 2);
  ctx.lineTo(camX, camY + 2);
  ctx.stroke();
  }
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
    circle(ctx, -4, -1, 2.5);
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
 * The paparazzo's timer: a ring with a camera that fills as he closes in.
 */
export function drawPaparazzoTimer(view: View, t: Target, game: Game): void {
  const p = t.pap;
  if (!p || p.state !== "watching" || game.phase !== "playing") return;
  const ctx = view.ctx;
  const urgent = p.timer > 0.7;
  const pulse = urgent ? 1 + Math.max(0, Math.sin(game.time * 18)) * 0.12 : 1;
  const r = 19 * pulse;
  const x = t.x;
  const y = t.y - t.h - 30;

  // Disc, then the remaining time as a shrinking wedge.
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  circle(ctx, x, y, r);
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
  circle(ctx, x, y + 1, 4.5);
  ctx.fillStyle = OUTLINE;
  circle(ctx, x, y + 1, 2.2);
}
