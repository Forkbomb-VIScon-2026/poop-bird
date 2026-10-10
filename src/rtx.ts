// RTX graphics: the game drawn with real photos, cut out with a dark outline
// (sources and licences in assets/CREDITS.md). Off by default; the settings menu
// turns it on. render.ts stays the one renderer: when RTX is on, its drawing
// functions hand what we have photos for to the helpers here and draw everything
// else as usual, so new things on the classic side keep working with RTX on.
// The photos only load the first time RTX is turned on.

import { BIRD_RADIUS, GROUND_Y, SURFACE_Y, poleX, type Game, type PowerLine } from "./game";
import { drawFaceDisc } from "./faceDisc";

import asphaltUrl from "./assets/asphalt.jpg";
import balloonUrl from "./assets/balloon.png";
import billboardUrl from "./assets/billboard.png";
import birdDownUrl from "./assets/bird-down.png";
import birdGlideUrl from "./assets/bird-glide.png";
import birdUpUrl from "./assets/bird-up.png";
import bldg2Url from "./assets/bldg2.png";
import bldg4Url from "./assets/bldg4.png";
import bldg6Url from "./assets/bldg6.png";
import bouquetUrl from "./assets/bouquet.png";
import car1Url from "./assets/car1.png";
import car2Url from "./assets/car2.png";
import car3Url from "./assets/car3.png";
import car4Url from "./assets/car4.png";
import car5Url from "./assets/car5.png";
import car6Url from "./assets/car6.png";
import carUrl from "./assets/car.png";
import churchUrl from "./assets/church.png";
import coral1Url from "./assets/coral1.png";
import coral2Url from "./assets/coral2.png";
import coral3Url from "./assets/coral3.png";
import coral4Url from "./assets/coral4.png";
import doveUrl from "./assets/dove.png";
import fish2Url from "./assets/fish2.png";
import fish3Url from "./assets/fish3.png";
import fish4Url from "./assets/fish4.png";
import fish5Url from "./assets/fish5.png";
import fish6Url from "./assets/fish6.png";
import fishDeflatedUrl from "./assets/fish-deflated.png";
import fishPuffedUrl from "./assets/fish-puffed.png";
import jellyUrl from "./assets/jelly.png";
import kelpUrl from "./assets/kelp.png";
import perchedUrl from "./assets/perched.png";
import personBrideUrl from "./assets/person-bride.png";
import personGroomUrl from "./assets/person-groom.png";
import personKidUrl from "./assets/person-kid.png";
import personManUrl from "./assets/person-man.png";
import personPaparazzoUrl from "./assets/person-paparazzo.png";
import personParachutistUrl from "./assets/person-parachutist.png";
import personPhotographerUrl from "./assets/person-photographer.png";
import personWomanUrl from "./assets/person-woman.png";
import poleUrl from "./assets/pole.png";
import poopUrl from "./assets/poop.png";
import rock1Url from "./assets/rock1.png";
import rock2Url from "./assets/rock2.png";
import rock3Url from "./assets/rock3.png";
import rock4Url from "./assets/rock4.png";
import sandUrl from "./assets/sand.jpg";
import skyUrl from "./assets/sky.jpg";
import skylineUrl from "./assets/skyline.png";
import statueUrl from "./assets/statue.png";
import underwaterUrl from "./assets/underwater.jpg";
import walker1Url from "./assets/walker1.png";
import walker2Url from "./assets/walker2.png";
import walker3Url from "./assets/walker3.png";
import walker4Url from "./assets/walker4.png";
import walker5Url from "./assets/walker5.png";

/** Whether the RTX (photo) style is drawing right now. The Renderer sets it before each frame. */
export const RTX = { on: false };

/** Outline colour of the photo pictures, matching their own dark outline. */
export const PHOTO_INK = "#1e1b14";

/**
 * A picture from src/assets: its anchor (cx, cy) and reference size in image pixels, and its
 * drawn size as a multiple of the radius it is drawn at (so a sprite of reference size `size`
 * is drawn `scale × r` pixels across). Textures only use `img`.
 */
export interface Sprite {
  img: HTMLImageElement;
  cx: number;
  cy: number;
  size: number;
  scale: number;
  /** The animal's own eye in the picture, where the googly eye goes. */
  eye?: { x: number; y: number };
}

/** Deterministic pseudo-random in [0,1) from a seed (same as render.ts). */
function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function loadSprites() {
  const load = (src: string, cx = 0, cy = 0, size = 1, scale = 1, eye?: { x: number; y: number }): Sprite => {
    const img = new Image();
    img.src = src;
    return { img, cx, cy, size, scale, eye };
  };
  return {
    fishDeflated: load(fishDeflatedUrl, 151, 42, 121, 2.1, { x: 196, y: 16 }),
    fishPuffed: load(fishPuffedUrl, 156, 67, 161, 2.2, { x: 207, y: 23 }),
    // Pigeon flap frames: anchored mid-body, the body (beak to tail) is 3.2 radii long.
    birdUp: load(birdUpUrl, 147, 243, 200, 3.2, { x: 224, y: 196 }),
    birdGlide: load(birdGlideUrl, 111, 99, 200, 3.2, { x: 196, y: 94 }),
    birdDown: load(birdDownUrl, 106, 103, 200, 3.2, { x: 195, y: 88 }),
    // City objects, anchored at their foot; r is their drawn width (cars) or height.
    car: load(carUrl, 213, 113, 420, 1),
    car1: load(car1Url, 213, 190, 426, 1),
    car2: load(car2Url, 213, 149, 426, 1),
    car3: load(car3Url, 213, 145, 426, 1),
    car4: load(car4Url, 213, 164, 426, 1),
    car5: load(car5Url, 213, 145, 426, 1),
    car6: load(car6Url, 213, 165, 426, 1),
    statue: load(statueUrl, 74, 423, 420, 1),
    church: load(churchUrl, 148, 603, 600, 1),
    pole: load(poleUrl, 178, 523, 520, 1),
    balloon: load(balloonUrl, 164, 3, 420, 1),
    billboard: load(billboardUrl, 233, 311, 460, 1),
    // Perched pigeon: anchored at its feet, about 2.2 radii wide.
    perched: load(perchedUrl, 91, 237, 160, 2.2),
    dove: load(doveUrl, 103, 96, 200, 2.3),
    bouquet: load(bouquetUrl, 73, 56, 140, 2.6),
    poop: load(poopUrl, 63, 63, 120, 2.4),
    // People (photos where nobody is recognisable): anchored at their feet, r is their drawn height.
    man: load(personManUrl, 82, 364, 360, 1),
    woman: load(personWomanUrl, 87, 364, 360, 1),
    walker1: load(walker1Url, 63, 364, 360, 1),
    walker2: load(walker2Url, 82, 364, 360, 1),
    walker3: load(walker3Url, 70, 364, 360, 1),
    walker4: load(walker4Url, 186, 364, 360, 1),
    walker5: load(walker5Url, 67, 364, 360, 1),
    kid: load(personKidUrl, 85, 364, 360, 1),
    paparazzo: load(personPaparazzoUrl, 62, 364, 360, 1),
    photographer: load(personPhotographerUrl, 158, 364, 360, 1),
    groom: load(personGroomUrl, 40, 364, 360, 1),
    bride: load(personBrideUrl, 204, 364, 360, 1),
    parachutist: load(personParachutistUrl, 151, 364, 360, 1),
    // Buildings (roof and ground floor kept whole, the middle floors repeat), boulders and corals:
    // anchored at their foot; r is the drawn width.
    bldg2: load(bldg2Url, 153, 404, 306, 1),
    bldg4: load(bldg4Url, 153, 630, 306, 1),
    bldg6: load(bldg6Url, 153, 167, 306, 1),
    rock1: load(rock1Url, 133, 127, 266, 1),
    rock2: load(rock2Url, 133, 153, 266, 1),
    rock3: load(rock3Url, 133, 187, 266, 1),
    rock4: load(rock4Url, 133, 132, 266, 1),
    coral1: load(coral1Url, 133, 202, 266, 1),
    coral2: load(coral2Url, 133, 264, 266, 1),
    coral3: load(coral3Url, 133, 216, 266, 1),
    coral4: load(coral4Url, 133, 329, 266, 1),
    // Sea life (facing left), anchored mid-body; r is the drawn width.
    fish2: load(fish2Url, 88, 43, 176, 1),
    fish3: load(fish3Url, 88, 56, 176, 1),
    fish4: load(fish4Url, 88, 58, 176, 1),
    fish5: load(fish5Url, 103, 102, 206, 1),
    fish6: load(fish6Url, 78, 40, 156, 1),
    // Moon jelly: anchored on the bell, which is the jelly's radius across.
    jelly: load(jellyUrl, 90, 58, 88, 1.2),
    // Kelp blade: anchored at its foot, drawn 0.6 r pixels tall.
    kelp: load(kelpUrl, 42, 426, 426, 0.6),
    // Backdrops and textures.
    sky: load(skyUrl),
    skyline: load(skylineUrl),
    underwater: load(underwaterUrl),
    asphalt: load(asphaltUrl),
    sand: load(sandUrl),
  };
}

export type SpriteName = keyof ReturnType<typeof loadSprites>;
let SPRITES: ReturnType<typeof loadSprites> | null = null;

/** All pictures, loading on first use (the first time RTX is turned on). */
export function sprites(): ReturnType<typeof loadSprites> {
  return (SPRITES ??= loadSprites());
}

export function spriteReady(s: Sprite): boolean {
  return s.img.complete && s.img.naturalWidth > 0;
}

/** Draws a sprite with its anchor at (x, y), rotated, sized to r, squashed by (sx, sy). Nothing while it loads. */
export function drawSpriteOn(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, rot: number, r: number, sx = 1, sy = 1): boolean {
  if (!spriteReady(s)) return false;
  const k = (r * s.scale) / s.size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(k * sx, k * sy);
  ctx.drawImage(s.img, -s.cx, -s.cy);
  ctx.restore();
  return true;
}

/** Draws a named sprite (see drawSpriteOn); false while it loads, so the caller can draw its classic look. */
export function drawPhoto(ctx: CanvasRenderingContext2D, name: SpriteName, x: number, y: number, rot: number, r: number): boolean {
  return drawSpriteOn(ctx, sprites()[name], x, y, rot, r);
}

/** Where a point of a sprite's picture (px, py) lands on screen, drawn as drawSpriteOn would. */
function spritePoint(s: Sprite, x: number, y: number, rot: number, r: number, sx: number, sy: number, px: number, py: number): { x: number; y: number } {
  const k = (r * s.scale) / s.size;
  const lx = (px - s.cx) * k * sx;
  const ly = (py - s.cy) * k * sy;
  return { x: x + lx * Math.cos(rot) - ly * Math.sin(rot), y: y + lx * Math.sin(rot) + ly * Math.cos(rot) };
}

const PATTERNS = new Map<Sprite, CanvasPattern>();

/** Fills the current path with a texture tiled at scale k, anchored at (x, y) so it moves with that point. */
function fillPattern(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, k: number): void {
  if (!spriteReady(s)) return;
  let p = PATTERNS.get(s);
  if (!p) {
    const made = ctx.createPattern(s.img, "repeat");
    if (!made) return;
    p = made;
    PATTERNS.set(s, p);
  }
  p.setTransform(new DOMMatrix([k, 0, 0, k, x, y]));
  ctx.fillStyle = p;
  ctx.fill();
}

/** A picture tiled across the screen at height h from y, every other copy mirrored so the seams match. */
function drawStrip(ctx: CanvasRenderingContext2D, s: Sprite, y: number, h: number, offset: number, width: number): boolean {
  if (!spriteReady(s)) return false;
  const w = (s.img.naturalWidth * h) / s.img.naturalHeight;
  for (let i = Math.floor((offset - 40) / w); i * w - offset < width + 40; i++) {
    const x = i * w - offset;
    if (x + w < -40) continue;
    if (i % 2) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(s.img, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(s.img, x, y, w, h);
    }
  }
  return true;
}

// --- city ---------------------------------------------------------------------

/** The sky photo, then the skyline photo, both drifting slowly. False until they've loaded. */
export function rtxSky(ctx: CanvasRenderingContext2D, width: number, bgOffset: number, time: number): boolean {
  const { sky, skyline } = sprites();
  if (!spriteReady(sky) || !spriteReady(skyline)) return false;
  ctx.fillStyle = "#7fb3e0";
  ctx.fillRect(-20, -20, width + 40, GROUND_Y + 40);
  drawStrip(ctx, sky, -20, GROUND_Y + 40, bgOffset * 0.05 + time * 4, width);
  drawStrip(ctx, skyline, GROUND_Y - 230, 232, bgOffset * 0.25, width);
  return true;
}

/** Sidewalk and road from the asphalt photo. False until it has loaded. */
export function rtxStreet(ctx: CanvasRenderingContext2D, width: number, bgOffset: number, viewH: number): boolean {
  const { asphalt } = sprites();
  if (!spriteReady(asphalt)) return false;
  const w = width + 40;
  ctx.beginPath();
  ctx.rect(-20, GROUND_Y, w, 25);
  ctx.fillStyle = "#cfc9bd";
  ctx.fill();
  ctx.globalAlpha = 0.45;
  fillPattern(ctx, asphalt, -bgOffset, GROUND_Y, 0.35);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  const off = bgOffset % 60;
  for (let x = -off; x < w; x += 60) ctx.fillRect(x, GROUND_Y, 2, 20);
  ctx.fillStyle = "#8f8b82";
  ctx.fillRect(-20, GROUND_Y + 20, w, 5);
  ctx.beginPath();
  ctx.rect(-20, GROUND_Y + 25, w, viewH - GROUND_Y);
  ctx.fillStyle = "#55575c";
  ctx.fill();
  fillPattern(ctx, asphalt, -bgOffset, GROUND_Y + 25, 0.5);
  ctx.fillStyle = "#f2efe6";
  const dash = bgOffset % 90;
  for (let x = -dash; x < w; x += 90) ctx.fillRect(x, GROUND_Y + 50, 46, 4);
  ctx.strokeStyle = PHOTO_INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-20, GROUND_Y);
  ctx.lineTo(w, GROUND_Y);
  ctx.stroke();
  return true;
}

/** Building photos for wide houses and for tall towers. */
const HOUSES: readonly SpriteName[] = ["bldg2", "bldg6", "bldg4"];
const TOWERS: readonly SpriteName[] = ["bldg2", "bldg4"];
/** Rows (in the picture) of each building's roof and ground floor, kept whole when stretching. */
const BUILDING_SLICES: Partial<Record<SpriteName, { roof: number; base: number }>> = {
  bldg2: { roof: 122, base: 89 },
  bldg4: { roof: 190, base: 139 },
  bldg6: { roof: 51, base: 37 },
};

/**
 * A building photo stretched to width w, from y down to y + h: the roof and the ground floor
 * keep their proportions, the middle floors repeat (or the roof and base squash a little when
 * the building is too short for both). Picked by `seed`; false until it has loaded.
 */
export function rtxBuilding(ctx: CanvasRenderingContext2D, tower: boolean, seed: number, x: number, y: number, w: number, h: number): boolean {
  const pool = tower ? TOWERS : HOUSES;
  const name = pool[Math.floor(rnd(seed + 3) * pool.length)];
  const s = sprites()[name];
  const slice = BUILDING_SLICES[name];
  if (!slice || !spriteReady(s)) return false;
  const iw = s.img.naturalWidth;
  const ih = s.img.naturalHeight;
  const k = w / iw;
  let roofH = slice.roof * k;
  let baseH = slice.base * k;
  const squash = Math.min(1, h / (roofH + baseH));
  roofH *= squash;
  baseH *= squash;
  ctx.drawImage(s.img, 0, 0, iw, slice.roof, x, y, w, roofH);
  const midSrc = ih - slice.roof - slice.base;
  const midH = midSrc * k;
  for (let yy = y + roofH; yy < y + h - baseH - 0.5; yy += midH) {
    const left = Math.min(midH, y + h - baseH - yy);
    ctx.drawImage(s.img, 0, slice.roof, iw, midSrc * (left / midH), x, yy - 0.5, w, left + 1);
  }
  ctx.drawImage(s.img, 0, ih - slice.base, iw, slice.base, x, y + h - baseH, w, baseH);
  return true;
}

/** Rows of pole.png: the head (cross-arm and insulators) ends here; the cross-arm is at POLE_ARM_ROW. */
const POLE_HEAD_ROWS = 340;
const POLE_ARM_ROW = 200;
/** Trunk rows below the head, and the trunk's width, in pole.png pixels. */
const POLE_TRUNK_ROWS = 150;
const POLE_TRUNK_W = 60;

/** The power line's poles from the pole photo: the cross-arm at the top wire, the trunk stretched to the street. */
export function rtxPoles(ctx: CanvasRenderingContext2D, l: PowerLine): boolean {
  const { pole } = sprites();
  if (!spriteReady(pole)) return false;
  const topWire = Math.min(...l.wires.map((w) => w.y));
  const k = 110 / pole.img.naturalWidth;
  const iw = pole.img.naturalWidth;
  const headTop = topWire - POLE_ARM_ROW * k;
  const headBottom = headTop + POLE_HEAD_ROWS * k;
  for (let i = 0; i < l.poles; i++) {
    const px = poleX(l, i);
    ctx.drawImage(pole.img, 0, 0, iw, POLE_HEAD_ROWS, px - (iw * k) / 2, headTop, iw * k, POLE_HEAD_ROWS * k);
    ctx.drawImage(pole.img, pole.cx - POLE_TRUNK_W / 2, POLE_HEAD_ROWS, POLE_TRUNK_W, POLE_TRUNK_ROWS, px - (POLE_TRUNK_W * k) / 2, headBottom - 1, POLE_TRUNK_W * k, GROUND_Y + 4 - headBottom);
  }
  return true;
}

/** Rows of balloon.png: the envelope ends here, the basket starts at BALLOON_BASKET_ROW. */
const BALLOON_ENVELOPE_ROWS = 368;
const BALLOON_BASKET_ROW = 372;

/** The balloon photo's envelope, fitted to the envelope's ellipse (centre cx, cy; radii rx, ry). */
export function rtxBalloonEnvelope(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): boolean {
  const { balloon } = sprites();
  if (!spriteReady(balloon)) return false;
  ctx.drawImage(balloon.img, 0, 0, balloon.img.naturalWidth, BALLOON_ENVELOPE_ROWS, cx - rx * 1.08, cy - ry, rx * 2.16, ry * 2 + 10);
  return true;
}

/** The balloon photo's wicker basket in the basket's box. */
export function rtxBasket(ctx: CanvasRenderingContext2D, basket: { x: number; y: number; w: number; h: number }): boolean {
  const { balloon } = sprites();
  if (!spriteReady(balloon)) return false;
  const iw = balloon.img.naturalWidth;
  const ih = balloon.img.naturalHeight;
  ctx.drawImage(balloon.img, iw * 0.38, BALLOON_BASKET_ROW, iw * 0.24, ih - BALLOON_BASKET_ROW, basket.x - 4, basket.y - 4, basket.w + 8, basket.h + 6);
  return true;
}

/** Rows of billboard.png: the board, above the legs. */
const BILLBOARD_BOARD_ROWS = 152;

/** The billboard photo: board stretched to (x, top, w, boardH), legs down to the street. */
export function rtxBillboard(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, boardH: number): boolean {
  const { billboard } = sprites();
  if (!spriteReady(billboard)) return false;
  const iw = billboard.img.naturalWidth;
  const ih = billboard.img.naturalHeight;
  const bb = BILLBOARD_BOARD_ROWS;
  const boardBottom = top + boardH;
  ctx.drawImage(billboard.img, 0, 0, iw, bb, x - 4, top - 2, w + 8, boardH + 4);
  ctx.drawImage(billboard.img, 0, bb, iw, ih - bb, x - 4, boardBottom + 2, w + 8, GROUND_Y + 4 - boardBottom - 2);
  return true;
}

const CARS: readonly SpriteName[] = ["car", "car1", "car2", "car3", "car4", "car5", "car6"];

/** A car photo (facing right) picked by seed; the wedding's getaway car is always the sports car. */
export function rtxCar(ctx: CanvasRenderingContext2D, seed: number, w: number, wedding: boolean): boolean {
  const kind = wedding ? "car" : CARS[Math.floor(rnd(seed + 11) * CARS.length)];
  return drawPhoto(ctx, kind, 0, 0, 0, w * (kind === "car6" ? 2.3 : 1.5));
}

const WALKERS: readonly SpriteName[] = ["man", "woman", "walker1", "walker2", "walker3", "walker4", "walker5"];
const GUESTS: readonly SpriteName[] = ["man", "woman", "walker1", "walker2"];

/** A passer-by photo picked by seed, feet at the origin, h tall. */
export function rtxWalker(ctx: CanvasRenderingContext2D, seed: number, h: number, rot: number, guest = false): boolean {
  const pool = guest ? GUESTS : WALKERS;
  return drawPhoto(ctx, pool[Math.floor(rnd(seed) * pool.length)], 0, 0, rot, h);
}

/** The skydiver alone in person-parachutist.png, as [x0, y0, x1, y1]: drawn while the chute is still closed. */
const PARACHUTIST_BODY = [120, 221, 192, 366] as const;

/** Just the falling skydiver from the parachutist photo, feet at the origin, h tall. */
export function rtxSkydiver(ctx: CanvasRenderingContext2D, h: number): boolean {
  const s = sprites().parachutist;
  if (!spriteReady(s)) return false;
  const [x0, y0, x1, y1] = PARACHUTIST_BODY;
  const k = h / (y1 - y0);
  ctx.drawImage(s.img, x0, y0, x1 - x0, y1 - y0, (-(x1 - x0) * k) / 2, -h, (x1 - x0) * k, h);
  return true;
}

// --- sea ----------------------------------------------------------------------

/** The underwater photo, drifting slowly. False until it has loaded. */
export function rtxOceanBackdrop(ctx: CanvasRenderingContext2D, width: number, bgOffset: number, viewH: number): boolean {
  const s = sprites().underwater;
  if (!spriteReady(s)) return false;
  ctx.fillStyle = "#0f4c6e";
  ctx.fillRect(-20, -20, width + 40, viewH + 40);
  return drawStrip(ctx, s, -20, viewH + 40, bgOffset * 0.1, width);
}

/** Background sea life: which picture, where (x as a fraction of the loop), how fast and how far away. */
const SEA_LIFE = Array.from({ length: 9 }, (_, i) => {
  const kinds: SpriteName[] = ["fish2", "fish3", "fish4", "fish2", "fish3", "fish4", "fish5", "fish3", "fish2"];
  const kind = kinds[i];
  const far = rnd(i + 500);
  return {
    kind,
    x: rnd(i + 501),
    y: SURFACE_Y + 60 + rnd(i + 502) * (GROUND_Y - SURFACE_Y - 160),
    speed: kind === "fish5" ? 14 : 25 + rnd(i + 503) * 35,
    parallax: 0.25 + (1 - far) * 0.35,
    size: (kind === "fish5" ? 70 : 34) * (0.6 + (1 - far) * 0.6),
    alpha: 0.55 + (1 - far) * 0.4,
    phase: rnd(i + 504) * 6,
    tilt: kind === "fish5" ? -0.5 : 0,
  };
});

/** Kelp blades swaying on the floor, then fish and a turtle swimming by, and crabs on the sand. */
export function rtxSeaLife(ctx: CanvasRenderingContext2D, width: number, bgOffset: number, time: number, kelp: readonly { x: number; h: number; phase: number }[], loop: number): void {
  const kelpOff = ((bgOffset * 0.4) % loop + loop) % loop;
  const blade = sprites().kelp;
  for (let rep = 0; rep * loop - kelpOff < width + 100; rep++) {
    for (const k of kelp) {
      const x = k.x + rep * loop - kelpOff;
      if (x > width + 60 || x < -60) continue;
      drawSpriteOn(ctx, blade, x, GROUND_Y + 4, Math.sin(time * 1.3 + k.phase) * 0.08, k.h);
    }
  }
  const lifeSpan = width + 300;
  for (const f of SEA_LIFE) {
    const x = ((((f.x * lifeSpan - bgOffset * f.parallax - time * f.speed) % lifeSpan) + lifeSpan) % lifeSpan) - 150;
    const y = f.y + Math.sin(time * 1.4 + f.phase) * 8;
    ctx.globalAlpha = f.alpha;
    drawSpriteOn(ctx, sprites()[f.kind], x, y, Math.sin(time * 2 + f.phase) * 0.06 + f.tilt, f.size);
  }
  ctx.globalAlpha = 1;
  const crabSpan = width + 400;
  for (let i = 0; i < 3; i++) {
    const x = ((((rnd(i + 400) * crabSpan - bgOffset + Math.sin(time * 0.8 + i * 2) * 30) % crabSpan) + crabSpan) % crabSpan) - 200;
    drawSpriteOn(ctx, sprites().fish6, x, GROUND_Y + 22, Math.sin(time * 9 + i) * 0.05, 38 + rnd(i + 410) * 16);
  }
}

/** The sea floor from the sand photo (the caller has made the floor's path). */
export function rtxSeaFloor(ctx: CanvasRenderingContext2D, bgOffset: number): boolean {
  const s = sprites().sand;
  if (!spriteReady(s)) return false;
  ctx.fillStyle = "#c9b48a";
  ctx.fill();
  fillPattern(ctx, s, -bgOffset, GROUND_Y, 0.35);
  ctx.strokeStyle = PHOTO_INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  return true;
}

const ROCKS: readonly SpriteName[] = ["rock1", "rock2", "rock3", "rock4"];
const CORALS: readonly SpriteName[] = ["coral1", "coral2", "coral3", "coral4"];

/**
 * A sea column of real boulders or corals stacked from the floor up to `top`, picked by the
 * obstacle's seed, each about as wide as the column.
 */
export function rtxSeaColumn(ctx: CanvasRenderingContext2D, rock: boolean, seed: number, x: number, top: number, w: number): boolean {
  const pool = rock ? ROCKS : CORALS;
  if (!pool.every((n) => spriteReady(sprites()[n]))) return false;
  let y = GROUND_Y + 8;
  for (let i = 0; y > top + 4 && i < 12; i++) {
    const s = sprites()[pool[Math.floor(rnd(seed + i * 7.1) * pool.length)]];
    const dw = w * (1.1 + rnd(seed + i * 3.3) * 0.25);
    let dh = (dw * s.img.naturalHeight) / s.img.naturalWidth;
    // The top piece shrinks to end at the column's top.
    if (y - dh * 0.85 < top) dh = Math.max((y - top) / 0.85, dh * 0.45);
    const cx = x + w / 2 + (rnd(seed + i * 2.7) - 0.5) * w * 0.15;
    ctx.save();
    ctx.translate(cx, y);
    if (rnd(seed + i * 5.9) > 0.5) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -dw / 2, -dh, dw, dh);
    ctx.restore();
    y -= dh * 0.85;
  }
  return true;
}

// --- googly eyes ------------------------------------------------------------------

/**
 * A googly eye: the pupil is a loose disc that falls inside the eye and bounces off its rim,
 * pushed around by how the eye itself moves. Positions are in units of the eye's free travel.
 */
class GooglyEye {
  private px = 0;
  private py = 0.5;
  private vx = 0;
  private vy = 0;
  private lastX: number | null = null;
  private lastY = 0;
  private lastVx = 0;
  private lastVy = 0;

  /** Moves the pupil for an eye now at (x, y) on screen, radius r. */
  update(x: number, y: number, r: number, dt: number): void {
    if (dt <= 0) return;
    if (this.lastX === null) {
      this.lastX = x;
      this.lastY = y;
    }
    const ex = (x - this.lastX) / dt;
    const ey = (y - this.lastY) / dt;
    const ax = Math.max(-4000, Math.min(4000, (ex - this.lastVx) / dt));
    const ay = Math.max(-4000, Math.min(4000, (ey - this.lastVy) / dt));
    this.lastX = x;
    this.lastY = y;
    this.lastVx = ex;
    this.lastVy = ey;
    const travel = Math.max(1, r * 0.45);
    const step = Math.min(dt, 1 / 30);
    this.vx += (-ax / travel) * step * 0.6;
    this.vy += (900 / travel - (ay / travel) * 0.6) * step;
    this.vx *= 1 - Math.min(1, step * 2.5);
    this.vy *= 1 - Math.min(1, step * 2.5);
    this.px += this.vx * step;
    this.py += this.vy * step;
    const d = Math.hypot(this.px, this.py);
    if (d > 1) {
      // Bounce off the rim, losing some speed.
      const nx = this.px / d;
      const ny = this.py / d;
      this.px = nx;
      this.py = ny;
      const vn = this.vx * nx + this.vy * ny;
      if (vn > 0) {
        this.vx -= 1.6 * vn * nx;
        this.vy -= 1.6 * vn * ny;
      }
    }
  }

  /** Spins the pupil round the rim (dizzy). */
  spin(time: number): void {
    this.px = Math.cos(time * 9);
    this.py = Math.sin(time * 9);
    this.vx = 0;
    this.vy = 0;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pupil = 0.55): void {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = PHOTO_INK;
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const pr = r * pupil;
    const room = r - pr - ctx.lineWidth * 0.5;
    const px = x + this.px * room;
    const py = y + this.py * room;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(px - pr * 0.35, py - pr * 0.35, pr * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- the player ---------------------------------------------------------------------

type BirdState = Pick<Game, "bird" | "charge" | "stunned" | "phase" | "time">;

/** The RTX player: the photo pigeon and the photo pufferfish, googly-eyed (or wearing the player's face). */
export class RtxPlayer {
  /** Wingbeat phase of the bird (in wingbeats). */
  private flapPhase = 0;
  /** The bird's drawn tilt, easing after the real one so turns look smooth. */
  private birdRot = 0;
  private frameDt = 1 / 60;
  private readonly birdEyes = [new GooglyEye(), new GooglyEye()];
  private readonly fishEye = new GooglyEye();
  /** The fish's jelly wobble: a spring kicked whenever its puff changes. */
  private wobble = 0;
  private wobbleV = 0;
  private lastPuff = 0;

  /** Advances the animation; call once per frame. */
  tick(game: BirdState, dt: number): void {
    this.frameDt = dt;
    // About one wingbeat a second, a bit faster while straining; eased tilt.
    this.flapPhase += dt * (game.phase === "playing" ? 1 + game.charge.charge * 0.6 : 0.3);
    this.birdRot += (game.bird.rot - this.birdRot) * Math.min(1, dt * 6);
  }

  /**
   * The pigeon: flaps through up, glide and down photos (holding each and cross-fading into the
   * next), squashes and trembles while it strains, stretches with relief, sweats. Googly eyes,
   * or the player's face as its head. False until the photos have loaded.
   */
  drawBird(ctx: CanvasRenderingContext2D, game: BirdState, face: HTMLCanvasElement | null): boolean {
    const s = sprites();
    const flap = [s.birdUp, s.birdGlide, s.birdDown, s.birdGlide];
    if (!flap.every(spriteReady)) return false;
    const b = game.bird;
    const c = game.charge.charge;
    const t = this.flapPhase * flap.length;
    const i = Math.floor(t);
    const fade = Math.min(1, Math.max(0, (t - i - 0.5) / 0.5));
    const blend = fade * fade * (3 - 2 * fade);
    const cur = flap[i % flap.length];
    const next = flap[(i + 1) % flap.length];
    let x = b.x;
    let y = b.y + Math.sin(this.flapPhase * Math.PI * 2) * 2;
    if (c > 0.5 && !game.stunned) {
      const amp = (c - 0.5) * 6;
      x += (Math.random() - 0.5) * amp;
      y += (Math.random() - 0.5) * amp;
    }
    const relief = Math.min(1, b.relief);
    const sx = (1 + c * 0.14 - relief * 0.1) / Math.sqrt(b.stretch);
    const sy = (1 - c * 0.16 + relief * 0.16) * b.stretch;
    const rot = this.birdRot;
    ctx.save();
    // The next frame fades in over the current one, which only fades out at the end, so the bird never goes see-through.
    ctx.globalAlpha = blend < 0.5 ? 1 : 2 * (1 - blend);
    drawSpriteOn(ctx, cur, x, y, rot, BIRD_RADIUS, sx, sy);
    ctx.globalAlpha = blend;
    if (blend > 0) drawSpriteOn(ctx, next, x, y, rot, BIRD_RADIUS, sx, sy);
    ctx.restore();

    if (cur.eye && next.eye) {
      const a = spritePoint(cur, x, y, rot, BIRD_RADIUS, sx, sy, cur.eye.x, cur.eye.y);
      const n = spritePoint(next, x, y, rot, BIRD_RADIUS, sx, sy, next.eye.x, next.eye.y);
      const ex = a.x + (n.x - a.x) * blend;
      const ey = a.y + (n.y - a.y) * blend;
      const er = 6.5 * (1 + c * 0.35);
      if (face) {
        drawFaceDisc(ctx, face, ex - Math.cos(rot) * er * 0.5, ey - Math.sin(rot) * er * 0.5, er * 2, rot, c);
      } else {
        const pupil = c > 0.75 ? 0.32 : 0.55;
        const far = { x: ex - Math.cos(rot) * er * 0.9 + Math.sin(rot) * er * 0.5, y: ey - Math.sin(rot) * er * 0.9 - Math.cos(rot) * er * 0.5 };
        const [near, back] = this.birdEyes;
        if (game.stunned) {
          near.spin(game.time);
          back.spin(game.time + 0.4);
        } else {
          near.update(ex, ey, er, this.frameDt);
          back.update(far.x, far.y, er * 0.85, this.frameDt);
        }
        back.draw(ctx, far.x, far.y, er * 0.85, pupil);
        near.draw(ctx, ex, ey, er, pupil);
      }
      // Sweat flying off its head while it strains.
      if (c > 0.55 && !game.stunned) {
        for (let k = 0; k < 3; k++) {
          const tt = (game.time * 1.6 + k / 3) % 1;
          const dx = (k - 1) * 10 * tt - 4;
          const dy = -er - 4 - tt * 14 + tt * tt * 34;
          ctx.globalAlpha = 1 - tt;
          ctx.fillStyle = "#8ecae6";
          ctx.strokeStyle = PHOTO_INK;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ex + dx, ey + dy - 6);
          ctx.quadraticCurveTo(ex + dx + 4, ey + dy, ex + dx, ey + dy + 2);
          ctx.quadraticCurveTo(ex + dx - 4, ey + dy, ex + dx, ey + dy - 6);
          ctx.fill();
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    return true;
  }

  /**
   * The pufferfish: the deflated photo below half puff, the puffed one above, jiggling like jelly
   * whenever its puff changes, with a googly eye (pinpoint when it's about to pop). False until
   * the photos have loaded.
   */
  drawFish(ctx: CanvasRenderingContext2D, game: Game, r: number): boolean {
    const { fishDeflated, fishPuffed } = sprites();
    if (!spriteReady(fishDeflated) || !spriteReady(fishPuffed)) return false;
    const b = game.bird;
    const puff = game.fish.puff;
    const s = puff < 0.5 ? fishDeflated : fishPuffed;
    const dt = Math.min(this.frameDt, 1 / 30);
    this.wobbleV += (puff - this.lastPuff) * 9;
    this.lastPuff = puff;
    this.wobbleV += (-160 * this.wobble - 7 * this.wobbleV) * dt;
    this.wobble = Math.max(-0.25, Math.min(0.25, this.wobble + this.wobbleV * dt));
    const sx = 1 - this.wobble;
    const sy = 1 + this.wobble;
    const rot = b.rot + (game.phase === "playing" ? Math.sin(game.time * 7) * 0.05 : 0);
    drawSpriteOn(ctx, s, b.x, b.y, rot, r, sx, sy);
    if (s.eye) {
      const e = spritePoint(s, b.x, b.y, rot, r, sx, sy, s.eye.x, s.eye.y);
      const er = 6 + r * 0.12;
      if (game.stunned) this.fishEye.spin(game.time);
      else this.fishEye.update(e.x, e.y, er, this.frameDt);
      this.fishEye.draw(ctx, e.x, e.y, er, game.popWarning || game.spike.spiked ? 0.25 : 0.55);
    }
    return true;
  }
}
