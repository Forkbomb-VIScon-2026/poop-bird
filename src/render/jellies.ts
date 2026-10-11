// Jellyfish.

import type { Jelly } from "../game";
import { drawPhoto as drawRtxPhoto, RTX } from "../rtx";
import { OUTLINE, type View } from "./view";
import { circle, oval } from "./shapes";

export function drawJelly(view: View, j: Jelly, time: number): void {
  if (RTX.on && drawRtxPhoto(view.ctx, "jelly", j.x, j.y, 0, j.r)) return;
  const ctx = view.ctx;
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
  oval(ctx, -r * 0.35, -r * 0.4, r * 0.18, r * 0.3, -0.5);
  ctx.fillStyle = OUTLINE;
  for (const ex of [-r * 0.25, r * 0.25]) {
    circle(ctx, ex, -r * 0.05, 2.2);
  }
  ctx.restore();
}
