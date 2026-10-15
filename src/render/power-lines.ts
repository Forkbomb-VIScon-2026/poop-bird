// Power lines: poles, sagging wires, pigeons, and the surveillance drones some of them turn out to be.

import { GROUND_Y, PIGEON_R, pigeonPos, poleRect, poleX, type DroneWreck, type Pigeon, type PowerLine } from "../game";
import { rnd } from "../random";
import { drawPhoto as drawRtxPhoto, RTX, rtxPoles } from "../rtx";
import { drawSplat } from "./effects";
import { circle, drawStar, drawX, oval, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

/** Pigeons are drawn at this scale (their hit radius is PIGEON_R in game/power-lines.ts). */
const PIGEON_SCALE = 1.35;

/** A drone's eye: a red LED with a glow. */
function drawLedEye(ctx: CanvasRenderingContext2D, x: number, y: number, glow: number): void {
  ctx.fillStyle = `rgba(255,45,45,${0.35 * glow})`;
  circle(ctx, x, y, 4.5);
  ctx.fillStyle = "#ff2d2d";
  circle(ctx, x, y, 1.9);
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
  oval(ctx, 0, -12, 3.5, 7.5);
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
    circle(ctx, Math.sin(k * 5 + i) * 4, -10 - k * 34, 3 + k * 6);
  }

  // Tail half, on its belly, rocked back from the break
  ctx.save();
  ctx.translate(-5, 0);
  ctx.rotate(-0.18);
  ctx.save();
  clipDroneHalf(ctx, -1);
  if (!(RTX.on && drawRtxPhoto(ctx, "perched", 0, 0, 0, PIGEON_R / PIGEON_SCALE))) {
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
    oval(ctx, 0, -12, 12, 8, 0, true);
    ctx.fillStyle = "#7d8691";
    oval(ctx, -5, -14, 8, 4.5, 0.15, true);
  }
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
  if (!(RTX.on && drawRtxPhoto(ctx, "perched", 0, 0, 0, PIGEON_R / PIGEON_SCALE))) {
    ctx.fillStyle = "#9aa3ad";
    oval(ctx, 0, -12, 12, 8, 0, true);
  }
  drawDroneInnards(ctx, 1, seed);
  ctx.restore();
  ctx.fillStyle = "#6a994e";
  oval(ctx, 7, -16, 4.5, 4, 0.4);
  ctx.fillStyle = "#8a92a0";
  circle(ctx, 10, -20, 5.5, true);
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
  circle(ctx, 11, -35, 1.4);
  // Still recording.
  if (Math.sin(time * 6 + seed) > -0.3) drawLedEye(ctx, 11.5, -21.5, 1);
  else {
    ctx.fillStyle = "#6a040f";
    circle(ctx, 11.5, -21.5, 1.8);
  }
  ctx.restore();

  // Wires spilling across the gap between the halves
  drawLooseWires(ctx, 0, -10, seed, time, 1);
  ctx.restore();
}

export function drawPowerLine(view: View, l: PowerLine, time: number): void {
  const ctx = view.ctx;
  const last = l.poles - 1;
  if (l.x > view.width + 60 || poleX(l, last) < -60) return;

  // Poles: wooden trunk, a cross-arm with an insulator per wire, a cap.
  if (!(RTX.on && rtxPoles(ctx, l)))
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
        oval(ctx, px + dx, w.y - 7, 4, 5, 0, true);
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
    circle(ctx, x, y, 10);
    drawStar(ctx, x, y, 5 + flick * 2, "#fff3b0");
  });

  for (const p of l.pigeons) drawPigeon(view, l, p, time);
}

function drawPigeon(view: View, l: PowerLine, p: Pigeon, time: number): void {
  const ctx = view.ctx;
  const f = p.flyer;
  const w = p.wreck;
  if (w && w.landed >= 0) {
    if (w.x > -60 && w.x < view.width + 60) drawDroneWreck(ctx, w, p.seed, p.facing, time);
    return;
  }
  let x: number;
  let y: number;
  if (w) {
    x = w.x;
    y = w.y;
  } else if (f) {
    if (f.y < -40 || f.x < -40 || f.x > view.width + 40) return;
    x = f.x;
    y = f.y;
  } else {
    ({ x, y } = pigeonPos(l, p));
    if (p.startle > 0) y -= Math.sin((p.startle / 0.35) * Math.PI) * 10;
  }
  if (RTX.on && !w) {
    // The photo pigeon: perched, or knocked off the wire, tumbling and splattered.
    ctx.save();
    ctx.translate(x, y);
    let ok: boolean;
    if (f) {
      ctx.rotate(-0.35 + Math.sin(time * 30 + p.seed) * 0.15);
      ok = drawRtxPhoto(ctx, "birdUp", 0, 0, 0, PIGEON_R * 0.8);
      if (ok) drawSplat(ctx, -2, -6, 7, p.seed, 1);
    } else {
      ctx.scale(p.facing, 1);
      ok = drawRtxPhoto(ctx, "perched", 0, 0, 0, PIGEON_R);
    }
    ctx.restore();
    if (ok) return;
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
  oval(ctx, 0, -12, 12, 8, 0, true);
  // Wing: folded, or flapping hard when flying off
  ctx.fillStyle = "#7d8691";
  ctx.save();
  ctx.translate(-2, -14);
  if (f) ctx.rotate(Math.sin(time * 30 + p.seed) * 1.1 - 0.4);
  oval(ctx, -3, 0, 8, 4.5, f ? -0.3 : 0.15, true);
  ctx.restore();
  // Head with an iridescent neck; sitting pigeons bob.
  const bob = f ? 0 : Math.max(0, Math.sin(time * 4 + p.seed)) * 3;
  const hx = 10 + bob;
  const hy = -20;
  ctx.fillStyle = "#6a994e";
  oval(ctx, 7 + bob * 0.5, -16, 4.5, 4, 0.4);
  ctx.fillStyle = "#8a92a0";
  circle(ctx, hx, hy, 5.5, true);
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
    circle(ctx, hx + 1.5, hy - 1.5, 1.8);
  }
  ctx.restore();
}
