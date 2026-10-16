// The bird (city): its body, face and the charge meter; and the keyboard-mode photo of it.

import { BIRD_RADIUS, type Game } from "../game";
import { RTX } from "../rtx";
import { circle, drawStar, drawX, lerpColor, oval, rgb, roundRect, shade, type RGB } from "./shapes";
import { drawOn, newCanvas, OUTLINE, type Photo, type View } from "./view";

/** What drawBird reads (captureBird draws the bird outside the game). */
type BirdLook = Pick<Game, "bird" | "charge" | "stunned" | "phase" | "overstrainProgress" | "zapped" | "zapFlash" | "time">;

/** Keyboard-mode photo: a close-up of the bird, always caught mid-strain (that's the joke), without HUD. */
export function captureBirdPhoto(view: View, game: Game): Photo | null {
  const photo = newCanvas(200, 200);
  if (!photo) return null;
  const octx = photo.ctx;
  const g = octx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, "#5ec8f2");
  g.addColorStop(1, "#bde8f7");
  octx.fillStyle = g;
  octx.fillRect(0, 0, 200, 200);
  octx.fillStyle = "#8fb3c6";
  for (let i = 0; i < 5; i++) octx.fillRect(i * 44 - 6, 120 + ((i * 37) % 40), 36, 100);
  const zoom = 2.1;
  octx.setTransform(zoom, 0, 0, zoom, 100 - game.bird.x * zoom, 105 - game.bird.y * zoom);
  const charge = game.charge;
  const relief = game.bird.relief;
  game.charge = { ...charge, charge: Math.max(charge.charge, 0.9) };
  game.bird.relief = 0;
  try {
    drawOn(view, octx, () => drawBird(view, game));
  } finally {
    game.charge = charge;
    game.bird.relief = relief;
  }
  return photo.canvas;
}

export function drawBird(view: View, game: BirdLook): void {
  if (game.zapFlash > 0 && Math.floor(game.time * 24) % 2 === 0) return drawZappedBird(view, game);
  if (RTX.on && view.rtxPlayer.drawBird(view.ctx, game)) {
    if (game.stunned) {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 5 + (i * Math.PI * 2) / 3;
        drawStar(view.ctx, game.bird.x + Math.cos(a) * 30, game.bird.y - 34 + Math.sin(a) * 8, 7, "#ffd166");
      }
    }
    return;
  }
  const ctx = view.ctx;
  const b = game.bird;
  const c = game.charge.charge;
  const stunned = game.stunned;
  const dead = game.phase !== "playing";
  const danger = game.overstrainProgress;
  const r = BIRD_RADIUS * (1 + c * 0.28);

  ctx.save();
  let shakeX = 0;
  let shakeY = 0;
  if (c > 0.6) {
    const amp = (c - 0.6) * 4 + danger * 4;
    shakeX = (Math.random() - 0.5) * amp;
    shakeY = (Math.random() - 0.5) * amp;
  }
  ctx.translate(b.x + shakeX, b.y + shakeY);
  ctx.rotate(b.rot);
  // Squash & stretch (preserve area)
  const sy = b.stretch;
  ctx.scale(1 / Math.sqrt(sy), sy);

  // Body color: yellow → red as it charges, charred after a zap.
  const body: RGB = game.zapped
    ? [74, 66, 60]
    : lerpColor([255, 209, 102], [239, 71, 111], Math.min(1, c * 1.1));
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  // Tail
  ctx.fillStyle = shade(body, -30);
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, -r * 0.1);
  ctx.lineTo(-r * 1.45, -r * 0.55);
  ctx.lineTo(-r * 1.35, r * 0.05);
  ctx.lineTo(-r * 1.5, r * 0.4);
  ctx.lineTo(-r * 0.8, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Body
  ctx.fillStyle = rgb(body);
  oval(ctx, 0, 0, r * 1.05, r, 0, true);
  // Belly
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  oval(ctx, -r * 0.05, r * 0.4, r * 0.6, r * 0.42);

  // Wing
  const flapping = b.flap > 0 || dead;
  const wingAngle = flapping ? Math.sin(game.time * 40) * 0.9 : c > 0 ? 0.5 + c * 0.4 : Math.sin(game.time * 5) * 0.25;
  ctx.save();
  ctx.translate(-r * 0.25, r * 0.05);
  ctx.rotate(-wingAngle);
  ctx.fillStyle = shade(body, -20);
  oval(ctx, -r * 0.35, 0, r * 0.55, r * 0.3, -0.2, true);
  ctx.restore();

  // Beak: open as far as the player's mouth is, else clenched shut while straining.
  const open = dead || stunned ? 0 : view.mouthOpen;
  const clench = c > 0.3 && open < 0.15 ? 1 : 0;
  ctx.fillStyle = "#f78c3b";
  if (open > 0.02) {
    // Upper and lower halves hinged at the beak's base, with the mouth showing between them.
    const hx = r * 0.92;
    const hy = r * 0.09;
    const len = r * 0.58;
    const up = -open * 0.4;
    const down = open * 0.8;
    ctx.fillStyle = "#7a1f2b";
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.1, hy);
    ctx.lineTo(hx + Math.cos(up) * len * 0.6, hy + Math.sin(up) * len * 0.6);
    ctx.lineTo(hx + Math.cos(down) * len * 0.6, hy + Math.sin(down) * len * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f78c3b";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    for (const [angle, side] of [[up, -1], [down, 1]]) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, side * r * 0.3);
      ctx.lineTo(len, 0);
      ctx.lineTo(-r * 0.15, -side * r * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = 3;
    ctx.lineJoin = "miter";
  } else {
    ctx.beginPath();
    ctx.moveTo(r * 0.8, -r * 0.12);
    ctx.lineTo(r * (1.45 - clench * 0.1), r * 0.08);
    ctx.lineTo(r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (clench) {
    // Gritted beak line
    ctx.beginPath();
    ctx.moveTo(r * 0.82, r * 0.09);
    for (let i = 1; i <= 4; i++) ctx.lineTo(r * (0.82 + i * 0.13), r * (0.09 + (i % 2 ? -0.05 : 0.05)));
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 3;
  }

  // Cheek blush
  if (c > 0.1 || b.relief > 0) {
    ctx.fillStyle = `rgba(214,40,57,${Math.min(0.75, c * 0.8 + (b.relief > 0 ? 0.2 : 0))})`;
    oval(ctx, r * 0.45, r * 0.4, r * 0.22, r * 0.13);
  }

  // Eyes
  const ex = r * 0.42;
  const ey = -r * 0.28;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = OUTLINE;
  if (dead || stunned) {
    drawX(ctx, ex, ey, r * 0.18);
  } else if (b.relief > 0) {
    // Blissful ^ ^
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ex, ey + 3, r * 0.17, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else if (c > 0.75) {
    // > < squeezed shut
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.18, ey - r * 0.14);
    ctx.lineTo(ex + r * 0.08, ey);
    ctx.lineTo(ex - r * 0.18, ey + r * 0.14);
    ctx.stroke();
  } else if (c > 0.3) {
    // Squinting: flattened eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.2, r * 0.2 * (1 - (c - 0.3) * 1.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    circle(ctx, ex + r * 0.05, ey, r * 0.07);
  } else {
    ctx.fillStyle = "#fff";
    circle(ctx, ex, ey, r * 0.22);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = OUTLINE;
    const look = Math.max(-1, Math.min(1, b.vy / 400));
    circle(ctx, ex + r * 0.07, ey + look * r * 0.07, r * 0.1);
  }
  // Brow: angled down as strain builds
  if (!dead && !stunned && (c > 0.05 || b.relief <= 0)) {
    const tilt = c * 0.35;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.25, ey - r * (0.32 + tilt * 0.3));
    ctx.lineTo(ex + r * 0.22, ey - r * (0.3 - tilt));
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  // Forehead veins at high strain
  if (c > 0.85 && !stunned) {
    ctx.strokeStyle = "#9d0208";
    ctx.lineWidth = 2;
    const vx = -r * 0.05;
    const vy = -r * 0.7;
    ctx.beginPath();
    ctx.moveTo(vx - 5, vy - 5);
    ctx.lineTo(vx, vy);
    ctx.lineTo(vx + 5, vy - 5);
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx, vy + 6);
    ctx.stroke();
  }
  ctx.restore();

  // Sweat drops (not rotated, they fall off)
  if (c > 0.55 && !stunned) {
    const n = c > 0.9 ? 3 : c > 0.75 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = (game.time * 1.6 + i * 0.37) % 1;
      const sx = b.x - r * 0.6 + i * 10 - t * 12;
      const syy = b.y - r * 0.9 + t * 26;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#8ecae6";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, syy - 7);
      ctx.quadraticCurveTo(sx + 5, syy, sx, syy + 3);
      ctx.quadraticCurveTo(sx - 5, syy, sx, syy - 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Dizzy stars while stunned
  if (stunned) {
    for (let i = 0; i < 3; i++) {
      const a = game.time * 5 + (i * Math.PI * 2) / 3;
      drawStar(ctx, b.x + Math.cos(a) * 30, b.y - 34 + Math.sin(a) * 8, 7, "#ffd166");
    }
  }
}

/** The cartoon X-ray frame of an electrocution: glowing outline, skeleton inside. */
function drawZappedBird(view: View, game: BirdLook): void {
  const ctx = view.ctx;
  const b = game.bird;
  const r = BIRD_RADIUS;
  ctx.save();
  ctx.translate(b.x + (Math.random() - 0.5) * 6, b.y + (Math.random() - 0.5) * 6);
  ctx.rotate(b.rot);
  ctx.fillStyle = "rgba(155,246,255,0.35)";
  circle(ctx, 0, 0, r * 1.9);
  ctx.fillStyle = "#1d3557";
  ctx.strokeStyle = "#9bf6ff";
  ctx.lineWidth = 3;
  oval(ctx, 0, 0, r * 1.05, r, 0, true);
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, -r * 0.1);
  ctx.lineTo(-r * 1.45, -r * 0.55);
  ctx.lineTo(-r * 1.5, r * 0.4);
  ctx.lineTo(-r * 0.8, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Skull, spine, ribs
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  circle(ctx, r * 0.45, -r * 0.2, r * 0.38);
  ctx.fillStyle = "#1d3557";
  circle(ctx, r * 0.55, -r * 0.28, r * 0.11);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r * 0.1, 0);
  ctx.lineTo(-r * 1.2, r * 0.05);
  for (let i = 0; i < 4; i++) {
    const x = -r * (0.05 + i * 0.25);
    ctx.moveTo(x, -r * 0.45);
    ctx.quadraticCurveTo(x - r * 0.12, 0, x, r * 0.45);
  }
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(r * 0.8, -r * 0.12);
  ctx.lineTo(r * 1.45, r * 0.08);
  ctx.lineTo(r * 0.8, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawChargeMeter(view: View, game: Game): void {
  const ctx = view.ctx;
  const b = game.bird;
  const c = game.charge.charge;
  if (c <= 0 || game.stunned) return;
  const x = b.x - BIRD_RADIUS * 2.6;
  const h = 64;
  const w = 12;
  const y = b.y - h / 2;
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  const sweet = game.sweetSpot;
  const danger = game.overstrainProgress;
  let color = c < 0.5 ? "#8ac926" : c < 1 ? "#ffca3a" : "#ff595e";
  if (sweet) color = Math.sin(game.time * 40) > 0 ? "#ffd700" : "#fff3a0";
  else if (c >= 1 && Math.sin(game.time * (12 + danger * 30)) > 0) color = "#ff9f1c";
  ctx.fillStyle = color;
  const fh = (h - 4) * c;
  roundRect(ctx, x + 2, y + h - 2 - fh, w - 4, fh, 3);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  roundRect(ctx, x, y, w, h, 5);
  ctx.stroke();
  if (c >= 1) {
    // Overstrain fuse below the meter
    ctx.fillStyle = "#2b2d42";
    ctx.fillRect(x - 4, y + h + 5, w + 8, 5);
    ctx.fillStyle = sweet ? "#ffd700" : "#ff595e";
    ctx.fillRect(x - 4, y + h + 5, (w + 8) * danger, 5);
    ctx.font = "900 18px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUTLINE;
    const label = sweet ? "NOW!" : "!";
    ctx.strokeText(label, x + w / 2, y - 12);
    ctx.fillStyle = sweet ? "#ffd700" : "#ff595e";
    ctx.fillText(label, x + w / 2, y - 12);
  }
}
