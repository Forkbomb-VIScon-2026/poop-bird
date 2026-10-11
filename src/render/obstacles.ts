// Obstacles: buildings, billboards (with their front page), coral, rocks, wrecks and anchored boats.

import { ANCHOR_H, ANCHOR_RIP_Y, anchorChainLength, anchorCrown, anchorRipped, BILLBOARD_H, BILLBOARD_LEGS_INSET, BOAT_DRAFT, BOAT_FREEBOARD, BOAT_W, GROUND_Y, obstacleRects, SURFACE_Y, WRECK_MAST_W, wreckGeometry, type Obstacle, type Tabloid } from "../game";
import { rnd } from "../random";
import { RTX, rtxBillboard, rtxBuilding, rtxSeaColumn } from "../rtx";
import { drawSplat } from "./effects";
import { circle, drawPhoto, drawStar, outlinedText, oval, roundRect, shadeHex, wrapText } from "./shapes";
import { OUTLINE, type Photo, type View } from "./view";
import { drawChurch } from "./wedding";

/** Topside paint of the anchored boats in the ocean. */
const BOAT_COLORS = ["#f8f9fa", "#ffd166", "#4ea8de", "#06d6a0", "#ef8354"];

/** The billboard's landscape layout: masthead across the top, the photo on the left, the headline beside it. */
function drawBillboardAd(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tabloid: Tabloid | null,
  photos: ReadonlyMap<number, Photo>,
): void {
  const pad = 6;
  ctx.save();
  ctx.fillStyle = "#f5f1e6";
  ctx.fillRect(x, y, w, h);
  // Masthead
  const mastH = h * 0.2;
  ctx.fillStyle = "#d62828";
  ctx.fillRect(x, y, w, mastH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `italic 900 ${mastH * 0.66}px Georgia, 'Times New Roman', serif`;
  ctx.fillText("The Daily Dropping", x + w / 2, y + mastH / 2 + 1, w - pad * 2);

  // Photo on the left
  const photoY = y + mastH + pad;
  const photoH = y + h - pad - photoY;
  const photoW = Math.min(photoH * 0.95, w * 0.45);
  drawPhoto(ctx, tabloid ? photos.get(tabloid.photoId) : undefined, x + pad, photoY, photoW, photoH);

  // Headline on the right, as big as fits in up to 4 lines
  const tx = x + pad * 2 + photoW;
  const tw = x + w - pad - tx;
  const headline = tabloid?.headline ?? "EXCLUSIVE";
  let hs = photoH * 0.34;
  let lines: string[] = [];
  for (; hs > 6; hs *= 0.92) {
    ctx.font = `900 ${hs}px Impact, 'Arial Black', 'Trebuchet MS', sans-serif`;
    lines = wrapText(ctx, headline, tw);
    if (lines.length * hs * 1.05 <= photoH && lines.every((l) => ctx.measureText(l).width <= tw)) break;
  }
  ctx.fillStyle = "#111";
  const textTop = photoY + (photoH - lines.length * hs * 1.05) / 2;
  lines.forEach((l, i) => ctx.fillText(l, tx + tw / 2, textTop + hs * (0.55 + i * 1.05)));

  // EXCLUSIVE badge on the photo's corner
  ctx.save();
  ctx.translate(x + pad + photoW - 4, photoY + 6);
  ctx.rotate(0.3);
  drawStar(ctx, 0, 0, 18, "#ffd60a");
  ctx.fillStyle = "#d62828";
  ctx.font = "900 7px 'Trebuchet MS', sans-serif";
  ctx.fillText("EXCL!", 0, 1);
  ctx.restore();
  ctx.restore();
}

/** Where a chain link starts, and its turn from hanging straight down (radians). */
interface ChainLink {
  x: number;
  y: number;
  a: number;
}

/** Chain links, alternating face-on (a ring) and edge-on (a bar). */
function drawChain(ctx: CanvasRenderingContext2D, links: ChainLink[], iron: string): void {
  links.forEach((l, i) => {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.a);
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.ellipse(0, 6, 4.5, 7, 0, 0, Math.PI * 2);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = iron;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      roundRect(ctx, -2, 0, 4, 13, 2);
      ctx.fillStyle = iron;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** The last link of a ripped chain: a ring torn open at the bottom, its ends bent apart. */
function drawTornLink(ctx: CanvasRenderingContext2D, x: number, y: number, iron: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 4.5, 7, 0, Math.PI / 2 + 0.75, Math.PI * 2.5 - 0.75);
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = iron;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineCap = "butt";
}

export function drawObstacle(view: View, o: Obstacle, time: number): void {
  if (o.anchor) drawAnchoredBoat(view, o, time);
  if (o.bottom === "none") return;
  if (o.bottom === "coral" || o.bottom === "rock") return drawSeaObstacle(view, o);
  if (o.bottom === "wreck") return drawWreck(view, o, time);
  if (o.bottom === "church") return drawChurch(view.ctx, o, time);
  const ctx = view.ctx;
  const [base] = obstacleRects(o);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  // Bottom part
  if (o.bottom === "billboard") {
    drawBillboard(view, o, time);
  } else if (!(RTX.on && rtxBuilding(ctx, o.bottom === "tower", o.seed, base.x - 3, base.y, base.w + 6, GROUND_Y + 4 - base.y))) {
    ctx.fillStyle = o.color;
    roundRect(ctx, base.x, base.y, base.w, base.h + 4, 5);
    ctx.fill();
    ctx.stroke();
    // Roof trim
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(base.x + 2, base.y + 2, base.w - 4, 8);
    // Windows, with the bottom row kept clear of the door
    const doorTop = GROUND_Y - 26;
    const cols = Math.max(2, Math.floor((base.w - 16) / 22));
    const cw = (base.w - 16) / cols;
    for (let y = base.y + 20; y + 16 <= doorTop - 6; y += 30) {
      for (let c = 0; c < cols; c++) {
        const lit = rnd(o.seed + y * 0.37 + c * 3.1) > 0.45;
        ctx.fillStyle = lit ? "#ffe8a3" : "#3d405b";
        ctx.fillRect(base.x + 8 + c * cw + 3, y, cw - 6, 16);
      }
    }
    if (o.bottom === "tower") {
      // Antenna with blinking light on top of the tower roof.
      ctx.strokeStyle = OUTLINE;
      ctx.beginPath();
      ctx.moveTo(base.x + base.w / 2, base.y);
      ctx.lineTo(base.x + base.w / 2, base.y - 26);
      ctx.stroke();
      ctx.fillStyle = Math.sin(time * 6) > 0 ? "#ff4d4d" : "#7a1f1f";
      circle(ctx, base.x + base.w / 2, base.y - 28, 5);
    }
    // Door at the bottom
    ctx.fillStyle = "#3d405b";
    ctx.fillRect(base.x + base.w / 2 - 10, doorTop, 20, GROUND_Y - doorTop);
  }

  for (const s of o.splats) drawSplat(ctx, o.x + s.dx, s.dy, s.r, s.seed, 1);
}

/** Roadside billboard: the front page on a framed board, on a steel frame with a catwalk and lamps. */
function drawBillboard(view: View, o: Obstacle, time: number): void {
  if (RTX.on && rtxBillboard(view.ctx, o.x, o.gapBottom, o.w, BILLBOARD_H)) {
    drawBillboardAd(view.ctx, o.x + 8, o.gapBottom + 8, o.w - 16, BILLBOARD_H - 18, o.tabloid, view.photos);
    return;
  }
  const ctx = view.ctx;
  const x = o.x;
  const w = o.w;
  const top = o.gapBottom;
  const boardBottom = top + BILLBOARD_H;
  const inset = w * BILLBOARD_LEGS_INSET;
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  // Steel frame: two legs with cross bracing, filling the collision box below the board.
  const legW = 12;
  const lx = x + inset;
  const rx = x + w - inset - legW;
  ctx.strokeStyle = "#6c757d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let y = boardBottom; y < GROUND_Y - 4; y += 36) {
    const y2 = Math.min(GROUND_Y, y + 36);
    ctx.moveTo(lx + legW, y);
    ctx.lineTo(rx, y2);
    ctx.moveTo(rx, y);
    ctx.lineTo(lx + legW, y2);
    ctx.moveTo(lx + legW, y);
    ctx.lineTo(rx, y);
  }
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.fillStyle = "#495057";
  for (const legX of [lx, rx]) {
    ctx.fillRect(legX, boardBottom, legW, GROUND_Y - boardBottom + 4);
    ctx.strokeRect(legX, boardBottom, legW, GROUND_Y - boardBottom + 4);
  }

  // Catwalk under the board, with lamps shining up at it.
  ctx.fillStyle = "#343a40";
  ctx.fillRect(x + 6, boardBottom, w - 12, 7);
  ctx.strokeRect(x + 6, boardBottom, w - 12, 7);
  for (let i = 0; i < 3; i++) {
    const cx = x + w * (0.2 + i * 0.3);
    const glow = 0.18 + Math.sin(time * 3 + i + o.seed) * 0.03;
    ctx.fillStyle = `rgba(255,240,170,${glow})`;
    ctx.beginPath();
    ctx.moveTo(cx - 5, boardBottom - 2);
    ctx.lineTo(cx - 34, top + 10);
    ctx.lineTo(cx + 34, top + 10);
    ctx.lineTo(cx + 5, boardBottom - 2);
    ctx.closePath();
    ctx.fill();
  }

  // Board frame and the ad.
  ctx.fillStyle = "#2b2d42";
  roundRect(ctx, x, top, w, BILLBOARD_H, 4);
  ctx.fill();
  drawBillboardAd(ctx, x + 7, top + 7, w - 14, BILLBOARD_H - 14, o.tabloid, view.photos);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  roundRect(ctx, x, top, w, BILLBOARD_H, 4);
  ctx.stroke();
  // Lamp heads on the catwalk (drawn over the board's bottom edge).
  ctx.fillStyle = "#adb5bd";
  for (let i = 0; i < 3; i++) {
    const cx = x + w * (0.2 + i * 0.3);
    ctx.beginPath();
    ctx.moveTo(cx - 7, boardBottom + 2);
    ctx.lineTo(cx + 7, boardBottom + 2);
    ctx.lineTo(cx + 4, boardBottom - 6);
    ctx.lineTo(cx - 4, boardBottom - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawSeaObstacle(view: View, o: Obstacle): void {
  if (RTX.on) {
    const [col] = obstacleRects(o);
    if (rtxSeaColumn(view.ctx, o.bottom === "rock", o.seed, col.x, col.y, col.w)) return;
  }
  const ctx = view.ctx;
  const [base] = obstacleRects(o);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  if (o.bottom === "rock") {
    // Stacked boulders filling the column.
    ctx.fillStyle = o.color;
    roundRect(ctx, base.x, base.y, base.w, base.h + 4, 16);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    for (let y = base.y + 34, i = 0; y < GROUND_Y - 10; y += 38, i++) {
      ctx.beginPath();
      ctx.moveTo(base.x + 4, y);
      ctx.quadraticCurveTo(base.x + base.w * (0.3 + rnd(o.seed + i) * 0.4), y + 10, base.x + base.w - 4, y - 2);
      ctx.stroke();
    }
    // Moss & a starfish
    ctx.fillStyle = "#4a7c59";
    roundRect(ctx, base.x + 4, base.y + 2, base.w - 8, 9, 4);
    ctx.fill();
    drawStar(ctx, base.x + base.w * 0.6, base.y + 40 + rnd(o.seed) * 60, 9, "#ff9f43");
  } else {
    // Coral column: scalloped top, polyps.
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(base.x, GROUND_Y + 4);
    ctx.lineTo(base.x, base.y + 12);
    const bumps = Math.max(2, Math.round(base.w / 22));
    const bw = base.w / bumps;
    for (let i = 0; i < bumps; i++) ctx.arc(base.x + bw * (i + 0.5), base.y + 12, bw / 2, Math.PI, 0);
    ctx.lineTo(base.x + base.w, GROUND_Y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 14; i++) {
      const px = base.x + 8 + rnd(o.seed + i) * (base.w - 16);
      const py = base.y + 24 + rnd(o.seed + i + 20) * Math.max(0, base.h - 34);
      if (py > GROUND_Y - 6) continue;
      circle(ctx, px, py, 3 + rnd(o.seed + i + 40) * 3);
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(base.x + base.w - 12, base.y + 18, 9, Math.max(0, base.h - 18));
  }
}

/**
 * An old shipwreck settled on the sea floor: a long, low wooden hull half
 * sunk into the sand, its planks stove in, and one mast snapped off short.
 * The mast's splintered tip is the gap's bottom edge (see obstacleRects).
 */
function drawWreck(view: View, o: Obstacle, time: number): void {
  const ctx = view.ctx;
  const { deck, facing, mastX } = wreckGeometry(o);
  // Hull coordinates: t runs from the stern (0) to the bow (o.w), mirrored when the bow points left.
  const X = (t: number) => (facing > 0 ? o.x + t : o.x + o.w - t);
  const w = o.w;
  const wood = o.color;
  ctx.lineJoin = "round";

  // Mast: leaning a little, splintered at the top, a rope trailing off it.
  const mastTop = o.gapBottom;
  const lean = (rnd(o.seed + 2) - 0.5) * 6;
  const hw = WRECK_MAST_W / 2 - 1;
  ctx.beginPath();
  ctx.moveTo(mastX - hw, deck + 6);
  ctx.lineTo(mastX - hw + lean, mastTop + 9);
  ctx.lineTo(mastX - hw * 0.4 + lean, mastTop + 1);
  ctx.lineTo(mastX + lean, mastTop + 7);
  ctx.lineTo(mastX + hw * 0.5 + lean, mastTop);
  ctx.lineTo(mastX + hw + lean, mastTop + 11);
  ctx.lineTo(mastX + hw, deck + 6);
  ctx.closePath();
  ctx.fillStyle = shadeHex(wood, -12);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mastX + 1, deck);
  ctx.lineTo(mastX + 1 + lean * 0.8, mastTop + 14);
  ctx.stroke();
  // An iron band and the stump of a yard.
  const bandY = mastTop + Math.min(26, (deck - mastTop) * 0.45);
  ctx.fillStyle = "#56616d";
  ctx.fillRect(mastX - hw + lean * 0.7, bandY, hw * 2, 4);
  // A strand of weed swaying off the tip.
  ctx.strokeStyle = "#2a9d73";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const sway = Math.sin(time * 1.3 + o.seed) * 4;
  ctx.beginPath();
  ctx.moveTo(mastX + lean, mastTop + 8);
  ctx.quadraticCurveTo(mastX + lean - facing * (10 + sway), mastTop + 18, mastX + lean - facing * (6 + sway), mastTop + 32);
  ctx.stroke();
  ctx.lineCap = "butt";

  // Hull: a flat, rotten deck line, the stern post on one end and the bow rising a little on the other.
  const sand = GROUND_Y + 4;
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(X(4), deck - 4);
    ctx.lineTo(X(w * 0.42), deck);
    ctx.lineTo(X(w - 34), deck);
    ctx.quadraticCurveTo(X(w - 12), deck - 3, X(w + 2), deck - 12);
    ctx.quadraticCurveTo(X(w - 8), deck + 30, X(w - 36), sand);
    ctx.lineTo(X(20), sand);
    ctx.quadraticCurveTo(X(4), GROUND_Y - 18, X(4), deck - 4);
    ctx.closePath();
  };
  hull();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = wood;
  ctx.fillRect(o.x - 10, deck - 16, w + 20, GROUND_Y - deck + 24);
  // Planks: seams along the hull, a few gone dark.
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 2;
  for (let y = deck + 10, i = 0; y < GROUND_Y; y += 11, i++) {
    ctx.beginPath();
    ctx.moveTo(o.x - 4, y + (facing > 0 ? 2 : -2));
    ctx.lineTo(o.x + w + 4, y + (facing > 0 ? -2 : 2));
    ctx.stroke();
    // Butt joints, staggered.
    for (let t = 24 + (i % 2) * 22 + rnd(o.seed + i) * 10; t < w - 20; t += 54) {
      ctx.beginPath();
      ctx.moveTo(X(t), y);
      ctx.lineTo(X(t), y + 11);
      ctx.stroke();
    }
  }
  // The gunwale: a thicker rail along the top.
  ctx.fillStyle = shadeHex(wood, -22);
  ctx.fillRect(o.x - 10, deck - 16, w + 20, 22);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(o.x - 10, deck + 6, w + 20, 3);
  // Algae creeping up from the sand, greener toward the bottom.
  const algae = ctx.createLinearGradient(0, deck, 0, GROUND_Y);
  algae.addColorStop(0, "rgba(74,124,89,0)");
  algae.addColorStop(1, "rgba(74,124,89,0.4)");
  ctx.fillStyle = algae;
  ctx.fillRect(o.x - 10, deck, w + 20, GROUND_Y - deck + 6);
  // Seen through the water it's all a bit bluer.
  ctx.fillStyle = "rgba(27,143,181,0.12)";
  ctx.fillRect(o.x - 10, deck - 16, w + 20, GROUND_Y - deck + 24);
  ctx.restore();
  hull();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();

  // A hole stove into the side, with broken plank ends.
  const ht = w * (0.5 + rnd(o.seed + 4) * 0.12);
  const hy = deck + 22;
  ctx.beginPath();
  ctx.moveTo(X(ht - 20), hy + 4);
  ctx.lineTo(X(ht - 9), hy - 6);
  ctx.lineTo(X(ht - 2), hy + 1);
  ctx.lineTo(X(ht + 10), hy - 7);
  ctx.lineTo(X(ht + 22), hy + 5);
  ctx.lineTo(X(ht + 15), hy + 17);
  ctx.lineTo(X(ht + 4), hy + 13);
  ctx.lineTo(X(ht - 6), hy + 20);
  ctx.lineTo(X(ht - 17), hy + 14);
  ctx.closePath();
  ctx.fillStyle = "#16202b";
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Something lives in there: two eyes peering out.
  ctx.fillStyle = "#ffd166";
  const blink = Math.sin(time * 0.9 + o.seed * 3) > 0.96;
  for (const dx of [-4, 5]) {
    oval(ctx, X(ht + dx), hy + 6, 2.6, blink ? 0.5 : 2.6);
  }

  // Portholes toward the bow, crusted green.
  for (let i = 0; i < 2; i++) {
    const px = X(w * 0.74 + i * 22 - (ht > w * 0.58 ? 0 : 6));
    const py = deck + 24;
    ctx.beginPath();
    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#3d6b5e";
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#16202b";
    ctx.fill();
  }

  // Barnacles along the waterline of long ago.
  ctx.fillStyle = "rgba(240,235,220,0.75)";
  for (let i = 0; i < 12; i++) {
    const t = 26 + rnd(o.seed + i + 30) * (w - 60);
    const y = deck + 34 + rnd(o.seed + i + 50) * 18;
    circle(ctx, X(t), y, 1.6 + rnd(o.seed + i + 70) * 1.6);
  }

  // Sand drifted up against the hull, and a starfish on it.
  // Only its crest is outlined: where it meets the (wavy) floor, it blends in.
  const crest = () => {
    ctx.beginPath();
    ctx.moveTo(o.x - 14, GROUND_Y + 2);
    ctx.quadraticCurveTo(o.x + w * 0.25, GROUND_Y - 16, o.x + w * 0.5, GROUND_Y - 9);
    ctx.quadraticCurveTo(o.x + w * 0.78, GROUND_Y - 3, o.x + w + 14, GROUND_Y + 2);
  };
  crest();
  ctx.lineTo(o.x + w + 14, GROUND_Y + 10);
  ctx.lineTo(o.x - 14, GROUND_Y + 10);
  ctx.closePath();
  ctx.fillStyle = "#e9cf94";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.x - 20, GROUND_Y - 40, w + 40, 36);
  ctx.clip();
  crest();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
  drawStar(ctx, X(w * (0.2 + rnd(o.seed + 6) * 0.15)), GROUND_Y - 8, 7, "#ff9f43");
  ctx.lineJoin = "miter";
}

/**
 * A boat at anchor: the hull on the surface (painted above the waterline,
 * red antifouling below, tinted by the water), a cabin and a mast above,
 * and the chain down to the anchor, whose crown is the gap's top edge. A
 * boat about to drop its anchor shows a "!" and arrows pointing down by the
 * anchor, which rattles on its chain; then the chain rips, leaving a torn
 * stub on the hull, and the rest falls with the anchor and piles up on it.
 */
function drawAnchoredBoat(view: View, o: Obstacle, time: number): void {
  const ctx = view.ctx;
  const boatX = o.x + o.w / 2;
  const keel = SURFACE_Y + BOAT_DRAFT;
  const deck = SURFACE_Y - BOAT_FREEBOARD;
  const hl = boatX - BOAT_W / 2;
  const hr = boatX + BOAT_W / 2;
  const drop = o.drop;
  const warning = drop?.state === "warning";
  // Rattling: the anchor shakes, and jerks down a little on each clank of the chain (drawing only).
  const jerk = warning ? 4 * Math.max(0, 1 - drop.t / 0.1) : 0;
  const cx = boatX + (warning ? Math.sin(time * 70) * 1.8 : 0);
  const crown = anchorCrown(o) + jerk;
  const top = crown - ANCHOR_H;
  const iron = "#56616d";

  // Chain: links alternate face-on (a ring) and edge-on (a bar), down to the anchor's ring.
  // Once it has ripped, a stub with a torn link hangs from the hull, and the rest falls with the anchor.
  const ripped = drop !== null && anchorRipped(o);
  const links: ChainLink[] = [];
  if (ripped) {
    for (let y = keel - 6; y < ANCHOR_RIP_Y - 8; y += 10) links.push({ x: boatX, y, a: 0 });
    drawChain(ctx, links, iron);
    drawTornLink(ctx, boatX, ANCHOR_RIP_Y - 8, iron);
    links.length = 0;
  }
  for (let y = ripped ? drop.chain : keel - 6; y < top + 2; y += 10) links.push({ x: cx, y, a: 0 });
  drawChain(ctx, links, iron);

  // Anchor: ring, shank, stock with ball ends, curved arms with flukes.
  ctx.beginPath();
  ctx.arc(cx, top + 7, 6.5, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6.5;
  ctx.stroke();
  ctx.strokeStyle = iron;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = iron;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  roundRect(ctx, cx - 5, top + 12, 10, ANCHOR_H - 18, 3);
  ctx.fill();
  ctx.stroke();
  const armY = crown - 33;
  ctx.beginPath();
  ctx.arc(cx, armY, 27, 0.2, Math.PI - 0.2);
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.strokeStyle = iron;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 31, crown - 46);
    ctx.lineTo(cx + s * 37, crown - 22);
    ctx.lineTo(cx + s * 18, crown - 29);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  roundRect(ctx, cx - 21, top + 15, 42, 9, 4);
  ctx.fill();
  ctx.stroke();
  for (const s of [-1, 1]) {
    circle(ctx, cx + s * 22, top + 19.5, 5.5, true);
  }
  // Rust and a strand of weed caught on a fluke.
  ctx.fillStyle = "rgba(170,90,40,0.55)";
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(cx + (rnd(o.seed + i) - 0.5) * 6, top + 28 + rnd(o.seed + i + 9) * (ANCHOR_H - 50), 1.8 + rnd(o.seed + i + 5) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const weed = rnd(o.seed + 3) < 0.5 ? -1 : 1;
  ctx.strokeStyle = "#2a9d73";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + weed * 33, crown - 26);
  ctx.quadraticCurveTo(cx + weed * 42, crown - 8, cx + weed * 36, crown + 8);
  ctx.stroke();
  ctx.lineCap = "butt";

  // The torn-off chain piles up on the anchor once it has landed: a jumble of links between the arms.
  if (ripped) {
    const piled = Math.min(9, Math.floor((anchorChainLength(o) - (top - drop.chain)) / 10));
    const heap: ChainLink[] = [];
    for (let i = 0; i < piled; i++) {
      heap.push({
        x: cx + (rnd(o.seed + 20 + i) - 0.5) * 34,
        y: crown - 18 - rnd(o.seed + 40 + i) * 10 - i * 1.2,
        a: (rnd(o.seed + 60 + i) - 0.5) * 3,
      });
    }
    drawChain(ctx, heap, iron);
  }

  // Mast with a pennant, and the cabin: above the water.
  const color = BOAT_COLORS[Math.floor(rnd(o.seed + 1) * BOAT_COLORS.length)];
  const mastX = boatX - 28;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(mastX, deck);
  ctx.lineTo(mastX, deck - 74);
  ctx.stroke();
  ctx.fillStyle = "#ef476f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mastX + 2, deck - 74);
  ctx.lineTo(mastX + 24, deck - 68);
  ctx.lineTo(mastX + 2, deck - 62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 3;
  roundRect(ctx, boatX - 6, deck - 26, 54, 28, 5);
  ctx.fillStyle = "#f1faee";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#7fd3ea";
  for (const wx of [boatX + 2, boatX + 26]) {
    roundRect(ctx, wx, deck - 19, 15, 10, 3);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Hull: bow on the left, square transom on the right.
  ctx.beginPath();
  ctx.moveTo(hl - 8, deck - 8);
  ctx.lineTo(hr, deck);
  ctx.lineTo(hr - 5, keel - 8);
  ctx.quadraticCurveTo(hr - 8, keel, hr - 22, keel);
  ctx.lineTo(boatX - BOAT_W * 0.18, keel);
  ctx.quadraticCurveTo(hl + 6, keel - 2, hl - 8, deck - 8);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(hl - 10, deck - 10, BOAT_W + 20, SURFACE_Y - deck + 10);
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(hl - 10, SURFACE_Y, BOAT_W + 20, BOAT_DRAFT + 4);
  ctx.fillStyle = "#f1faee";
  ctx.fillRect(hl - 10, SURFACE_Y - 4, BOAT_W + 20, 4);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(hl - 10, deck - 10, BOAT_W + 20, 6);
  // Seen through the water, the part below the surface is bluer.
  ctx.fillStyle = "rgba(27,143,181,0.3)";
  ctx.fillRect(hl - 10, SURFACE_Y, BOAT_W + 20, BOAT_DRAFT + 4);
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Hawsepipe where the chain comes out.
  ctx.fillStyle = OUTLINE;
  oval(ctx, boatX, keel - 2, 6, 3);

  // About to drop it: a "!" by the anchor, swelling with each clank, and chevrons marching down below it.
  if (warning) {
    outlinedText(ctx, "!", cx + 52, top + 26 + Math.sin(time * 30) * 2, 30 + 8 * Math.max(0, 1 - drop.t / 0.12), "#ff595e");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const y = crown + 14 + i * 16;
      const on = Math.max(0, Math.sin(time * 9 - i * 1.2));
      ctx.globalAlpha = 0.25 + 0.75 * on;
      ctx.beginPath();
      ctx.moveTo(cx - 13, y);
      ctx.lineTo(cx, y + 10);
      ctx.lineTo(cx + 13, y);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = "#ff595e";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  }
}
