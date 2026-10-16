// The backdrop: the city's sky, skyline and street, the quay and harbour at
// the waterfront, and the sea with its parallax rocks and kelp.

import { GROUND_Y, OCEAN_DEPTH, SURFACE_Y, VIEW_H, WATER_Y, type Game } from "../game";
import { rnd } from "../random";
import { RTX, rtxOceanBackdrop, rtxSeaFloor, rtxSeaLife, rtxSky, rtxStreet } from "../rtx";
import { circle, oval, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

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

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 26 * s, 0, Math.PI * 2);
  ctx.arc(x + 28 * s, y - 12 * s, 32 * s, 0, Math.PI * 2);
  ctx.arc(x + 62 * s, y, 24 * s, 0, Math.PI * 2);
  ctx.arc(x + 30 * s, y + 8 * s, 26 * s, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The backdrop in city coordinates (the caller has applied the camera). The
 * sea is drawn OCEAN_DEPTH lower, under the city: in the ocean, while the
 * camera pans between them, and under the harbour where the street ends.
 * The city's sky is cut off at the water level, so the two meet at the
 * surface.
 */
export function drawScenery(view: View, game: Game): void {
  const ctx = view.ctx;
  const cam = game.cameraY;
  const cityVisible = cam < OCEAN_DEPTH - 0.5;
  const seaVisible = game.stage === "ocean" || !!game.transition || !!game.shore;
  if (seaVisible) {
    ctx.save();
    ctx.translate(0, OCEAN_DEPTH);
    drawOcean(view, game);
    ctx.restore();
  }
  if (cityVisible) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-40, -1000, view.width + 80, WATER_Y + 1000);
    ctx.clip();
    drawSky(view, game);
    ctx.restore();
  }
  if (game.shore) drawQuay(view, game);
  if (cityVisible) {
    drawGround(view, game);
    if (game.shore) drawHarbourSurface(view, game);
  }
}

/** The x range of the quay (land) and of the harbour water, in screen x. Without a shore, it's all land. */
function landRange(view: View, game: Game): { land: [number, number]; water: [number, number] | null } {
  const s = game.shore;
  const lo = -40;
  const hi = view.width + 40;
  if (!s) return { land: [lo, hi], water: null };
  const x = Math.min(hi, Math.max(lo, s.x));
  return s.kind === "dive" ? { land: [lo, x], water: [x, hi] } : { land: [x, hi], water: [lo, x] };
}

/**
 * The quay: a stone block under the street that ends in a wall at the
 * shore, down to the sea floor. Above the water it's dry stone with a
 * bollard at the edge; below, it's tinted blue-green with a weed line.
 */
function drawQuay(view: View, game: Game): void {
  const ctx = view.ctx;
  const s = game.shore!;
  const { land } = landRange(view, game);
  const [x0, x1] = land;
  if (x1 - x0 < 1) return;
  const bottom = OCEAN_DEPTH + VIEW_H + 40;
  const face = s.x;
  const dir = s.kind === "dive" ? 1 : -1; // the wall faces right (dive) or left (exit)

  // Dry stone above the water, wet stone below.
  ctx.fillStyle = "#a59f92";
  ctx.fillRect(x0, GROUND_Y, x1 - x0, WATER_Y - GROUND_Y);
  const wet = ctx.createLinearGradient(0, WATER_Y, 0, bottom);
  wet.addColorStop(0, "#5f7f86");
  wet.addColorStop(0.25, "#3f6673");
  wet.addColorStop(1, "#1d4256");
  ctx.fillStyle = wet;
  ctx.fillRect(x0, WATER_Y, x1 - x0, bottom - WATER_Y);

  // Stone blocks, in offset courses, anchored to the shore so they scroll with it.
  ctx.strokeStyle = "rgba(43,45,66,0.35)";
  ctx.lineWidth = 2;
  const courseH = 30;
  const blockW = 56;
  const top = Math.max(GROUND_Y, game.cameraY - courseH);
  const end = Math.min(bottom, game.cameraY + VIEW_H + courseH);
  const firstRow = Math.floor((top - GROUND_Y) / courseH);
  for (let row = firstRow; GROUND_Y + row * courseH < end; row++) {
    const y = GROUND_Y + row * courseH;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    const shift = row % 2 ? blockW / 2 : 0;
    // Vertical joints, counted from the wall face inward.
    for (let k = 1; ; k++) {
      const jx = face - dir * (k * blockW - shift);
      if (jx < x0 - blockW || jx > x1 + blockW) break;
      if (jx > x0 && jx < x1) {
        ctx.moveTo(jx, y);
        ctx.lineTo(jx, y + courseH);
      }
    }
    ctx.stroke();
  }

  // Weed and slime along the water line.
  ctx.fillStyle = "#2f7d5b";
  ctx.beginPath();
  ctx.moveTo(x0, WATER_Y - 2);
  for (let x = x0; x <= x1; x += 8) {
    const seed = Math.floor((x - face) / 8);
    ctx.lineTo(x, WATER_Y + 6 + rnd(seed + 900) * 10);
  }
  ctx.lineTo(x1, WATER_Y - 2);
  ctx.closePath();
  ctx.fill();

  // The wall face, with a stone coping on top and a bollard at the edge.
  if (face > -40 && face < view.width + 40) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(face, GROUND_Y);
    ctx.lineTo(face, bottom);
    ctx.stroke();
    ctx.fillStyle = "#c9c3b4";
    ctx.fillRect(dir === 1 ? face - 26 : face, GROUND_Y - 2, 26, 8);
    ctx.strokeRect(dir === 1 ? face - 26 : face, GROUND_Y - 2, 26, 8);
    const bx = face - dir * 40;
    ctx.fillStyle = "#3d405b";
    ctx.beginPath();
    roundRect(ctx, bx - 8, GROUND_Y - 22, 16, 22, 4);
    ctx.fill();
    ctx.stroke();
    oval(ctx, bx, GROUND_Y - 22, 11, 5, 0, true);
    // A ladder down into the water.
    const lx = face + dir * 2;
    ctx.strokeStyle = "#6c757d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const rail of [0, 14]) {
      ctx.moveTo(lx + dir * rail, GROUND_Y + 4);
      ctx.lineTo(lx + dir * rail, WATER_Y + 70);
    }
    for (let y = GROUND_Y + 14; y < WATER_Y + 70; y += 14) {
      ctx.moveTo(lx, y);
      ctx.lineTo(lx + dir * 14, y);
    }
    ctx.stroke();
  }
}

/** The harbour seen from above: a rippling surface at WATER_Y over the water, the sea showing through below. */
function drawHarbourSurface(view: View, game: Game): void {
  const ctx = view.ctx;
  const { water } = landRange(view, game);
  if (!water || water[1] - water[0] < 1) return;
  const [x0, x1] = water;
  const time = game.time;
  const wave = (x: number) => Math.sin(x * 0.035 + time * 2.4 + view.bgOffset * 0.035) * 2.5;
  // A light tint just under the surface, fading into the sea below.
  const g = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + 40);
  g.addColorStop(0, "rgba(202,240,248,0.7)");
  g.addColorStop(1, "rgba(202,240,248,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x0, WATER_Y, x1 - x0, 40);
  ctx.beginPath();
  ctx.moveTo(x0, WATER_Y + wave(x0));
  for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, WATER_Y + wave(x));
  ctx.lineTo(x1, WATER_Y + wave(x1));
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.stroke();
  // Glints drifting on the surface.
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (let i = 0; i < 10; i++) {
    const span = view.width + 80;
    const gx = ((((rnd(i + 950) * span - view.bgOffset) % span) + span) % span) - 40;
    if (gx < x0 || gx > x1) continue;
    ctx.fillRect(gx, WATER_Y + 6 + rnd(i + 960) * 14, 10 + rnd(i + 970) * 14, 2);
  }
}

function drawSky(view: View, game: Game): void {
  if (RTX.on && rtxSky(view.ctx, view.width, view.bgOffset, game.time)) return;
  const ctx = view.ctx;
  const w = view.width + 40;
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, "#5ec8f2");
  g.addColorStop(0.7, "#bfeaf7");
  g.addColorStop(1, "#fde7c8");
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, w, GROUND_Y + 40);

  // Sun
  ctx.fillStyle = "#fff3b0";
  circle(ctx, view.width - 140, 110, 52);
  ctx.fillStyle = "rgba(255,243,176,0.35)";
  circle(ctx, view.width - 140, 110, 75 + Math.sin(game.time * 2) * 4);

  // Clouds (slowest layer)
  const cloudOff = view.bgOffset * 0.08 + game.time * 6;
  for (const c of CLOUDS) {
    const span = 2000;
    const x = ((((c.x - cloudOff) % span) + span) % span) - 200;
    drawCloud(ctx, x, c.y, c.s);
  }

  drawSkyline(view, FAR_SKYLINE, view.bgOffset * 0.18, "#9cc5d9", "#b7d9e8");
  drawSkyline(view, MID_SKYLINE, view.bgOffset * 0.4, "#6f9bb3", "#8fb6c9");
}

function drawSkyline(view: View, list: SkylineBuilding[], offset: number, color: string, windowColor: string): void {
  const ctx = view.ctx;
  const off = ((offset % SKYLINE_LEN) + SKYLINE_LEN) % SKYLINE_LEN;
  ctx.fillStyle = color;
  for (let rep = 0; rep * SKYLINE_LEN - off < view.width + 100; rep++) {
    for (const b of list) {
      const x = b.x + rep * SKYLINE_LEN - off;
      if (x > view.width + 50 || x + b.w < -50) continue;
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

/** Sidewalk and road, only where there's land (up to the quay's edge). */
function drawGround(view: View, game: Game): void {
  const ctx = view.ctx;
  const [x0, x1] = landRange(view, game).land;
  if (x1 - x0 < 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, GROUND_Y - 10, x1 - x0, VIEW_H);
  ctx.clip();
  drawStreet(view);
  ctx.restore();
}

function drawStreet(view: View): void {
  if (RTX.on && rtxStreet(view.ctx, view.width, view.bgOffset, VIEW_H)) return;
  const ctx = view.ctx;
  const w = view.width + 40;
  // Sidewalk
  ctx.fillStyle = "#d9d4c7";
  ctx.fillRect(-20, GROUND_Y, w, 22);
  ctx.fillStyle = "#c2bcac";
  const off = view.bgOffset % 60;
  for (let x = -off; x < w; x += 60) ctx.fillRect(x, GROUND_Y, 3, 22);
  // Curb
  ctx.fillStyle = "#9e9a8f";
  ctx.fillRect(-20, GROUND_Y + 20, w, 5);
  // Road
  ctx.fillStyle = "#4a4e69";
  ctx.fillRect(-20, GROUND_Y + 25, w, VIEW_H - GROUND_Y);
  ctx.fillStyle = "#f2e9e4";
  const dash = view.bgOffset % 90;
  for (let x = -dash; x < w; x += 90) ctx.fillRect(x, GROUND_Y + 50, 46, 5);
  // Top edge line
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-20, GROUND_Y);
  ctx.lineTo(w, GROUND_Y);
  ctx.stroke();
}

function drawOcean(view: View, game: Game): void {
  const ctx = view.ctx;
  const w = view.width + 40;
  const time = game.time;
  const photo = RTX.on && rtxOceanBackdrop(ctx, view.width, view.bgOffset, VIEW_H);
  if (photo) rtxSeaLife(ctx, view.width, view.bgOffset, time, KELP, SKYLINE_LEN);
  else {
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
    const x0 = ((((i * 237 - view.bgOffset * 0.12 + Math.sin(time * 0.4 + i) * 30) % span) + span) % span) - 180;
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
  const rockOff = ((view.bgOffset * 0.15) % SKYLINE_LEN + SKYLINE_LEN) % SKYLINE_LEN;
  ctx.fillStyle = "#0c4d6e";
  for (let rep = 0; rep * SKYLINE_LEN - rockOff < view.width + 100; rep++) {
    for (const b of FAR_ROCKS) {
      const x = b.x + rep * SKYLINE_LEN - rockOff;
      if (x > view.width + 50 || x + b.w < -50) continue;
      const top = GROUND_Y - b.h;
      ctx.beginPath();
      ctx.moveTo(x - 10, GROUND_Y);
      ctx.quadraticCurveTo(x, top, x + b.w / 2, top);
      ctx.quadraticCurveTo(x + b.w, top, x + b.w + 10, GROUND_Y);
      ctx.fill();
    }
  }
  const kelpOff = ((view.bgOffset * 0.4) % SKYLINE_LEN + SKYLINE_LEN) % SKYLINE_LEN;
  ctx.lineCap = "round";
  for (let rep = 0; rep * SKYLINE_LEN - kelpOff < view.width + 100; rep++) {
    for (const k of KELP) {
      const x = k.x + rep * SKYLINE_LEN - kelpOff;
      if (x > view.width + 60 || x < -60) continue;
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
        oval(ctx, lx + (i % 4 ? 9 : -9), ly, 10, 4, i % 4 ? 0.5 : -0.5);
      }
    }
  }
  ctx.lineCap = "butt";

  }

  // Rising bubbles
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  const span = view.width + 100;
  const depth = GROUND_Y - SURFACE_Y;
  for (let i = 0; i < 28; i++) {
    const rise = 25 + rnd(i + 60) * 45;
    const bx = ((((rnd(i + 50) * span - view.bgOffset * 0.5) % span) + span) % span) - 50 + Math.sin(time * 2 + i) * 6;
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
    ctx.lineTo(x, SURFACE_Y + Math.sin(x * 0.03 + time * 2 + view.bgOffset * 0.03) * 4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (photo) {
    ctx.beginPath();
    ctx.moveTo(-20, VIEW_H + 20);
    for (let x = -20; x <= w; x += 20) ctx.lineTo(x, GROUND_Y + Math.sin((x + view.bgOffset) * 0.02) * 3);
    ctx.lineTo(w, VIEW_H + 20);
    ctx.closePath();
    if (rtxSeaFloor(ctx, view.bgOffset)) return;
  }
  // Sea floor
  ctx.fillStyle = "#e9cf94";
  ctx.beginPath();
  ctx.moveTo(-20, VIEW_H + 20);
  for (let x = -20; x <= w; x += 20) {
    ctx.lineTo(x, GROUND_Y + Math.sin((x + view.bgOffset) * 0.02) * 3);
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
  const rip = view.bgOffset % 70;
  for (let x = -rip; x < w; x += 70) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 32);
    ctx.quadraticCurveTo(x + 15, GROUND_Y + 26, x + 30, GROUND_Y + 32);
    ctx.stroke();
  }
  const peb = view.bgOffset % 130;
  for (let i = 0, x = -peb; x < w; x += 130, i++) {
    const seed = Math.floor((view.bgOffset + x) / 130);
    ctx.fillStyle = rnd(seed) > 0.5 ? "#c9a86a" : "#f4a3a8";
    oval(ctx, x + rnd(seed + 1) * 60, GROUND_Y + 50 + rnd(seed + 2) * 20, 6, 4);
  }
}
