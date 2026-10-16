// The pufferfish and its puff meter.

import { config } from "../config";
import { BIRD_RADIUS, type Game } from "../game";
import { rnd } from "../random";
import { RTX } from "../rtx";
import { circle, drawStar, drawX, oval, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

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

/**
 * The pufferfish: olive speckled back, spotted yellow flank, white belly. Deflated it's a
 * slim torpedo; puffing rounds it into a ball with a sagging white belly. Fins and eye keep
 * their size while the body inflates.
 */
export function drawFish(view: View, game: Game): void {
  if (RTX.on && view.rtxPlayer.drawFish(view.ctx, game, game.bodyRadius)) {
    const ctx = view.ctx;
    const b = game.bird;
    const r = game.bodyRadius;
    // Spike-out flash ring
    if (game.fish.flare > 0) {
      const k = 1 - game.fish.flare / 0.35;
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * (1.3 + k * 1.2), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (game.stunned) {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 5 + (i * Math.PI * 2) / 3;
        drawStar(ctx, b.x + Math.cos(a) * 30, b.y - r - 12 + Math.sin(a) * 8, 7, "#ffd166");
      }
    }
    return;
  }
  const ctx = view.ctx;
  const b = game.bird;
  const f = game.fish;
  const dead = game.phase !== "playing";
  const stunned = game.stunned;
  const danger = game.popProgress;
  const warn = game.popWarning;
  const r = game.bodyRadius;
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
    circle(ctx, u * L, v * H, 0.6 + rnd(i * 7.3 + 3) * (0.6 + r * 0.025));
  }
  ctx.fillStyle = "rgba(38,30,12,0.88)";
  for (const [u, v, k] of FISH_SPOTS) {
    const R = v < 0 ? H : B;
    oval(ctx, u * L, v * R, k * (1 + L * 0.05), k * (1 + R * 0.075));
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
      circle(ctx, u * L, v * B, 0.8 + r * 0.02);
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
    circle(ctx, ex, ey, er);
    ctx.lineWidth = 2;
    ctx.stroke();
    const iris = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 0.78);
    iris.addColorStop(0, "#9cc94a");
    iris.addColorStop(1, "#4d7a26");
    ctx.fillStyle = iris;
    circle(ctx, ex, ey, er * 0.78);
    ctx.fillStyle = "#111";
    const pr = warn ? er * 0.2 : er * 0.42;
    const look = Math.max(-1, Math.min(1, b.vy / 200));
    circle(ctx, ex + er * 0.15, ey + look * er * 0.25, pr);
    ctx.fillStyle = "#fff";
    circle(ctx, ex - er * 0.15, ey - er * 0.3, er * 0.18);
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
    oval(ctx, mx + lip * 0.45, my, lip * 0.3, lip * 0.45);
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
export function drawPuffMeter(view: View, game: Game): void {
  if (game.stunned) return;
  const ctx = view.ctx;
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
