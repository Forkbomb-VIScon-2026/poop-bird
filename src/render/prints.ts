// The game-over prints: front pages, wedding photos and the trophy photo.

import type { Tabloid, WeddingPhoto } from "../game";
import { drawPhoto, drawStar, wrapText } from "./shapes";
import { OUTLINE, type Photo } from "./view";

/**
 * A tabloid front page with the photo and headline, laid out to fit w×h (for
 * the game-over screen; the billboard uses drawBillboardAd).
 */
export function drawFrontPage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tabloid: Tabloid | null,
  photos: ReadonlyMap<number, Photo>,
): void {
  const pad = w * 0.06;
  ctx.save();
  // Paper
  ctx.fillStyle = "#f5f1e6";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // Masthead
  const mastH = h * 0.14;
  ctx.fillStyle = "#d62828";
  ctx.fillRect(x + 1.5, y + 1.5, w - 3, mastH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = mastH * 0.62;
  ctx.font = `italic 900 ${size}px Georgia, 'Times New Roman', serif`;
  const mast = "The Daily Dropping";
  const mw = ctx.measureText(mast).width;
  if (mw > w - pad * 2) {
    size *= (w - pad * 2) / mw;
    ctx.font = `italic 900 ${size}px Georgia, 'Times New Roman', serif`;
  }
  ctx.fillText(mast, x + w / 2, y + 1.5 + mastH / 2 + 1);

  // Headline
  const headline = tabloid?.headline ?? "EXCLUSIVE";
  let hs = w * 0.13;
  let lines: string[] = [];
  for (; hs > 6; hs *= 0.9) {
    ctx.font = `900 ${hs}px Impact, 'Arial Black', 'Trebuchet MS', sans-serif`;
    lines = wrapText(ctx, headline, w - pad * 2);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= w - pad * 2)) break;
  }
  ctx.fillStyle = "#111";
  const headTop = y + mastH + pad * 0.8;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, headTop + hs * (0.55 + i * 1.02)));

  // Photo
  const photoTop = headTop + hs * (lines.length * 1.02 + 0.2);
  const footer = h * 0.12;
  const photoH = Math.max(10, y + h - footer - photoTop);
  drawPhoto(ctx, tabloid ? photos.get(tabloid.photoId) : undefined, x + pad, photoTop, w - pad * 2, photoH);
  // EXCLUSIVE badge
  ctx.save();
  ctx.translate(x + w - pad - w * 0.12, photoTop + w * 0.1);
  ctx.rotate(0.3);
  drawStar(ctx, 0, 0, w * 0.15, "#ffd60a");
  ctx.fillStyle = "#d62828";
  ctx.font = `900 ${w * 0.045}px 'Trebuchet MS', sans-serif`;
  ctx.fillText("EXCL!", 0, 1);
  ctx.restore();
  // Body text
  ctx.fillStyle = "#adb5bd";
  const lineH = footer / 3;
  for (let i = 0; i < 2; i++) {
    const ly = y + h - footer + lineH * (i + 0.8);
    ctx.fillRect(x + pad, ly, (w - pad * 2) * (i ? 0.7 : 1), Math.max(1.5, lineH * 0.35));
  }
  ctx.restore();
}

/**
 * The official wedding photo as a framed print: gilt frame, the photo, the
 * couple's names and a caption. `develop` (0..1) whites the photo out while
 * it develops. Returns the print's height.
 */
export function drawWeddingPrint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  info: WeddingPhoto,
  photo: Photo | undefined,
  develop = 0,
): number {
  const pad = w * 0.06;
  const pw = w - pad * 2;
  const ph = pw * 0.75;
  const capH = w * 0.2;
  const h = pad + ph + capH;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 5, y + 7, w, h);
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + pad * 0.35, y + pad * 0.35, w - pad * 0.7, h - pad * 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + pad * 0.55, y + pad * 0.55, w - pad * 1.1, h - pad * 1.1);
  drawPhoto(ctx, photo, x + pad, y + pad, pw, ph);
  if (develop > 0) {
    ctx.fillStyle = `rgba(255,255,255,${develop})`;
    ctx.fillRect(x + pad, y + pad, pw, ph);
  }
  // Caption
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6d4c41";
  ctx.font = `italic 700 ${Math.round(w * 0.075)}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(info.names, x + w / 2, y + pad + ph + capH * 0.36, pw);
  ctx.fillStyle = "#8d6e63";
  ctx.font = `italic ${Math.round(w * 0.05)}px Georgia, 'Times New Roman', serif`;
  const date = new Date().toLocaleDateString("de-CH");
  const caption = info.ruined ? `“Best day of our lives” · ${date}` : `Just married ♥ ${date}`;
  ctx.fillText(caption, x + w / 2, y + pad + ph + capH * 0.72, pw);
  // A sticker in the corner
  ctx.font = `${Math.round(w * 0.1)}px sans-serif`;
  ctx.translate(x + w - pad * 0.6, y + pad * 0.6);
  ctx.rotate(0.3);
  ctx.fillText(info.ruined ? "\u{1F4A9}" : "\u{1F496}", 0, 0);
  ctx.restore();
  return h;
}

/**
 * The fisherman's trophy photo as a snapshot print, with a caption. `develop`
 * (0..1) whites the photo out while it develops. Returns the print's height.
 */
export function drawTrophyPrint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  photo: Photo | undefined,
  develop = 0,
): number {
  const pad = w * 0.05;
  const pw = w - pad * 2;
  const ph = pw * 0.75;
  const capH = w * 0.2;
  const h = pad + ph + capH;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 5, y + 7, w, h);
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  drawPhoto(ctx, photo, x + pad, y + pad, pw, ph);
  if (develop > 0) {
    ctx.fillStyle = `rgba(255,255,255,${develop})`;
    ctx.fillRect(x + pad, y + pad, pw, ph);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = OUTLINE;
  ctx.font = `italic 700 ${Math.round(w * 0.08)}px 'Comic Sans MS', 'Trebuchet MS', cursive`;
  ctx.fillText("Catch of the day!", x + w / 2, y + pad + ph + capH * 0.38, pw);
  ctx.fillStyle = "#6c757d";
  ctx.font = `italic ${Math.round(w * 0.05)}px 'Comic Sans MS', 'Trebuchet MS', cursive`;
  ctx.fillText(`1 pufferfish, a bit spiky · ${new Date().toLocaleDateString("de-CH")}`, x + w / 2, y + pad + ph + capH * 0.74, pw);
  ctx.font = `${Math.round(w * 0.1)}px sans-serif`;
  ctx.translate(x + w - pad * 0.6, y + pad * 0.6);
  ctx.rotate(0.3);
  ctx.fillText("\u{1F3A3}", 0, 0);
  ctx.restore();
  return h;
}
