// The wedding: the church, the party, the countdown cue, the bouquet and the doves; and the official wedding photo.

import { config } from "../config";
import { BIRD_RADIUS, BOUQUET_R, CHURCH_SPIRE_H, CHURCH_TOWER_W, churchGeometry, GROUND_Y, WEDDING_WINDUP, weddingX, type Bouquet, type Dove, type Game, type Obstacle, type Target, type Wedding } from "../game";
import { rnd } from "../random";
import { drawPhoto as drawRtxPhoto, RTX, rtxWalker } from "../rtx";
import { drawBird } from "./bird";
import { drawParticles, drawSplat } from "./effects";
import { circle, drawHeart, drawStar, drawX, outlinedText, oval, roundRect, vignette } from "./shapes";
import { drawTarget } from "./street";
import { drawOn, newCanvas, OUTLINE, type Photo, type View } from "./view";

/** Lean, hop and kiss of the couple, from how the wedding is going. */
function couplePose(w: Wedding, time: number): { lean: number; hop: number; kissing: boolean } {
  if (w.phase === "countdown") return { lean: (4 - w.count) * 0.05, hop: 0, kissing: false };
  if (w.phase === "kiss") return { lean: 0.32, hop: 0, kissing: true };
  if (w.outcome === "married") return { lean: 0, hop: Math.abs(Math.sin(time * 9)) * 4, kissing: false };
  return { lean: 0, hop: 0, kissing: false };
}

/** A hand-tied bouquet: stems and a ribbon below, flowers on top. (x, y) is where it's held. */
function drawBouquetFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  if (RTX.on && drawRtxPhoto(ctx, "bouquet", x, y, 0, 9 * s)) return;
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
    circle(ctx, fx, fy, 3.6, true);
  }
  ctx.restore();
}

/** The flying bouquet: tossed (catch it!) or thrown in fury. */
export function drawBouquet(ctx: CanvasRenderingContext2D, q: Bouquet): void {
  if (!q.angry) {
    ctx.fillStyle = "rgba(255,240,170,0.35)";
    circle(ctx, q.x, q.y - 4, BOUQUET_R + 10);
  }
  ctx.save();
  ctx.translate(q.x, q.y);
  ctx.rotate(q.rot);
  drawBouquetFlowers(ctx, 0, 4, 1.4);
  ctx.restore();
  if (!q.angry) outlinedText(ctx, "CATCH!", q.x, q.y - BOUQUET_R - 22, 16, "#ffb3c6");
}

/** A released white dove, flapping hard. */
export function drawDove(ctx: CanvasRenderingContext2D, d: Dove, time: number): void {
  if (RTX.on) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.vx < 0 ? -1 : 1, 1);
    const ok = drawRtxPhoto(ctx, "dove", 0, 0, Math.sin(time * 12) * 0.08, 16);
    ctx.restore();
    if (ok) return;
  }
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
  oval(ctx, 0, 0, 10, 6, 0, true);
  circle(ctx, 9, -4, 4.5, true);
  ctx.fillStyle = "#f4a261";
  ctx.beginPath();
  ctx.moveTo(13, -5);
  ctx.lineTo(17, -3.5);
  ctx.lineTo(13, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  circle(ctx, 10, -5, 1.1);
  // Wing
  const flap = Math.sin(time * 22 + d.seed) * 1.1;
  ctx.save();
  ctx.translate(-1, -3);
  ctx.rotate(-0.3 + flap * 0.8);
  ctx.fillStyle = "#f1f3f5";
  oval(ctx, -2, -7, 5, 9, -0.2, true);
  ctx.restore();
  ctx.restore();
}

/**
 * The church: a nave with stained-glass windows, a tower with a swinging
 * bell, a door with a ribbon, and a spire whose tip is the gap's bottom edge.
 */
export function drawChurch(ctx: CanvasRenderingContext2D, o: Obstacle, time: number): void {
  if (RTX.on && drawRtxPhoto(ctx, "church", churchGeometry(o).cx, GROUND_Y + 2, 0, GROUND_Y + 2 - o.gapBottom)) {
    for (const sp of o.splats) drawSplat(ctx, o.x + sp.dx, sp.dy, sp.r, sp.seed, 1);
    return;
  }
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
    circle(ctx, 0, 23, 2.5);
    ctx.restore();
  }
  if (towerH > 160) {
    // Rose window
    const ry = by + 62;
    ctx.fillStyle = "#ff8fab";
    circle(ctx, cx, ry, 11, true);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.moveTo(cx, ry);
      ctx.lineTo(cx + Math.cos(a) * 11, ry + Math.sin(a) * 11);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    circle(ctx, cx, ry, 4, true);
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
  circle(ctx, cx, GROUND_Y - 50, 2.5, true);
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
export function drawWeddingBackdrop(ctx: CanvasRenderingContext2D, w: Wedding, time: number): void {
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
      oval(ctx, p.x + (r - 0.5) * 8, p.y + 3, 5, 2.5, r * 3);
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
export function drawBride(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on && t.wedding) {
    const wed = t.wedding;
    const pose = couplePose(wed, time);
    ctx.save();
    ctx.scale(t.facing, 1);
    ctx.translate(0, -pose.hop);
    const ok = drawRtxPhoto(ctx, "bride", 0, 0, pose.lean * 0.5, t.h * 1.2);
    // The bouquet, until she throws it; shaking in her fist if the kiss was ruined.
    if (ok && !wed.thrown) drawBouquetFlowers(ctx, 10, -t.h * 0.55 + (wed.outcome === "ruined" ? Math.sin(time * 22) * 3 : 0), 1);
    ctx.restore();
    if (ok) return;
  }
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
  circle(ctx, 0, hy, 8, true);
  ctx.fillStyle = "#d4a24c";
  ctx.beginPath();
  ctx.arc(0, hy - 1, 8, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  circle(ctx, -6, hy - 6, 4.5, true);
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
    circle(ctx, 7.5, hy + 3, 1.8);
  } else if (shrieking) {
    ctx.fillStyle = "#fff";
    circle(ctx, 3.5, hy - 2, 2.6, true);
    ctx.fillStyle = OUTLINE;
    circle(ctx, 4, hy - 2, 1);
    oval(ctx, 4, hy + 4, 2.4, 3.2);
  } else if (ruined) {
    // Furious: brow down, teeth gritted
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0.5, hy - 5.5);
    ctx.lineTo(6.5, hy - 3);
    ctx.stroke();
    circle(ctx, 4, hy - 1.5, 1.3);
    ctx.fillStyle = "#fff";
    ctx.fillRect(1.5, hy + 2.5, 5.5, 2.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(1.5, hy + 2.5, 5.5, 2.5);
  } else {
    circle(ctx, 3.5, hy - 1, 1.4);
    ctx.beginPath();
    ctx.arc(3.5, hy + 2, 3, 0.3, Math.PI - 0.6);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,105,135,0.5)";
    circle(ctx, 1.5, hy + 2.5, 2);
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
    circle(ctx, hand.x, hand.y, 2.8);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  ctx.lineCap = "butt";
}

/** The groom: tailcoat, bow tie and top hat. If the kiss is ruined he faints flat on his back. */
export function drawGroom(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on && t.wedding) {
    const wed = t.wedding;
    const pose = couplePose(wed, time);
    const faint = wed.outcome === "ruined" ? Math.min(1, wed.t / 0.45) : 0;
    ctx.save();
    ctx.scale(t.facing, 1);
    ctx.translate(0, -pose.hop);
    if (faint > 0) {
      // Topples backwards, away from the bride, and lands with a little bounce.
      const bounce = faint >= 1 ? Math.max(0, Math.sin(Math.min(Math.PI, (wed.t - 0.45) * 12))) * 0.08 : 0;
      ctx.translate(-6 * faint, -4 * faint);
      ctx.rotate(-(faint * faint) * 1.45 + bounce);
    }
    const ok = drawRtxPhoto(ctx, "groom", 0, 0, pose.lean * 0.5, t.h * 1.15);
    ctx.restore();
    if (ok) {
      if (faint >= 1) {
        for (let i = 0; i < 3; i++) {
          const a = time * 4 + (i * Math.PI * 2) / 3;
          drawStar(ctx, -t.facing * 58 + Math.cos(a) * 14, -14 + Math.sin(a) * 5, 4.5, "#ffd166");
        }
      }
      return;
    }
  }
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
  circle(ctx, -6, -h * 0.7, 2.6, true);
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
  circle(ctx, 0, hy, 8.5, true);
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
    oval(ctx, 5, hy + 4.5, 1.8, 2.6, 0.3);
  } else if (pose.kissing) {
    ctx.beginPath();
    ctx.arc(3.5, hy - 1, 2, 0.2, Math.PI - 0.2);
    ctx.stroke();
    circle(ctx, 8, hy + 3, 1.6);
  } else {
    circle(ctx, 3.5, hy - 1, 1.5);
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
export function drawGuest(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on) {
    const wed = t.wedding;
    const gasp = wed?.outcome === "ruined" && wed.t < 3;
    const hop = wed?.outcome === "married" ? Math.abs(Math.sin(time * 8 + t.seed)) * 6 : 0;
    ctx.save();
    ctx.scale(t.facing, 1);
    ctx.translate(0, -hop);
    const ok = rtxWalker(ctx, t.seed, t.h * 1.15, 0, true);
    ctx.restore();
    if (ok) {
      if (gasp) outlinedText(ctx, "!", 0, -t.h * 1.15 - 14 - hop, 18, "#ff595e");
      return;
    }
  }
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
  circle(ctx, 0, hy, 7.5, true);
  ctx.fillStyle = ["#3b2414", "#d4a24c", "#6b4226", "#adb5bd"][Math.floor(rnd(t.seed + 2) * 4)];
  ctx.beginPath();
  ctx.arc(0, hy - 1, 7.5, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  if (dress) {
    // Fascinator with a feather
    ctx.fillStyle = t.color;
    ctx.lineWidth = 1.5;
    oval(ctx, -2, hy - 8, 6, 2.5, -0.2, true);
    ctx.beginPath();
    ctx.moveTo(-4, hy - 9);
    ctx.quadraticCurveTo(-10, hy - 18, -2, hy - 20);
    ctx.stroke();
  }
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  circle(ctx, 3, hy - 1, 1.3);
  if (gasp) {
    oval(ctx, 3.5, hy + 3.5, 1.8, 2.4);
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
export function drawWeddingPhotographer(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on) {
    const wed = t.wedding;
    ctx.save();
    ctx.scale(t.facing, 1);
    const ok = drawRtxPhoto(ctx, "photographer", 0, 0, 0, t.h * 1.15);
    // The flash going off on the camera.
    if (ok && wed && wed.flash > 0) {
      const k = wed.flash / 0.3;
      ctx.fillStyle = `rgba(255,255,220,${k})`;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = i % 2 ? 9 : 30 + (1 - k) * 18;
        ctx.lineTo(-t.h * 0.3 + Math.cos(a) * r, -t.h * 1.08 - 6 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (ok) return;
  }
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
  circle(ctx, camX + 14, camY, 4, true);
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
export function drawGetawayDecor(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
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
 * Over the couple: the photographer's countdown in a heart (3… 2… 1…), then
 * a pulsing "KISS!" heart whose ring runs out with the jackpot window. A
 * ruined kiss breaks the heart. The run's first wedding gets a hint.
 */
export function drawWeddingCue(view: View, w: Wedding, game: Game): void {
  const ctx = view.ctx;
  const x = weddingX(w);
  if (x < -80 || x > view.width + 80) return;
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
}

/**
 * The official wedding photo, composed at the moment it's taken: the couple
 * under the arch with the church behind and the guests around, and the
 * bird photobombing from the corner. In face mode `face` (the player's
 * face at the kiss) is stuck on the bird. Kept in memory for this run only.
 */
export function captureWeddingPhoto(view: View, game: Game, face: Photo | null): Photo | null {
  const w = game.wedding;
  if (!w) return null;
  const W = 320;
  const H = 240;
  const photo = newCanvas(W, H);
  if (!photo) return null;
  const octx = photo.ctx;
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

  const b = game.bird;
  const savedBird = { ...b };
  const savedCharge = game.charge;
  const savedZap = game.zapFlash;
  const savedMouth = view.mouthOpen;
  view.mouthOpen = 0;
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
    drawOn(view, octx, () => {
      for (const t of [...w.guests, w.groom, w.bride]) drawTarget(view, t, game.time);
      // Whatever's flying (splatter, the veil, confetti) is in the shot too.
      drawParticles(view, game);
      // The bird photobombs: straining if the kiss went through, blissfully relieved if it just let go on them.
      const at = toWorld(birdAt.x, birdAt.y);
      Object.assign(b, { x: at.x, y: at.y, rot: -0.3, stretch: 1, stretchV: 0, relief: ruined ? 0.4 : 0, flap: 0 });
      game.charge = { ...savedCharge, charge: birdCharge };
      game.zapFlash = 0;
      drawBird(view, game);
    });
  } finally {
    Object.assign(b, savedBird);
    game.charge = savedCharge;
    game.zapFlash = savedZap;
    view.mouthOpen = savedMouth;
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
  vignette(octx, W, H, "80,40,20", 0.35);
  return photo.canvas;
}
