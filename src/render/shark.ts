// The shark and its warning cue.

import type { Game, Shark } from "../game";
import { RTX, rtxShark } from "../rtx";
import { circle, outlinedText, oval } from "./shapes";
import { OUTLINE, type View } from "./view";

/**
 * The shark, drawn facing +x and rotated to its heading (flipped when it
 * swims left, so its belly stays down). Grey back, white belly, a dorsal
 * fin, and jaws that open wide with two rows of teeth.
 */
export function drawShark(view: View, s: Shark, game: Game): void {
  const ctx = view.ctx;
  const fast = s.state === "lunge" || s.state === "fleeing";
  const tw = Math.sin(game.time * (fast ? 20 : 7) + s.seed) * (fast ? 10 : 7);
  const back = "#6f93ab";
  const dark = "#56778e";
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.heading);
  if (Math.cos(s.heading) < 0) ctx.scale(1, -1);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;

  // RTX: the photo shark, its lower jaw swinging open, with the drawn cues on top.
  if (RTX.on && rtxShark(ctx, s.jaw)) {
    if (s.state === "chomped") {
      // The fish's tail sticks out of its mouth, still wiggling.
      const wag = Math.sin(game.time * 14) * 4;
      ctx.fillStyle = "#b7a64a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(72, 8);
      ctx.lineTo(90, -4 + wag);
      ctx.lineTo(88, 18 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (s.state === "fleeing") {
      // Spines stuck in its snout.
      ctx.strokeStyle = "#8a6d1f";
      ctx.lineWidth = 2;
      for (const [sx, sy, a] of [[72, -2, -0.5], [76, 6, 0.1], [70, 12, 0.6]] as const) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * 12, sy + Math.sin(a) * 12);
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  // Tail and dorsal fin first: the body's outline covers their bases.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-64, -7);
  ctx.lineTo(-104, -40 + tw);
  ctx.quadraticCurveTo(-90, -2 + tw * 0.3, -104, 30 + tw);
  ctx.lineTo(-64, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = back;
  ctx.beginPath();
  ctx.moveTo(-10, -23);
  ctx.lineTo(4, -62);
  ctx.quadraticCurveTo(12, -40, 30, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Body, with a white belly.
  const body = new Path2D();
  body.moveTo(78, 4);
  body.quadraticCurveTo(66, -22, 14, -26);
  body.quadraticCurveTo(-36, -24, -70, -6);
  body.lineTo(-70, 7);
  body.quadraticCurveTo(-24, 28, 30, 22);
  body.quadraticCurveTo(66, 18, 78, 4);
  body.closePath();
  ctx.fillStyle = back;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = "#eef3f6";
  oval(ctx, 8, 24, 80, 15, 0.04);
  ctx.restore();
  ctx.stroke(body);

  // Gills.
  ctx.lineWidth = 2;
  for (const gx of [22, 29, 36]) {
    ctx.beginPath();
    ctx.moveTo(gx, -10);
    ctx.quadraticCurveTo(gx - 4, 0, gx, 9);
    ctx.stroke();
  }
  ctx.lineWidth = 3;

  // Pectoral fin.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(8, 16);
  ctx.lineTo(-20, 42 + tw * 0.3);
  ctx.quadraticCurveTo(2, 30, 26, 20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Jaws: the mouth opens below the snout, teeth top and bottom.
  const open = s.jaw * 26;
  if (open > 1) {
    const hx = 28;
    const hy = 11;
    const tipY = hy + open;
    ctx.fillStyle = "#7a1f2b";
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(76, 6);
    ctx.lineTo(70, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const ux = hx + (76 - hx) * t;
      const uy = hy + (6 - hy) * t;
      ctx.beginPath();
      ctx.moveTo(ux - 3, uy);
      ctx.lineTo(ux + 3, uy);
      ctx.lineTo(ux, uy + 6);
      ctx.fill();
      const lx = hx + (70 - hx) * t;
      const ly = hy + (tipY - hy) * t;
      ctx.beginPath();
      ctx.moveTo(lx - 3, ly);
      ctx.lineTo(lx + 3, ly);
      ctx.lineTo(lx, ly - 6);
      ctx.fill();
    }
    // The lower jaw, swung down.
    ctx.fillStyle = "#eef3f6";
    ctx.beginPath();
    ctx.moveTo(hx - 4, hy + 2);
    ctx.lineTo(70, tipY);
    ctx.lineTo(64, tipY + 7);
    ctx.quadraticCurveTo(40, 26, 22, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(76, 6);
    ctx.stroke();
  } else {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(34, 12);
    ctx.quadraticCurveTo(56, 14, 72, 8);
    ctx.stroke();
    ctx.lineWidth = 3;
  }

  // Eye: mean while hunting, squeezed shut in pain while fleeing, smug after a meal.
  const ex = 52;
  const ey = -8;
  if (s.state === "fleeing") {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey - 5);
    ctx.lineTo(ex + 3, ey);
    ctx.lineTo(ex - 5, ey + 5);
    ctx.stroke();
    // A tear streams off behind it.
    ctx.fillStyle = "#a2d2ff";
    oval(ctx, ex - 14, ey + 4, 3, 5, 0.6);
    // Spines stuck in its snout.
    ctx.strokeStyle = "#8a6d1f";
    ctx.lineWidth = 2;
    for (const [sx, sy, a] of [[72, -2, -0.5], [76, 6, 0.1], [70, 12, 0.6]] as const) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * 12, sy + Math.sin(a) * 12);
      ctx.stroke();
    }
  } else if (s.state === "chomped") {
    // The fish's tail sticks out of its mouth, still wiggling.
    const wag = Math.sin(game.time * 14) * 4;
    ctx.fillStyle = "#b7a64a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(72, 8);
    ctx.lineTo(90, -4 + wag);
    ctx.lineTo(88, 18 + wag);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey + 2, 5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#fff";
    circle(ctx, ex, ey, 5.5);
    ctx.fillStyle = OUTLINE;
    circle(ctx, ex + 1.5, ey + 0.5, 3);
    if (s.state === "windup" || s.state === "lunge") {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - 9, ey - 9);
      ctx.lineTo(ex + 7, ey - 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Windup: a "!" over the shark. */
export function drawSharkCue(view: View, s: Shark, game: Game): void {
  if (game.phase !== "playing") return;
  const ctx = view.ctx;
  if (s.state === "windup") {
    outlinedText(ctx, "!", s.x, s.y - 72 + Math.sin(game.time * 30) * 2, 34, "#ff595e");
  }
}
