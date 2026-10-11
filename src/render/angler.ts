// The fisherman in his boat, his line and hook; and his trophy photo.

import { ANGLER_HAT_DX, ANGLER_TIP_DX, ANGLER_TOPPLE_TIME, ANGLER_TUG_TIME, GROUND_Y, SURFACE_Y, type Angler, type Game } from "../game";
import { rnd } from "../random";
import { initialSpikeState } from "../swim";
import { drawFish } from "./fish";
import { circle, line, outlinedText, oval, roundRect, vignette } from "./shapes";
import { drawOn, newCanvas, OUTLINE, type Photo, type View } from "./view";

/** The boat and the fisherman are drawn this much bigger than their own coordinates. */
const ANGLER_SCALE = 1.5;

/** How far below the surface the boat's waterline centre sits (world px). */
const ANGLER_DRAFT = 16;

/** His rod tip's height over the boat's waterline centre (boat coordinates). */
const ANGLER_TIP_Y = -30;

/** He leans back (and topples over) about his seat, relative to the boat's waterline centre. */
const ANGLER_PIVOT = { x: 16, y: -4 };

/** Where he holds the rod, relative to the boat's waterline centre. */
const ANGLER_HANDS = { x: 2, y: -10 };

/** A red-and-white float. */
function drawBobber(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = "#fff";
  circle(ctx, x, y, 4.5);
  ctx.fillStyle = "#ef233c";
  ctx.beginPath();
  ctx.arc(x, y, 4.5, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A J-hook hanging from its eye at (x, y − 10), with a wriggling worm on it. */
function drawHook(ctx: CanvasRenderingContext2D, x: number, y: number, worm: boolean, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.3, 1.3);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const hook = () => {
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 3);
    ctx.arc(4, 3, 4, Math.PI, 0, true);
    ctx.lineTo(8, -2);
    ctx.lineTo(5.5, 0.5);
  };
  hook();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  ctx.stroke();
  hook();
  ctx.strokeStyle = "#e9ecef";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  if (worm) {
    // Coiled round the shank, a tail wriggling below.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 6.5;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-3, -6);
      ctx.quadraticCurveTo(4, -4, -2, -1);
      ctx.quadraticCurveTo(-6, 2, 1, 4);
      const w = Math.sin(time * 9) * 5;
      ctx.quadraticCurveTo(6 + w * 0.3, 8, 2 + w, 14);
    };
    path();
    ctx.stroke();
    path();
    ctx.strokeStyle = "#ff8fa3";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The rowing boat, bow to the left, origin at the waterline's centre. Drawn
 * over the fisherman's legs. Below `water` (boat y) the sea tints it.
 */
function drawBoatHull(ctx: CanvasRenderingContext2D, seed: number, water = 0): void {
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(-66, -11);
    ctx.quadraticCurveTo(-54, 20, -12, 23);
    ctx.lineTo(38, 23);
    ctx.quadraticCurveTo(56, 21, 58, 4);
    ctx.lineTo(60, -9);
    ctx.quadraticCurveTo(0, -6, -66, -11);
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = "round";
  hull();
  ctx.fillStyle = "#b5651d";
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Planks, a white stripe with her name, and the part under water tinted by the sea.
  ctx.strokeStyle = "rgba(70,35,10,0.45)";
  ctx.lineWidth = 1.5;
  for (const y of [4, 13]) {
    ctx.beginPath();
    ctx.moveTo(-70, y - 8);
    ctx.quadraticCurveTo(0, y + 2, 64, y - 6);
    ctx.stroke();
  }
  ctx.fillStyle = "#f8f9fa";
  ctx.beginPath();
  ctx.moveTo(-70, -9);
  ctx.quadraticCurveTo(0, -3, 64, -7);
  ctx.lineTo(64, -3);
  ctx.quadraticCurveTo(0, 1, -70, -5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1d3557";
  ctx.font = "italic 900 7px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(["MARGRIT", "HEIDI II", "SEELI", "ROSMARIE"][Math.floor(seed) % 4], 6, 6);
  ctx.fillStyle = "rgba(20,110,150,0.38)";
  ctx.fillRect(-70, water, 140, 40);
  ctx.restore();
  hull();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Gunwale
  ctx.strokeStyle = "#7f4a1e";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-64, -10);
  ctx.quadraticCurveTo(0, -5, 58, -8);
  ctx.stroke();
  ctx.restore();
}

type AnglerMood = "calm" | "strain" | "proud" | "shock" | "angry";

/**
 * The fisherman, sitting in his boat facing left (origin at the boat's
 * waterline centre). `tipX/tipY` is his rod tip (no rod if null), `bend`
 * 0..1 how far it bows, `lean` how far he leans back. Without `hat` he's bald.
 */
function drawFisherman(
  ctx: CanvasRenderingContext2D,
  tipX: number | null,
  tipY: number,
  bend: number,
  lean: number,
  time: number,
  mood: AnglerMood,
  hat = true,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.translate(ANGLER_PIVOT.x, ANGLER_PIVOT.y);
  ctx.rotate(lean);
  ctx.translate(-ANGLER_PIVOT.x, -ANGLER_PIVOT.y);
  const hx = ANGLER_HANDS.x;
  const hy = ANGLER_HANDS.y;

  // The rod: butt tucked under his arm, bowing toward the tip.
  if (tipX !== null) {
    const bx = 16;
    const by = -3;
    const mx = (hx + tipX) / 2;
    const my = (hy + tipY) / 2;
    const len = Math.hypot(tipX - hx, tipY - hy) || 1;
    const nx = -(tipY - hy) / len;
    const ny = (tipX - hx) / len;
    const sag = -(6 + bend * 16);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(hx, hy);
    ctx.quadraticCurveTo(mx + nx * sag, my + ny * sag, tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = "#6b4226";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Reel
    ctx.fillStyle = "#adb5bd";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    circle(ctx, hx + 3, hy + 3, 3, true);
  }

  // Oilskin coat
  ctx.fillStyle = "#ffc300";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  roundRect(ctx, 5, -18, 22, 20, 6);
  ctx.fill();
  ctx.stroke();
  // Arms: on the rod, or flung up (shock), one fist up (proud).
  ctx.strokeStyle = "#e6a800";
  ctx.lineWidth = 5;
  if (mood === "shock") {
    line(ctx, 10, -14, 2, -26 + Math.sin(time * 30) * 2);
    line(ctx, 20, -14, 26, -27 + Math.cos(time * 30) * 2);
  } else {
    line(ctx, 11, -14, hx + 1, hy);
    if (mood === "proud") line(ctx, 22, -14, 28, -30);
    else if (mood === "angry") line(ctx, 22, -14, 28, -30 + Math.sin(time * 25) * 3);
    else line(ctx, 20, -13, hx + 4, hy + 2);
  }
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.fillStyle = "#f1c27d";
  for (const [x, y] of mood === "shock" ? [[2, -26], [26, -27]] : mood === "proud" ? [[hx + 1, hy], [28, -30]] : mood === "angry" ? [[hx + 1, hy], [28, -30 + Math.sin(time * 25) * 3]] : [[hx + 1, hy], [hx + 4, hy + 2]]) {
    circle(ctx, x, y, 2.6, true);
  }

  // Head, with a big grey beard.
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "#f1c27d";
  circle(ctx, 14, -23, 6.5, true);
  ctx.fillStyle = "#e9ecef";
  ctx.beginPath();
  ctx.moveTo(19, -22);
  ctx.quadraticCurveTo(18, -14, 12, -13);
  ctx.quadraticCurveTo(6, -14, 7, -22);
  ctx.quadraticCurveTo(13, -19, 19, -22);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Nose
  ctx.fillStyle = "#e5989b";
  circle(ctx, 8.5, -23, 2);
  // Eye
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = OUTLINE;
  if (mood === "proud") {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(11, -25, 1.8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else if (mood === "shock") {
    ctx.fillStyle = "#fff";
    circle(ctx, 11, -25.5, 2.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    circle(ctx, 10.5, -25.5, 1);
  } else {
    circle(ctx, 11, -25, mood === "strain" ? 0.8 : 1.3);
    if (mood === "angry") {
      // A furious brow.
      ctx.lineWidth = 1.6;
      line(ctx, 8, -28.5, 13.5, -26.8);
    }
    if (mood === "strain") {
      // Gritted, sweating.
      ctx.lineWidth = 1.2;
      line(ctx, 9, -27.5, 13, -26.5);
      ctx.fillStyle = "#a2d2ff";
      const k = (time * 3) % 1;
      circle(ctx, 21 + k * 3, -27 + k * 6, 1.6);
    }
  }
  if (mood === "angry") {
    // The pipe's gone too: a grumpy mouth in the beard.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(10, -16.5, 2.5, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (mood !== "shock") {
    // Pipe (calm) or a grin.
    if (mood === "proud") {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(7, -19.5);
      ctx.quadraticCurveTo(10, -16, 14, -18.5);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#5c3d1e";
      ctx.lineWidth = 1.8;
      line(ctx, 9, -19, 3, -18);
      ctx.fillStyle = "#5c3d1e";
      ctx.fillRect(1.5, -21, 3, 4);
      if (mood === "calm") {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        const k = (time * 0.8) % 1;
        circle(ctx, 2 - k * 3, -23 - k * 9, 1.2 + k * 2);
      }
    }
  }
  if (!hat) {
    // Bald, with a shine.
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(14, -24, 4, Math.PI * 1.2, Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Sou'wester: brim, crown, and the long back flap.
  ctx.fillStyle = "#f4a300";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, -27);
  ctx.quadraticCurveTo(14, -30, 24, -26);
  ctx.lineTo(25, -21);
  ctx.quadraticCurveTo(22, -24, 19, -25);
  ctx.quadraticCurveTo(12, -27, 4, -27);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(14.5, -27.5, 6, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * 0..1 how far over he is, `t` s after his line snapped: over fast from where
 * he was leaning back hauling on it, a while on his back, then up again.
 */
function toppleAmount(t: number): number {
  if (t < 0.22) return 0.31 + 0.69 * (1 - (1 - t / 0.22) ** 2);
  if (t < ANGLER_TOPPLE_TIME) return 1;
  return Math.max(0, 1 - (t - ANGLER_TOPPLE_TIME) / 0.4);
}

/** His rubber boots sticking up over the gunwale, kicking (boat coordinates). `k` 0..1 how far up. */
function drawBoots(ctx: CanvasRenderingContext2D, time: number, k: number): void {
  ctx.save();
  ctx.lineCap = "round";
  for (const [i, x] of [[0, 4], [1, 12]]) {
    const kick = Math.sin(time * 14 + i * 2) * 3;
    const top = -9 - 16 * k;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 6.5;
    line(ctx, x + 6, -6, x + kick, top);
    ctx.strokeStyle = "#2d6a4f";
    ctx.lineWidth = 4.5;
    line(ctx, x + 6, -6, x + kick, top);
    ctx.fillStyle = "#1b4332";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    oval(ctx, x + kick - 2, top - 1, 4, 2.5, -0.3, true);
  }
  ctx.restore();
}

/** His sou'wester: floating upside down at the surface at `y`, or flying through the air turned by `spin`. */
function drawFloatingHat(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, spin?: number): void {
  ctx.save();
  ctx.translate(x, spin === undefined ? y + Math.sin(time * 3 + 1) * 1.5 : y);
  ctx.scale(1.4, 1.4);
  ctx.rotate(spin ?? Math.PI + Math.sin(time * 2) * 0.15);
  ctx.fillStyle = "#f4a300";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 7, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  oval(ctx, 0, 0, 12, 2.5, 0, true);
  ctx.restore();
}

/** The rod tip in world coordinates (it whips while casting and bends under a hooked fish). */
function anglerTip(a: Angler, oy: number): { x: number; y: number } {
  // In the boat's own (unscaled) coordinates.
  let x = -ANGLER_TIP_DX / ANGLER_SCALE;
  let y = ANGLER_TIP_Y;
  if (a.state === "casting") {
    // Back over his shoulder, then forward: rotate the rod about his hands.
    const k = Math.min(1, a.t / 0.5);
    const ang = k < 0.4 ? (k / 0.4) * 0.9 : 0.9 * (1 - (k - 0.4) / 0.6);
    const hx = ANGLER_HANDS.x;
    const hy = ANGLER_HANDS.y;
    const dx = x - hx;
    const dy = y - hy;
    x = hx + dx * Math.cos(ang) - dy * Math.sin(ang);
    y = hy + dx * Math.sin(ang) + dy * Math.cos(ang);
  } else if (a.state === "hooked" || a.state === "landed" || a.state === "tugging") {
    const pull = a.state === "hooked" ? 0.5 + a.reel * 0.5 : 1;
    x += 12 * pull;
    y += 12 * pull;
  }
  return { x: a.x + x * ANGLER_SCALE, y: oy + y * ANGLER_SCALE };
}

/** Where the rod tip actually is while he leans back by `lean` (he and his rod turn about his seat, see drawFisherman). */
function leanTip(a: Angler, oy: number, tip: { x: number; y: number }, lean: number): { x: number; y: number } {
  const px = a.x + ANGLER_PIVOT.x * ANGLER_SCALE;
  const py = oy + ANGLER_PIVOT.y * ANGLER_SCALE;
  const dx = tip.x - px;
  const dy = tip.y - py;
  const c = Math.cos(lean);
  const sn = Math.sin(lean);
  return { x: px + dx * c - dy * sn, y: py + dx * sn + dy * c };
}

/**
 * The fisherman's rowing boat on the surface, seen from just below: hull in
 * the water, him sitting in it in his yellow oilskins and sou'wester, his
 * line running down through the bobber to the hook and its worm.
 */
export function drawAngler(view: View, a: Angler, game: Game): void {
  const ctx = view.ctx;
  const time = game.time;
  // The boat rides low: its waterline centre sits under the surface, so he fits in view above it.
  const oy = SURFACE_Y + ANGLER_DRAFT + Math.sin(time * 2.2 + a.seed) * 1.5;
  const tip = anglerTip(a, oy);
  const snapped = a.state === "snapped";
  const tugging = a.state === "tugging";
  const reeling = a.state === "hooked" || a.state === "landed";
  // How far he leans back: hauling on a snagged line, then, when it parts, over backwards into
  // the boat; a while on his back, then up again, furious.
  const topple = snapped ? toppleAmount(a.t) : 0;
  const lean = snapped
    ? topple * 1.45
    : tugging
      ? 0.15 + 0.3 * Math.min(1, a.t / ANGLER_TUG_TIME) + Math.sin(time * 40) * 0.03
      : reeling
        ? 0.22 + Math.sin(time * 22) * 0.05 + (a.state === "landed" ? 0.12 : 0)
        : 0;
  const realTip = leanTip(a, oy, tip, lean);

  // The line.
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.3;
  const hookDown = a.hookY > SURFACE_Y + 1;
  if (reeling) {
    line(ctx, realTip.x, realTip.y, a.hookX, a.hookY);
  } else if (tugging) {
    // Taut from the rod through the bobber to the spines it's snagged on; the hook dangles below.
    const bx = realTip.x + (a.cutX - realTip.x) * 0.3;
    ctx.beginPath();
    ctx.moveTo(realTip.x, realTip.y);
    ctx.lineTo(bx, SURFACE_Y + 2);
    ctx.lineTo(a.cutX, a.cutY);
    ctx.lineTo(a.hookX, a.hookY - 12);
    ctx.stroke();
    drawBobber(ctx, bx, SURFACE_Y + 2);
  } else if (snapped) {
    // The end on his rod whips back up out of the water, then the bobber dangles from the tip.
    if (a.stubY > SURFACE_Y + 1) {
      ctx.beginPath();
      ctx.moveTo(realTip.x, realTip.y);
      ctx.lineTo(tip.x, SURFACE_Y);
      ctx.lineTo(tip.x + Math.sin(time * 40) * 3, a.stubY);
      ctx.stroke();
      drawBobber(ctx, tip.x, SURFACE_Y);
    } else {
      line(ctx, realTip.x, realTip.y, realTip.x, realTip.y + 10);
      drawBobber(ctx, realTip.x, realTip.y + 10);
    }
    // The cut-off end sinks away with the hook, frayed where the spines parted it.
    if (a.hookY < GROUND_Y + 50) {
      ctx.beginPath();
      ctx.moveTo(a.cutX - 3, a.cutY - 4);
      ctx.quadraticCurveTo(a.cutX + 3, a.cutY, a.cutX, a.cutY + 4);
      ctx.lineTo(a.hookX, a.hookY - 12);
      ctx.stroke();
    }
  } else if (a.state === "casting") {
    const k = Math.min(1, a.t / 0.5);
    const by = k < 0.4 ? tip.y + 10 : tip.y + 10 + (SURFACE_Y - tip.y - 10) * ((k - 0.4) / 0.6) ** 2;
    line(ctx, tip.x, tip.y, tip.x, by);
    drawBobber(ctx, tip.x, by);
  } else if (a.state === "rowing" || !hookDown) {
    line(ctx, tip.x, tip.y, tip.x, tip.y + 10);
    drawBobber(ctx, tip.x, tip.y + 10);
  } else {
    const bx = (tip.x + a.hookX) / 2;
    const by = SURFACE_Y + Math.sin(time * 3 + a.seed) * 1.5;
    line(ctx, tip.x, tip.y, bx, by);
    line(ctx, bx, by, a.hookX, a.hookY - 12);
    drawBobber(ctx, bx, by);
  }

  ctx.save();
  ctx.translate(a.x, oy);
  ctx.scale(ANGLER_SCALE, ANGLER_SCALE);
  const tx = (tip.x - a.x) / ANGLER_SCALE;
  const ty = (tip.y - oy) / ANGLER_SCALE;
  if (snapped) {
    drawFisherman(ctx, tx, ty, 0, lean, time, topple > 0.05 ? "shock" : "angry", false);
  } else {
    const mood = a.state === "landed" ? "proud" : reeling || tugging ? "strain" : "calm";
    drawFisherman(ctx, tx, ty, reeling || tugging ? 1 : 0, lean, time, mood);
  }
  drawBoatHull(ctx, a.seed, (SURFACE_Y - oy) / ANGLER_SCALE);
  // Lying on his back in the boat: his boots kick up over the gunwale.
  if (topple > 0.6) drawBoots(ctx, time, (topple - 0.6) / 0.4);
  ctx.restore();

  // His hat flies off in an arc and lands in the water behind the boat.
  if (snapped) {
    const k = Math.min(1, a.t / 0.5);
    const hx0 = a.x + 21;
    const hy0 = oy - 44;
    const hx1 = a.hatX + ANGLER_HAT_DX;
    if (k < 1) drawFloatingHat(ctx, hx0 + (hx1 - hx0) * k, hy0 + (SURFACE_Y - hy0) * k - Math.sin(k * Math.PI) * 50, time, k * 7);
    else drawFloatingHat(ctx, hx1, SURFACE_Y, time);
  }

  // The hook, with its worm until something bites.
  if (!reeling && hookDown && a.hookY < GROUND_Y + 50) drawHook(ctx, a.hookX, a.hookY, true, time);

  // The warning: he's casting.
  if (a.state === "casting" || (a.state === "fishing" && a.t < 0.6)) {
    outlinedText(ctx, "!", tip.x, SURFACE_Y + 30 + Math.sin(time * 30) * 2, 30, "#ff595e");
  }
}

/** On the line: the hook stays in the fish's mouth while he reels it in. */
export function drawHookedCue(view: View, a: Angler, game: Game): void {
  if (a.state !== "hooked" && a.state !== "landed") return;
  drawHook(view.ctx, a.hookX, a.hookY, false, game.time);
}

/**
 * The fisherman's trophy photo: him in his boat, grinning, holding up the
 * pufferfish he just landed. Kept in memory for this run only.
 */
export function captureTrophyPhoto(view: View, game: Game): Photo | null {
  const W = 320;
  const H = 240;
  const photo = newCanvas(W, H);
  if (!photo) return null;
  const octx = photo.ctx;
  const sky = octx.createLinearGradient(0, 0, 0, 160);
  sky.addColorStop(0, "#7ec8e3");
  sky.addColorStop(1, "#ffe8d6");
  octx.fillStyle = sky;
  octx.fillRect(0, 0, W, H);
  // The harbour behind: sun, a far shore with a few houses and a church.
  octx.fillStyle = "#fff3b0";
  circle(octx, 262, 52, 22);
  octx.fillStyle = "#9fb7c3";
  octx.beginPath();
  octx.moveTo(0, 150);
  for (let i = 0; i <= 16; i++) {
    const x = i * 20;
    const h = 8 + rnd(i + 7) * 18;
    octx.lineTo(x, 150 - h);
    octx.lineTo(x + 14, 150 - h);
  }
  octx.lineTo(W, 150);
  octx.closePath();
  octx.fill();
  const sea = octx.createLinearGradient(0, 148, 0, H);
  sea.addColorStop(0, "#48cae4");
  sea.addColorStop(1, "#1b8fb5");
  octx.fillStyle = sea;
  octx.fillRect(0, 148, W, H - 148);

  const boatAt = { x: 218, y: 206 };
  const fishAt = { x: 84, y: 118 };
  const s = 2.2;
  const fs = 1.3;
  const tip = { x: fishAt.x + 2, y: 22 };
  const b = game.bird;
  const savedBird = { ...b };
  const savedFish = { ...game.fish };
  const savedSpike = game.spike;
  const savedPhase = game.phase;
  const savedTransition = game.transition;
  const savedStage = game.stage;
  try {
    octx.setTransform(s, 0, 0, s, boatAt.x, boatAt.y);
    drawFisherman(octx, (tip.x - boatAt.x) / s, (tip.y - boatAt.y) / s, 0.4, -0.1, game.time, "proud");
    drawBoatHull(octx, 7);
    octx.setTransform(1, 0, 0, 1, 0, 0);
    // Water lapping at the hull.
    octx.fillStyle = "rgba(72,202,228,0.8)";
    octx.beginPath();
    octx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) octx.lineTo(x, boatAt.y + 4 + Math.sin(x * 0.12) * 2.5);
    octx.lineTo(W, H);
    octx.closePath();
    octx.fill();
    // The line from the rod tip to the fish's mouth.
    octx.strokeStyle = "rgba(255,255,255,0.95)";
    octx.lineWidth = 1.5;
    line(octx, tip.x, tip.y, fishAt.x + 2, fishAt.y - 40);
    // The fish dangles, nose up, puffed up in a last protest.
    octx.setTransform(fs, 0, 0, fs, fishAt.x, fishAt.y);
    game.stage = "ocean";
    game.phase = "playing";
    game.transition = null;
    game.spike = initialSpikeState();
    Object.assign(game.fish, { puff: 1, spikes: 0, flare: 0 });
    Object.assign(b, { x: 0, y: 0, vy: 0, rot: -Math.PI / 2 + 0.15, stretch: 1, stretchV: 0 });
    drawOn(view, octx, () => drawFish(view, game));
    octx.setTransform(1, 0, 0, 1, 0, 0);
    drawHook(octx, fishAt.x + 2, fishAt.y - 36, false, 0);
  } finally {
    Object.assign(b, savedBird);
    Object.assign(game.fish, savedFish);
    game.spike = savedSpike;
    game.phase = savedPhase;
    game.transition = savedTransition;
    game.stage = savedStage;
  }

  vignette(octx, W, H, "20,40,60", 0.3);
  return photo.canvas;
}
