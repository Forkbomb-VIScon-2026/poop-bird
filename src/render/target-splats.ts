// Poop that sticks to a target's shape (see TargetSplatter).

import type { Splat, Target } from "../game";
import { rnd } from "../random";
import { drawSplat } from "./effects";
import { oval } from "./shapes";
import { drawTargetBody } from "./street";
import { POOP, POOP_DARK } from "./view";

/** Where a splat sits on its target (target coordinates), or null when there's nothing under it to stick to. */
type Landing = { x: number; y: number } | null;

/**
 * Poop on a target that follows its shape: the splat lands on the first
 * surface below where the poop hit (a head, a shoulder, a car roof), and is
 * clipped to the target's silhouette, so it wraps round heads instead of
 * hanging off them as a flat sticker. Where it crosses the outline it bulges
 * out a little (more on top, where it piles up), with its own dark rim, and its
 * drips run down the body from when it landed.
 *
 * Done per frame with offscreen canvases over just the splatted part of the
 * target: the body is drawn again there (it animates), dilated into masks, and
 * the splats are composited into the masks.
 */
export class TargetSplatter {
  private readonly body = makeLayer();
  private readonly rim = makeLayer();
  private readonly goo = makeLayer();
  private readonly shapes = makeLayer();
  private readonly landings = new WeakMap<Splat, Landing>();

  draw(ctx: CanvasRenderingContext2D, t: Target, time: number): void {
    const m = ctx.getTransform();
    const s = Math.max(1, Math.hypot(m.a, m.b));
    const stuck: { sp: Splat; at: { x: number; y: number } }[] = [];
    for (const sp of t.splats) {
      let at = this.landings.get(sp);
      if (at === undefined) {
        at = this.land(t, time, sp, s);
        this.landings.set(sp, at);
      }
      if (at) stuck.push({ sp, at });
      else drawSplat(ctx, sp.dx, sp.dy, sp.r, sp.seed, 1);
    }
    if (!stuck.length) return;

    // The splatted region, in target coordinates (drips run down, so more below).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { sp, at } of stuck) {
      x0 = Math.min(x0, at.x - sp.r * 1.6);
      x1 = Math.max(x1, at.x + sp.r * 1.6);
      y0 = Math.min(y0, at.y - sp.r * 1.2);
      y1 = Math.max(y1, at.y + sp.r * 3);
    }
    const pad = 8;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const w = Math.ceil((x1 - x0) * s);
    const h = Math.ceil((y1 - y0) * s);

    const body = this.renderBody(t, time, x0, y0, w, h, s);
    // Goo: clipped to the body grown a little (more upward, so it piles up on top).
    const goo = this.dilated(this.goo, body, w, h, 1 * s, 3 * s, 0);
    // Rim: the same, grown by its line width more.
    const rim = this.dilated(this.rim, body, w, h, 2.5 * s, 4.5 * s, 1.5 * s);
    // Each mask keeps the splats only where it covers.
    const shapes = this.shapes;
    for (const [mask, layer] of [[rim, "rim"], [goo, "goo"]] as const) {
      fitLayer(shapes, w, h);
      shapes.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      for (const { sp, at } of stuck) drawStuckSplat(shapes, sp, at, time, layer);
      mask.globalCompositeOperation = "source-in";
      mask.drawImage(shapes.canvas, 0, 0, w, h, 0, 0, w, h);
      mask.globalCompositeOperation = "source-over";
    }
    rim.drawImage(goo.canvas, 0, 0);
    ctx.drawImage(rim.canvas, 0, 0, w, h, x0, y0, w / s, h / s);
  }

  /** Finds the top of the target under the poop: the splat lands there. */
  private land(t: Target, time: number, sp: Splat, s: number): Landing {
    const x0 = sp.dx - sp.r * 0.6;
    const y0 = sp.dy - sp.r;
    const w = Math.max(1, Math.ceil(sp.r * 1.2 * s));
    const h = Math.max(1, Math.ceil((Math.max(0, -y0) + 4) * s));
    const body = this.renderBody(t, time, x0, y0, w, h, s);
    let data: Uint8ClampedArray;
    try {
      data = body.getImageData(0, 0, w, h).data;
    } catch {
      return { x: sp.dx, y: sp.dy };
    }
    // The column under the poop's centre first, then either side of it.
    for (const f of [0.5, 0.25, 0.75, 0, 1]) {
      const col = Math.min(w - 1, Math.round(f * (w - 1)));
      for (let row = 0; row < h; row++) {
        if (data[(row * w + col) * 4 + 3] > 128) {
          return { x: x0 + col / s, y: y0 + row / s + sp.r * 0.25 };
        }
      }
    }
    return null;
  }

  /** Draws the target's body into the body layer, over [x0, y0] and w × h device pixels at scale s. */
  private renderBody(t: Target, time: number, x0: number, y0: number, w: number, h: number, s: number): CanvasRenderingContext2D {
    const b = this.body;
    fitLayer(b, w, h);
    b.save();
    b.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    drawTargetBody(b, t, time);
    b.restore();
    return b;
  }

  /** The body's silhouette grown by `side` px sideways, `up` upwards and `down` downwards (device pixels), roughly. */
  private dilated(
    c: CanvasRenderingContext2D, body: CanvasRenderingContext2D, w: number, h: number, side: number, up: number, down: number,
  ): CanvasRenderingContext2D {
    fitLayer(c, w, h);
    const offsets = [[0, down], [-side, 0], [side, 0], [0, -up], [-side * 0.7, -up * 0.6], [side * 0.7, -up * 0.6]];
    for (const [dx, dy] of offsets) c.drawImage(body.canvas, 0, 0, w, h, dx, dy, w, h);
    return c;
  }
}

function makeLayer(): CanvasRenderingContext2D {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("Canvas 2D not supported");
  return c;
}

/** Makes the layer at least w × h and clears that corner of it. */
function fitLayer(c: CanvasRenderingContext2D, w: number, h: number): void {
  if (c.canvas.width < w || c.canvas.height < h) {
    c.canvas.width = Math.max(c.canvas.width, w);
    c.canvas.height = Math.max(c.canvas.height, h);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.clearRect(0, 0, w, h);
}

/** One splat on a target: a blob where it landed and drips running down. "rim" is its dark outline, a size bigger. */
function drawStuckSplat(
  ctx: CanvasRenderingContext2D, sp: Splat, at: { x: number; y: number }, time: number, layer: "rim" | "goo",
): void {
  const { r, seed } = sp;
  const grow = sp.at === undefined ? 1 : 1 - (1 - Math.min(1, Math.max(0, (time - sp.at) / 1.2))) ** 3;
  const rim = layer === "rim";
  ctx.fillStyle = rim ? POOP_DARK : POOP;
  ctx.strokeStyle = POOP_DARK;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  // Blob
  const n = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.55 + rnd(seed + i) * 0.4);
    pts.push([at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr * 0.55]);
  }
  const mid = (i: number): [number, number] => {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  ctx.beginPath();
  ctx.moveTo(...mid(0));
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    ctx.quadraticCurveTo(p[0], p[1], ...mid(i));
  }
  ctx.closePath();
  ctx.fill();
  if (rim) ctx.stroke();
  // Drips, running down from the blob
  const drips = 1 + Math.floor(rnd(seed + 40) * 3);
  for (let i = 0; i < drips; i++) {
    const x = at.x + (rnd(seed + 41 + i) - 0.5) * r * 1.1;
    const len = r * (0.25 + rnd(seed + 45 + i) * 0.8) * grow;
    const dw = r * (0.09 + rnd(seed + 49 + i) * 0.06) + (rim ? 1.5 : 0);
    const top = at.y + r * 0.15;
    ctx.beginPath();
    ctx.moveTo(x - dw, top);
    ctx.lineTo(x - dw * 0.8, top + len);
    ctx.arc(x, top + len, dw * 1.15, Math.PI, 0, true);
    ctx.lineTo(x + dw, top);
    ctx.closePath();
    ctx.fill();
  }
  if (rim) return;
  // Wet shine
  ctx.fillStyle = "#9c6b3a";
  oval(ctx, at.x - r * 0.2, at.y - r * 0.18, r * 0.22, r * 0.08, -0.2);
}
