// Canvas helpers: shapes, text and colours used all over the drawing code.

import { OUTLINE, type Photo } from "./view";

export function drawX(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export type RGB = [number, number, number];

export function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(c: RGB, d: number): string {
  return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v + d)))).join(",")})`;
}

/** `shade` for a "#rrggbb" colour. */
export function shadeHex(hex: string, d: number): string {
  const n = parseInt(hex.slice(1), 16);
  return shade([(n >> 16) & 255, (n >> 8) & 255, n & 255], d);
}

export function rgb(c: RGB): string {
  return `rgb(${c.map((v) => Math.round(v)).join(",")})`;
}

/** Draws `photo` cover-cropped into the rect, or a "no photo" placeholder. */
export function drawPhoto(ctx: CanvasRenderingContext2D, photo: Photo | undefined, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (photo && photo.width > 0 && photo.height > 0) {
    const s = Math.max(w / photo.width, h / photo.height);
    const dw = photo.width * s;
    const dh = photo.height * s;
    ctx.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#495057";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#adb5bd";
    ctx.font = `900 ${Math.round(h * 0.5)}px 'Trebuchet MS', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x + w / 2, y + h / 2);
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

/** Breaks `text` into lines that fit `maxWidth` in the current font. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Black-outlined bold text, centred. */
export function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `900 ${Math.round(size)}px 'Trebuchet MS', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.lineJoin = "miter";
}

/** A heart centred roughly on (x, y), `r` about half its width. */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.95);
  ctx.bezierCurveTo(x - r * 1.7, y - r * 0.15, x - r * 0.75, y - r * 1.3, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.75, y - r * 1.3, x + r * 1.7, y - r * 0.15, x, y + r * 0.95);
  ctx.closePath();
}

export function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  heartPath(ctx, x, y, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Shine
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.5, y - r * 0.45, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Darkens a photo's corners: a radial fade to rgba(`rgb`, `alpha`) over the w × h image. */
export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, rgb: string, alpha: number): void {
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, `rgba(${rgb},0)`);
  v.addColorStop(1, `rgba(${rgb},${alpha})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** Fills a circle, and outlines it too with `stroke` (the path stays, for a clip or another stroke). */
export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke = false): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (stroke) ctx.stroke();
}

/** Fills an ellipse rotated by `rot`, and outlines it too with `stroke` (the path stays). */
export function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0, stroke = false): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
  if (stroke) ctx.stroke();
}
