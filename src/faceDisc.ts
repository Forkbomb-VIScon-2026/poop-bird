// The player's webcam face as the bird's head, shared by both graphics styles.

/**
 * Draws `face` (a face crop from the webcam) as a round head centred at (x, y), radius r,
 * tilted with the bird. It bulges and flushes red as the strain c (0..1) builds.
 */
export function drawFaceDisc(
  ctx: CanvasRenderingContext2D,
  face: HTMLCanvasElement,
  x: number,
  y: number,
  r: number,
  rot: number,
  c: number,
): void {
  if (!face.width || !face.height) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1 + c * 0.14, 1 - c * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  // Cover the circle, nudged up a little so the eyes and mouth sit in the middle.
  const k = Math.max((2 * r) / face.width, (2 * r) / face.height) * 1.08;
  const w = face.width * k;
  const h = face.height * k;
  ctx.drawImage(face, -w / 2, -h / 2 - r * 0.06, w, h);
  if (c > 0.05) {
    ctx.fillStyle = `rgba(235,60,40,${Math.min(0.35, c * 0.35)})`;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.strokeStyle = "#1e1b14";
  ctx.stroke();
  ctx.restore();
}
