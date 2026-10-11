// Slingshot kids, their aim arc and their pebbles.

import { config } from "../config";
import { PEBBLE_R, slingshotPos, type Game, type Pebble, type Target } from "../game";
import { rnd } from "../random";
import { drawPhoto as drawRtxPhoto, RTX } from "../rtx";
import { circle, oval, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

/** Slingshot kids are drawn at this scale (their hitbox is the target's w × h). */
const KID_SCALE = 1.35;

/**
 * A slingshot kid: propeller beanie, striped shirt, and a slingshot whose band
 * stretches back as he winds up. `t.x, t.y` is the origin (his feet).
 */
export function drawKid(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  const k = t.kid;
  if (!k) return;
  // Drawn larger than his proportions suggest, so the slingshot reads at a glance.
  const scale = KID_SCALE;
  const h = t.h / scale;
  const f = t.facing;
  const moving = t.speed !== 0;
  const stride = moving ? Math.sin(time * (k.state === "crying" ? 18 : 11) + t.seed) * 0.6 : 0;
  const hop =
    k.state === "cheering" ? Math.abs(Math.sin(time * 11 + t.seed)) * 9 :
    k.state === "taunting" ? Math.abs(Math.sin(time * 7 + t.seed)) * 3 : 0;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(0, -hop);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const hipY = -h * 0.34;
  const shoulderY = -h * 0.62;
  const headY = -h * 0.8;

  const photo = RTX.on && drawRtxPhoto(ctx, "kid", 0, 0, 0, h * 1.05);
  if (!photo) {
  // Legs (planted wide while aiming) and sneakers
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  const aiming = k.state === "aiming" || k.state === "reloading";
  const feet: number[] = [];
  for (const s of [1, -1]) {
    const footX = moving ? Math.sin(stride * s) * 9 : aiming ? s * 7 : s * 4;
    feet.push(footX);
    ctx.beginPath();
    ctx.moveTo(s * 3, hipY);
    ctx.lineTo(footX, -2);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 2;
  for (const fx of feet) {
    roundRect(ctx, fx - 3 + f * 1, -5, 8, 5, 2);
    ctx.fill();
    ctx.stroke();
  }
  // Shorts
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "#3a86ff";
  roundRect(ctx, -8, -h * 0.44, 16, h * 0.13, 3);
  ctx.fill();
  ctx.stroke();
  // Striped shirt
  ctx.save();
  roundRect(ctx, -8.5, -h * 0.68, 17, h * 0.27, 5);
  ctx.fillStyle = t.color;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let i = 0; i < 4; i++) ctx.fillRect(-10, -h * 0.66 + i * 3.4, 20, 1.6);
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  roundRect(ctx, -8.5, -h * 0.68, 17, h * 0.27, 5);
  ctx.stroke();

  }

  // Arms and slingshot (screen space, so the aim angle works both ways)
  drawKidArms(ctx, t, time, shoulderY);

  if (!photo) {
  // Head
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = "#f1c27d";
  circle(ctx, 0, headY, 10, true);
  // Propeller beanie: spins faster when he's excited
  const cap = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4"];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cap[i];
    ctx.beginPath();
    ctx.moveTo(0, headY - 3);
    ctx.arc(0, headY - 3, 10.5, Math.PI + (i * Math.PI) / 4, Math.PI + ((i + 1) * Math.PI) / 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, headY - 3, 10.5, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, headY - 13);
  ctx.lineTo(0, headY - 18);
  ctx.stroke();
  const spin = time * (k.state === "cheering" || k.state === "crying" ? 40 : k.state === "aiming" ? 6 + k.pull * 30 : 12) + t.seed;
  const blade = Math.cos(spin) * 9;
  ctx.fillStyle = "#ffca3a";
  ctx.beginPath();
  ctx.ellipse(blade / 2, headY - 18, Math.abs(blade / 2) + 0.8, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(-blade / 2, headY - 18, Math.abs(blade / 2) + 0.8, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Face (facing direction)
  ctx.save();
  ctx.scale(f, 1);
  ctx.fillStyle = OUTLINE;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.8;
  const ey = headY + 1;
  if (k.state === "crying") {
    // Squeezed-shut eyes and a wailing mouth
    for (const ex of [1, 7]) {
      ctx.beginPath();
      ctx.moveTo(ex - 2.5, ey - 1);
      ctx.lineTo(ex + 0.5, ey + 1);
      ctx.lineTo(ex - 2.5, ey + 2.5);
      ctx.stroke();
    }
    oval(ctx, 4, headY + 6.5, 3, 3.5 + Math.sin(time * 20) * 0.8);
  } else if (k.state === "aiming") {
    // One eye squinted, tongue poking out in concentration
    circle(ctx, 7, ey, 1.8);
    ctx.beginPath();
    ctx.moveTo(-0.5, ey);
    ctx.lineTo(3, ey);
    ctx.stroke();
    ctx.fillStyle = "#ff8fab";
    oval(ctx, 7.5, headY + 6.5, 2.2, 1.8, 0.4);
  } else {
    ctx.beginPath();
    ctx.arc(1.5, ey, 1.6, 0, Math.PI * 2);
    ctx.arc(7, ey, 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (k.state === "taunting") {
      // Nyah nyah: big tongue out
      ctx.beginPath();
      ctx.arc(4.5, headY + 5.5, 3, 0, Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#ff5d8f";
      roundRect(ctx, 3, headY + 6, 3.4, 4.5 + Math.sin(time * 9) * 1, 1.7);
      ctx.fill();
    } else if (k.state === "cheering") {
      ctx.fillStyle = "#6a040f";
      ctx.beginPath();
      ctx.arc(4.5, headY + 5, 3.5, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    } else {
      // A cheeky grin
      ctx.beginPath();
      ctx.arc(3.5, headY + 4, 3.5, 0.3, Math.PI - 0.6);
      ctx.stroke();
    }
  }
  // Freckles
  ctx.fillStyle = "#c68642";
  for (const [fx, fy] of [[-1, 3.5], [1, 4.8], [8.5, 4], [6.8, 5.2]]) ctx.fillRect(fx, headY + fy, 1.1, 1.1);
  ctx.restore();

  // Tears fountaining off both sides
  if (k.state === "crying") {
    ctx.fillStyle = "#8ecae6";
    for (let i = 0; i < 6; i++) {
      const ph = (time * 2.6 + i / 6) % 1;
      const side = i % 2 ? 1 : -1;
      ctx.globalAlpha = 1 - ph;
      circle(ctx, side * (6 + ph * 22), headY + 1 - ph * 10 + ph * ph * 34, 2.2);
    }
    ctx.globalAlpha = 1;
  }

  }

  // Warning: a "!" that grows and flashes as the band stretches
  if (k.state === "aiming") {
    const s = 0.8 + k.pull * 0.6;
    const flash = k.pull > 0.65 && Math.sin(time * 30) > 0;
    ctx.save();
    ctx.translate(0, headY - 34 - k.pull * 4);
    ctx.scale(s, s);
    ctx.fillStyle = flash ? "#fff" : "#ff3b3b";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    circle(ctx, 0, 0, 11, true);
    ctx.fillStyle = flash ? "#ff3b3b" : "#fff";
    ctx.font = "900 17px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 0, 1);
    ctx.restore();
  }
  ctx.restore();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

function drawKidArms(ctx: CanvasRenderingContext2D, t: Target, time: number, shoulderY: number): void {
  const k = t.kid!;
  const f = t.facing;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.5;
  const arm = (x: number, y: number) => {
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + 1);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  if (k.state === "crying") {
    // Arms flailing over his head, slingshot dropped
    const w = Math.sin(time * 22) * 4;
    arm(-8 + w, shoulderY - 12);
    arm(8 - w, shoulderY - 12);
    return;
  }
  if (k.state === "cheering") {
    const wave = Math.sin(time * 14) * 3;
    arm(-15, shoulderY - 15 + wave);
    drawSlingshotFork(ctx, 15, shoulderY - 15 - wave, -Math.PI / 2, 0, 0, false);
    arm(15, shoulderY - 15 - wave);
    return;
  }
  if (k.state === "taunting" || k.state === "walking" || (k.state === "reloading" && t.speed !== 0)) {
    // Slingshot dangling at his side; when taunting, a waggle at the bird
    const swing = Math.sin(time * 11 + t.seed) * 3;
    drawSlingshotFork(ctx, -f * 6, shoulderY + 14 + swing, Math.PI / 2, 0, 0, false);
    arm(-f * 6, shoulderY + 14 + swing);
    if (k.state === "taunting") {
      const wag = Math.sin(time * 16) * 3;
      arm(f * 11, shoulderY - 8 + wag);
    } else arm(f * 6, shoulderY + 13 - swing);
    return;
  }
  // Aiming / reloading: front arm out along the aim, back hand pulls the pouch.
  const a = Math.atan2(k.aimVy, k.aimVx);
  const forkX = Math.cos(a) * 13;
  const forkY = shoulderY + Math.sin(a) * 13;
  const pull = k.state === "aiming" ? k.pull : 0;
  const shake = pull > 0.8 ? (Math.random() - 0.5) * 1.5 : 0;
  const twang = k.twang > 0 ? Math.sin(time * 90) * k.twang * 20 : 0;
  const back = 4 + pull * 15 - twang;
  drawSlingshotFork(ctx, forkX + shake, forkY + shake, a, back, pull, k.state === "aiming");
  arm(forkX + shake, forkY + shake);
  arm(forkX - Math.cos(a) * back, forkY - Math.sin(a) * back);
}

/**
 * A Y-shaped slingshot at (x, y), shooting along angle `a`. The band runs from
 * the prong tips back to a pouch `back` px behind the fork.
 */
function drawSlingshotFork(
  ctx: CanvasRenderingContext2D, x: number, y: number, a: number, back: number, pull: number, loaded: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  // In this frame +x is the shot direction; the prongs point "up" (-y) across it.
  const tipA = { x: 2, y: -8 };
  const tipB = { x: -1, y: -9 };
  ctx.lineCap = "round";
  // Band behind
  ctx.strokeStyle = pull > 0.7 ? "#d00000" : "#9d0208";
  ctx.lineWidth = 1.6 + (1 - pull) * 0.6;
  ctx.beginPath();
  ctx.moveTo(tipB.x, tipB.y);
  ctx.lineTo(-back, -4);
  ctx.lineTo(tipA.x, tipA.y);
  ctx.stroke();
  // Wooden fork
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -2);
  ctx.lineTo(tipA.x, tipA.y);
  ctx.moveTo(0, -2);
  ctx.lineTo(tipB.x, tipB.y);
  ctx.stroke();
  ctx.strokeStyle = "#a47148";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // Pebble in the pouch
  if (loaded) {
    ctx.fillStyle = "#8d99ae";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    circle(ctx, -back, -4, 3.5, true);
  }
  ctx.restore();
}

/** A pebble: a lumpy grey rock with a speed streak. */
export function drawPebble(ctx: CanvasRenderingContext2D, p: Pebble): void {
  const sp = Math.hypot(p.vx, p.vy) || 1;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = PEBBLE_R * 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - (p.vx / sp) * 26, p.y - (p.vy / sp) * 26);
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = "#8d99ae";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    // Drawn a bit larger than its hit radius so it reads in flight.
    const r = PEBBLE_R * 1.35 * (0.85 + 0.3 * rnd(i * 13.7 + p.from.seed));
    ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  circle(ctx, -1.5, -1.5, 1.4);
  ctx.restore();
}

/**
 * The aim of a kid who's winding up: a dotted arc that reaches out further
 * the more he pulls, ending in a crosshair on the bird.
 */
export function drawKidAim(view: View, t: Target, game: Game): void {
  const k = t.kid;
  if (!k || k.state !== "aiming" || game.phase !== "playing") return;
  const ctx = view.ctx;
  const g = config.kidPebbleGravity;
  const s = slingshotPos(t);
  const pts: { x: number; y: number }[] = [];
  const step = 1 / 60;
  for (let i = 0; i < 180; i++) {
    const tt = i * step;
    const x = s.x + k.aimVx * tt;
    const y = s.y + k.aimVy * tt + 0.5 * g * tt * tt;
    pts.push({ x, y });
    if (x <= game.bird.x) break;
  }
  const shown = Math.ceil(pts.length * (0.3 + 0.7 * k.pull));
  const march = Math.floor(game.time * 30) % 3;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  for (let i = 0; i < shown; i++) {
    if ((i + march) % 3 !== 0) continue;
    const p = pts[i];
    ctx.globalAlpha = (0.35 + 0.65 * k.pull) * (1 - (i / pts.length) * 0.3);
    ctx.fillStyle = "#ff3b3b";
    circle(ctx, p.x, p.y, 3 + k.pull * 1.5, true);
  }
  ctx.globalAlpha = 1;
  if (k.pull < 0.45) return;
  // Crosshair where the pebble's going
  const end = pts[pts.length - 1];
  const a = Math.min(1, (k.pull - 0.45) / 0.3);
  const r = 40 - k.pull * 10 + Math.sin(game.time * 20) * 1.5;
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.rotate(game.time * 2);
  ctx.globalAlpha = a;
  ctx.strokeStyle = "#ff3b3b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    ctx.moveTo(Math.cos(ang) * (r - 7), Math.sin(ang) * (r - 7));
    ctx.lineTo(Math.cos(ang) * (r + 7), Math.sin(ang) * (r + 7));
  }
  ctx.stroke();
  ctx.restore();
}
