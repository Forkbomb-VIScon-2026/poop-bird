// Hot-air balloons, their deflated envelope, and the passengers under their parachutes.

import { BALLOON_RX, BALLOON_RY, basketRect, type Balloon, type Target } from "../game";
import { rnd } from "../random";
import { drawPhoto as drawRtxPhoto, RTX, rtxBalloonEnvelope, rtxBasket, rtxSkydiver } from "../rtx";
import { circle, oval, roundRect, shadeHex } from "./shapes";
import { OUTLINE, type View } from "./view";

/** The envelope outline: a dome on top, tapering down to the mouth. */
function envelopePath(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const rx = BALLOON_RX;
  const ry = BALLOON_RY;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + ry);
  ctx.bezierCurveTo(cx - rx * 0.75, cy + ry * 0.6, cx - rx, cy + ry * 0.25, cx - rx, cy - ry * 0.1);
  ctx.ellipse(cx, cy - ry * 0.1, rx, ry * 0.9, 0, Math.PI, Math.PI * 2);
  ctx.bezierCurveTo(cx + rx, cy + ry * 0.25, cx + rx * 0.75, cy + ry * 0.6, cx + 14, cy + ry);
  ctx.closePath();
}

/** A flame standing on (x, y): a teardrop `h` tall and `w` wide at its base. */
function flamePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 0.9, y - h * 0.55, x, y - h);
  ctx.quadraticCurveTo(x + w * 0.9, y - h * 0.55, x + w, y);
  ctx.closePath();
}

/** The popped envelope: a crumpled, flapping rag that falls and lies flat on the street. */
function drawRag(ctx: CanvasRenderingContext2D, b: Balloon, time: number): void {
  const r = b.rag!;
  if (r.x < -100) return;
  const flat = r.landed ? 0.45 : 1;
  const n = 12;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = r.landed ? 0 : Math.sin(time * 11 + i * 1.7 + b.seed) * 4;
    const rad = 26 + rnd(b.seed + i) * 14 + wob;
    pts.push({ x: r.x + Math.cos(a) * rad * 1.3, y: r.y + Math.sin(a) * rad * 0.7 * flat });
  }
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = b.colors[0];
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = b.colors[1];
  for (let i = -2; i <= 2; i += 2) {
    oval(ctx, r.x + i * 14, r.y, 6, 40, 0.3);
  }
  ctx.restore();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** A bailed-out balloon passenger: tumbling with arms flailing, then hanging under a striped canopy. */
export function drawParachutist(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
  if (RTX.on) {
    // The canopy photo once it's open; before that, just the skydiver, tumbling.
    const chute = t.chute!;
    ctx.save();
    let ok: boolean;
    if (chute.open) {
      const age = chute.t - chute.openAt;
      const pop = age < 0.25 ? 0.4 + (age / 0.25) * 0.75 : 1.15 - Math.min(0.15, (age - 0.25) * 0.6);
      ctx.translate(0, -96);
      ctx.rotate(Math.sin(time * 1.8 + t.seed) * 0.13);
      ctx.translate(0, 96);
      ctx.scale(pop, 1);
      ok = drawRtxPhoto(ctx, "parachutist", 0, 0, 0, 150);
    } else {
      ctx.translate(0, -24);
      ctx.rotate(chute.t * 9 * (t.facing || 1));
      ctx.translate(0, 24);
      ok = rtxSkydiver(ctx, 56);
    }
    ctx.restore();
    if (ok) return;
  }
  const c = t.chute!;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  if (c.open) {
    // Swing like a pendulum under the canopy; it pops open with a little overshoot.
    const age = c.t - c.openAt;
    const pop = age < 0.25 ? 0.4 + (age / 0.25) * 0.75 : 1.15 - Math.min(0.15, (age - 0.25) * 0.6);
    ctx.translate(0, -96);
    ctx.rotate(Math.sin(time * 1.8 + t.seed) * 0.13);
    ctx.translate(0, 96);
    // Lines
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const dx of [-25, -9, 9, 25]) {
      ctx.moveTo(dx * pop, -74);
      ctx.lineTo(Math.sign(dx) * 5, -38);
    }
    ctx.stroke();
    // Canopy with a white centre panel and a scalloped hem.
    ctx.save();
    ctx.translate(0, -76);
    ctx.scale(pop, pop);
    ctx.beginPath();
    ctx.arc(0, 0, 26, Math.PI, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const x0 = 26 - i * 13;
      ctx.quadraticCurveTo(x0 - 6.5, 6, x0 - 13, 0);
    }
    ctx.closePath();
    ctx.fillStyle = c.canopy;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(-6, -30, 12, 40);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  } else {
    // Tumbling
    ctx.translate(0, -24);
    ctx.rotate(c.t * 9 * (t.facing || 1));
    ctx.translate(0, 24);
  }
  const flail = c.open ? Math.sin(time * 3 + t.seed) * 0.2 : Math.sin(time * 30 + t.seed);
  // Legs
  ctx.lineWidth = 5;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(s * (5 + flail * 4), 0);
    ctx.stroke();
  }
  // Body (with a backpack)
  ctx.lineWidth = 3;
  ctx.fillStyle = "#6c757d";
  roundRect(ctx, -11 * t.facing - 3, -36, 6, 14, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.color;
  roundRect(ctx, -8, -38, 16, 21, 6);
  ctx.fill();
  ctx.stroke();
  // Arms: holding the lines, or windmilling.
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const s of [1, -1]) {
    ctx.moveTo(s * 5, -34);
    if (c.open) ctx.lineTo(s * 6, -46);
    else ctx.lineTo(s * 14 + flail * 6, -46 + s * flail * 8);
  }
  ctx.stroke();
  // Head, with a mouth wide open in freefall.
  ctx.lineWidth = 3;
  ctx.fillStyle = "#f1c27d";
  circle(ctx, 0, -45, 8, true);
  ctx.fillStyle = t.seed % 2 > 1 ? "#3d405b" : "#6b4226";
  ctx.beginPath();
  ctx.arc(0, -47, 8, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(-3, -45, 1.4, 0, Math.PI * 2);
  ctx.arc(3, -45, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  if (c.open) ctx.arc(0, -41, 2, 0.1 * Math.PI, 0.9 * Math.PI);
  else ctx.ellipse(0, -40.5, 2.2, 3, 0, 0, Math.PI * 2);
  if (c.open) {
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else ctx.fill();
  ctx.restore();
  ctx.lineCap = "butt";
}

/** Hot-air balloon: striped envelope, burner, ropes, wicker basket with passengers; after the pop a falling basket and rag. */
export function drawBalloon(view: View, b: Balloon, time: number): void {
  const ctx = view.ctx;
  if (b.rag) drawRag(ctx, b, time);
  if (b.x < -100 || b.x > view.width + 120) return;
  const cx = b.x;
  const cy = b.y;
  const mouthY = cy + BALLOON_RY;
  const basket = basketRect(b);
  ctx.strokeStyle = OUTLINE;
  ctx.lineCap = "round";

  if (!b.popped) {
    // Ropes from the envelope's mouth down to the basket.
    ctx.lineWidth = 2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 14, mouthY - 2);
      ctx.lineTo(basket.x + basket.w / 2 + s * (basket.w / 2 - 3), basket.y);
      ctx.moveTo(cx + s * 6, mouthY);
      ctx.lineTo(cx + s * 10, basket.y);
      ctx.stroke();
    }
    // Burner frame and flame: a small pilot, or a roaring blast now and then.
    const by = basket.y - 22;
    const flick = Math.sin(time * 40 + b.seed) * 0.5 + 0.5;
    const flameH = b.burn > 0 ? 26 + Math.min(1, b.burn / 0.15) * 20 + flick * 8 : 7 + flick * 3;
    const glow = ctx.createRadialGradient(cx, by - flameH * 0.4, 1, cx, by - flameH * 0.4, flameH);
    glow.addColorStop(0, b.burn > 0 ? "rgba(255,220,120,0.55)" : "rgba(120,180,255,0.35)");
    glow.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = glow;
    circle(ctx, cx, by - flameH * 0.4, flameH);
    ctx.fillStyle = b.burn > 0 ? "#ff9f1c" : "#5aa9ff";
    flamePath(ctx, cx, by, b.burn > 0 ? 8 : 4, flameH);
    ctx.fill();
    ctx.fillStyle = b.burn > 0 ? "#fff3b0" : "#cfe8ff";
    flamePath(ctx, cx, by, b.burn > 0 ? 4 : 2, flameH * 0.6);
    ctx.fill();
    ctx.fillStyle = "#adb5bd";
    ctx.lineWidth = 2.5;
    roundRect(ctx, cx - 10, by, 20, 8, 2);
    ctx.fill();
    ctx.stroke();

    if (!(RTX.on && rtxBalloonEnvelope(ctx, cx, cy, BALLOON_RX, BALLOON_RY))) {
    // Envelope: gores in two colours (nested ellipses clipped to the shape), a highlight, a skirt.
    ctx.save();
    envelopePath(ctx, cx, cy);
    ctx.clip();
    const [c1, c2] = b.colors;
    ctx.fillStyle = c1;
    ctx.fillRect(cx - BALLOON_RX - 2, cy - BALLOON_RY - 2, BALLOON_RX * 2 + 4, BALLOON_RY * 2 + 4);
    for (const [k, color] of [[0.66, c2], [0.33, c1]] as const) {
      ctx.fillStyle = color;
      oval(ctx, cx, cy - BALLOON_RY * 0.1, BALLOON_RX * k, BALLOON_RY * 1.15);
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(cx - BALLOON_RX, cy + BALLOON_RY * 0.5, BALLOON_RX * 2, 7);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    oval(ctx, cx - BALLOON_RX * 0.45, cy - BALLOON_RY * 0.4, 10, 24, 0.35);
    ctx.restore();
    ctx.lineWidth = 3;
    envelopePath(ctx, cx, cy);
    ctx.stroke();
    ctx.fillStyle = shadeHex(b.colors[0], -40);
    ctx.beginPath();
    ctx.moveTo(cx - 15, mouthY - 3);
    ctx.lineTo(cx + 15, mouthY - 3);
    ctx.lineTo(cx + 11, mouthY + 9);
    ctx.lineTo(cx - 11, mouthY + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    }
    // Photo balloons carry no cartoon passengers.
    if (!RTX.on) {
    // Passengers peeking over the rim; one of them waves.
    const n = b.passengers.length;
    b.passengers.forEach((p, i) => {
      const px = cx + (i - (n - 1) / 2) * 14;
      const hy = basket.y - 9 + Math.sin(time * 3 + p.seed) * 1.2;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = p.color;
      roundRect(ctx, px - 6, hy + 4, 12, 12, 4);
      ctx.fill();
      ctx.stroke();
      if (i === n - 1) {
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(px + 5, hy + 6);
        ctx.lineTo(px + 12 + Math.sin(time * 9 + p.seed) * 4, hy - 8);
        ctx.stroke();
      }
      ctx.lineWidth = 2.5;
      ctx.fillStyle = "#f1c27d";
      circle(ctx, px, hy, 6, true);
      ctx.fillStyle = p.seed % 2 > 1 ? "#3d405b" : "#6b4226";
      ctx.beginPath();
      ctx.arc(px, hy - 1.5, 6, Math.PI, Math.PI * 2);
      ctx.fill();
    });
    }
  } else if (!b.landed) {
    // Limp ropes trailing above the falling basket.
    ctx.lineWidth = 2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 20, basket.y);
      ctx.quadraticCurveTo(cx + s * (26 + Math.sin(time * 20 + s) * 4), basket.y - 18, cx + s * 14, basket.y - 34);
      ctx.stroke();
    }
  }

  // Wicker basket.
  ctx.save();
  if (b.landed) {
    ctx.translate(basket.x + basket.w / 2, basket.y + basket.h);
    ctx.rotate(0.12);
    ctx.translate(-(basket.x + basket.w / 2), -(basket.y + basket.h));
  }
  if (RTX.on && rtxBasket(ctx, basket)) {
    ctx.restore();
    ctx.lineCap = "butt";
    return;
  }
  ctx.lineWidth = 3;
  ctx.fillStyle = "#c68b59";
  ctx.beginPath();
  ctx.moveTo(basket.x, basket.y);
  ctx.lineTo(basket.x + basket.w, basket.y);
  ctx.lineTo(basket.x + basket.w - 4, basket.y + basket.h);
  ctx.lineTo(basket.x + 4, basket.y + basket.h);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(90,50,20,0.45)";
  ctx.lineWidth = 1.5;
  for (let y = basket.y + 10; y < basket.y + basket.h; y += 6) {
    ctx.beginPath();
    ctx.moveTo(basket.x, y);
    ctx.lineTo(basket.x + basket.w, y);
    ctx.stroke();
  }
  for (let x = basket.x + 6; x < basket.x + basket.w; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, basket.y);
    ctx.lineTo(x, basket.y + basket.h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#8b5a2b";
  roundRect(ctx, basket.x - 3, basket.y - 3, basket.w + 6, 8, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.lineCap = "butt";
}
