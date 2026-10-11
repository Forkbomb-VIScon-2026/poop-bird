// The practice perch before a run: a nest on an old street lamp.

import { GROUND_Y, PERCH_Y } from "../game";
import { oval, roundRect } from "./shapes";
import { OUTLINE, type View } from "./view";

/** The perch's nest, relative to the perched bird's centre (PERCH_Y): its rim, depth and half-width. */
const NEST_RIM = 8;

const NEST_DEPTH = 30;

const NEST_RX = 36;

/**
 * The practice perch: the bird's nest on the flat cap of an old lantern
 * street lamp (game.perch). This is the lamp and the inside of the nest;
 * drawNestFront() covers the bird's belly once the bird is drawn, so it sits
 * in the nest.
 */
export function drawPerch(view: View, x: number): void {
  const ctx = view.ctx;
  // The nest's bowl rests on the cap's flat top.
  const cap = PERCH_Y + NEST_DEPTH - 2;
  const glassTop = cap + 18;
  const glassBottom = glassTop + 44;
  const neck = glassBottom + 6;
  const foot = GROUND_Y + 16;
  const iron = "#3d4a5c";
  const ironLight = "#5a6a80";
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = "round";

  // A soft glow around the lantern.
  const glowY = (glassTop + glassBottom) / 2;
  const glow = ctx.createRadialGradient(x, glowY, 8, x, glowY, 80);
  glow.addColorStop(0, "rgba(255,236,150,0.45)");
  glow.addColorStop(1, "rgba(255,236,150,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 80, glowY - 80, 160, 160);

  // Pole: a slim shaft with a collar, flaring into a fluted base.
  ctx.fillStyle = iron;
  ctx.fillRect(x - 6, neck, 12, foot - neck);
  ctx.strokeRect(x - 6, neck, 12, foot - neck);
  ctx.fillStyle = ironLight;
  ctx.fillRect(x - 3, neck + 14, 3, foot - neck - 60);
  ctx.fillStyle = iron;
  roundRect(ctx, x - 10, neck + 40, 20, 8, 3);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 8, foot - 56);
  ctx.lineTo(x + 8, foot - 56);
  ctx.quadraticCurveTo(x + 10, foot - 24, x + 18, foot - 10);
  ctx.lineTo(x - 18, foot - 10);
  ctx.quadraticCurveTo(x - 10, foot - 24, x - 8, foot - 56);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, x - 22, foot - 12, 44, 14, 3);
  ctx.fill();
  ctx.stroke();

  // Neck: tapers from the lantern's floor into the pole.
  ctx.beginPath();
  ctx.moveTo(x - 18, glassBottom);
  ctx.lineTo(x + 18, glassBottom);
  ctx.lineTo(x + 8, neck + 4);
  ctx.lineTo(x - 8, neck + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Glass: four panes, wider at the top, lit from inside.
  const light = ctx.createLinearGradient(0, glassTop, 0, glassBottom);
  light.addColorStop(0, "#fffbe0");
  light.addColorStop(1, "#ffd45c");
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(x - 24, glassTop);
  ctx.lineTo(x + 24, glassTop);
  ctx.lineTo(x + 16, glassBottom);
  ctx.lineTo(x - 16, glassBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 8, glassTop);
  ctx.lineTo(x - 5, glassBottom);
  ctx.moveTo(x + 8, glassTop);
  ctx.lineTo(x + 5, glassBottom);
  ctx.stroke();
  // The bulb.
  ctx.fillStyle = "#fff";
  oval(ctx, x, glassBottom - 14, 4, 6);
  ctx.lineWidth = 3;

  // Cap: a hood sloping out from the glass to a wide, flat brim.
  ctx.fillStyle = iron;
  ctx.beginPath();
  ctx.moveTo(x - 26, glassTop + 2);
  ctx.lineTo(x - 36, cap + 8);
  ctx.lineTo(x + 36, cap + 8);
  ctx.lineTo(x + 26, glassTop + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, x - 44, cap, 88, 9, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = ironLight;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 38, cap + 3);
  ctx.lineTo(x + 38, cap + 3);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = "miter";

  // The inside of the nest, behind the bird.
  ctx.fillStyle = "#5c3b1e";
  oval(ctx, x, PERCH_Y + NEST_RIM, NEST_RX, 9, 0, true);
}

/** The front of the nest: a woven bowl over the bird's belly, with twigs sticking out. */
export function drawNestFront(view: View, x: number): void {
  const ctx = view.ctx;
  const y0 = PERCH_Y + NEST_RIM;
  const bottom = PERCH_Y + NEST_DEPTH;
  ctx.strokeStyle = OUTLINE;
  ctx.lineCap = "round";
  // Twigs poking out of the sides.
  ctx.lineWidth = 2.5;
  for (const [dx, dy, ex, ey] of [[-30, 8, -46, -2], [-24, 16, -42, 20], [28, 6, 46, -4], [26, 15, 44, 22]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y0 + dy);
    ctx.lineTo(x + ex, y0 + ey);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.fillStyle = "#a0703c";
  ctx.beginPath();
  ctx.moveTo(x - NEST_RX - 2, y0);
  ctx.quadraticCurveTo(x, y0 + 16, x + NEST_RX + 2, y0);
  ctx.quadraticCurveTo(x + NEST_RX - 2, bottom, x, bottom + 2);
  ctx.quadraticCurveTo(x - NEST_RX + 2, bottom, x - NEST_RX - 2, y0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Woven straw.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#d9a865";
  for (let i = 0; i < 3; i++) {
    const y = y0 + 8 + i * 6;
    const w = NEST_RX - 4 - i * 6;
    ctx.beginPath();
    ctx.moveTo(x - w, y - 3);
    ctx.quadraticCurveTo(x - w / 3, y + 4, x + w / 4, y - 1);
    ctx.moveTo(x - w / 6, y + 3);
    ctx.quadraticCurveTo(x + w / 2, y + 5, x + w, y - 3);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}
