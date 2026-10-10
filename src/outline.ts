// Cheek outline from the camera image, for the cheek.html experiment: does
// puffing push the face's silhouette out where MediaPipe's mesh barely moves?
// Pure functions only (no DOM): an RGBA image and the 478 landmarks in,
// numbers out, so it is unit-testable.
//
// Everything is measured in a face frame: origin between the outer eye
// corners, u along the eye-to-eye axis, v perpendicular to it (down the face),
// both in eye-corner distances. Probe lines run along u at fixed heights v.
// The heights and the expected edge positions are frozen from the player's
// relaxed face, so they move rigidly with the head and only the silhouette's
// own change is measured, not the mesh's.

export interface Pt {
  x: number;
  y: number;
}

export interface FaceAxes {
  /** Midpoint of the outer eye corners, in pixels. */
  o: Pt;
  /** Unit vector from landmark 33 to 263 (image right for an unmirrored, upright face). */
  ex: Pt;
  /** ex turned 90°, pointing down the face. */
  ey: Pt;
  /** Eye-corner distance in pixels: the unit of u and v. */
  s: number;
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Landmarks = readonly { x: number; y: number }[];

/** Contour landmark pairs (image-left side, image-right side) whose heights the probes use, cheekbone to jaw. */
export const PROBE_ANCHORS = [
  [234, 454],
  [93, 323],
  [132, 361],
  [58, 288],
  [172, 397],
] as const;

/** Probes that cover the cheeks proper (mouth level); the cheekbone and jaw probes are controls. */
export const CHEEK_PROBES = [1, 2, 3];

/** Cheek patch centres (image-left, image-right): mid-cheek, between the nose wing and the contour. */
export const PATCH_ANCHORS = [205, 425] as const;

export function faceAxes(lm: Landmarks, width: number, height: number): FaceAxes | null {
  if (lm.length < 468) return null;
  const a = { x: lm[33].x * width, y: lm[33].y * height };
  const b = { x: lm[263].x * width, y: lm[263].y * height };
  const s = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(s > 1)) return null;
  const ex = { x: (b.x - a.x) / s, y: (b.y - a.y) / s };
  return { o: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ex, ey: { x: -ex.y, y: ex.x }, s };
}

/** Pixel → face coordinates. */
export function toFace(f: FaceAxes, p: Pt): { u: number; v: number } {
  const dx = p.x - f.o.x;
  const dy = p.y - f.o.y;
  return { u: (dx * f.ex.x + dy * f.ex.y) / f.s, v: (dx * f.ey.x + dy * f.ey.y) / f.s };
}

/** Face coordinates → pixel. */
export function fromFace(f: FaceAxes, u: number, v: number): Pt {
  return { x: f.o.x + (u * f.ex.x + v * f.ey.x) * f.s, y: f.o.y + (u * f.ex.y + v * f.ey.y) * f.s };
}

/** One probe line: its height and where the outline is expected on each side (face coordinates). */
export interface Probe {
  v: number;
  uLeft: number;
  uRight: number;
}

/** The probes as the mesh places them in this frame: height = mean of the pair, centres = the contour points. */
export function meshProbes(lm: Landmarks, f: FaceAxes, width: number, height: number): Probe[] {
  return PROBE_ANCHORS.map(([l, r]) => {
    const a = toFace(f, { x: lm[l].x * width, y: lm[l].y * height });
    const b = toFace(f, { x: lm[r].x * width, y: lm[r].y * height });
    return { v: (a.v + b.v) / 2, uLeft: a.u, uRight: b.u };
  });
}

/** Bilinear RGB sample; null outside the image. */
export function sampleRgb(img: RgbaImage, x: number, y: number): [number, number, number] | null {
  if (!(x >= 0 && y >= 0 && x <= img.width - 1 && y <= img.height - 1)) return null;
  const x0 = Math.min(Math.floor(x), img.width - 2);
  const y0 = Math.min(Math.floor(y), img.height - 2);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const i = (y0 * img.width + x0) * 4 + c;
    const top = img.data[i] * (1 - fx) + img.data[i + 4] * fx;
    const bottom = img.data[i + img.width * 4] * (1 - fx) + img.data[i + img.width * 4 + 4] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

export interface EdgeParams {
  /** Search this far either side of the expected position (eye distances). */
  halfWidth: number;
  /** Prior on the edge position: Gaussian with this sd around the expected position (eye distances). */
  sigma: number;
}

export const DEFAULT_EDGE: EdgeParams = { halfWidth: 0.22, sigma: 0.08 };

export interface Edge {
  /** Edge position along the probe (face u). */
  u: number;
  /** Colour gradient at the edge (sum over RGB of the per-pixel change). */
  strength: number;
}

/**
 * The strongest colour edge along the probe line at height v around uCenter,
 * weighted by the prior, refined to sub-pixel with a parabola. null if the
 * line leaves the image.
 */
export function findEdge(img: RgbaImage, f: FaceAxes, v: number, uCenter: number, p: EdgeParams = DEFAULT_EDGE): Edge | null {
  const step = 1 / f.s; // one pixel
  const n = Math.max(5, Math.round((2 * p.halfWidth) / step));
  const u0 = uCenter - p.halfWidth;
  const rgb: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const pt = fromFace(f, u0 + i * step, v);
    const c = sampleRgb(img, pt.x, pt.y);
    if (!c) return null;
    rgb.push(c);
  }
  // Light smoothing (1-2-1), then a central-difference gradient.
  const sm = rgb.map((c, i) => {
    const a = rgb[Math.max(0, i - 1)];
    const b = rgb[Math.min(rgb.length - 1, i + 1)];
    return [0, 1, 2].map((k) => (a[k] + 2 * c[k] + b[k]) / 4);
  });
  const grad = sm.map((_, i) => {
    if (i === 0 || i === sm.length - 1) return 0;
    let g = 0;
    for (let k = 0; k < 3; k++) g += Math.abs(sm[i + 1][k] - sm[i - 1][k]) / 2;
    return g;
  });
  let best = -1;
  let bestScore = -1;
  for (let i = 1; i < grad.length - 1; i++) {
    const du = u0 + i * step - uCenter;
    const score = grad[i] * Math.exp(-(du * du) / (2 * p.sigma * p.sigma));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return null;
  const [a, b, c] = [grad[best - 1], grad[best], grad[best + 1]];
  const denom = a - 2 * b + c;
  const offset = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { u: u0 + (best + offset) * step, strength: b };
}

export interface OutlineMeasure {
  left: (Edge | null)[];
  right: (Edge | null)[];
  /** right − left per probe (eye distances), NaN where an edge is missing. */
  width: number[];
}

export function measureOutline(img: RgbaImage, f: FaceAxes, probes: readonly Probe[], p: EdgeParams = DEFAULT_EDGE): OutlineMeasure {
  const left = probes.map((pr) => findEdge(img, f, pr.v, pr.uLeft, p));
  const right = probes.map((pr) => findEdge(img, f, pr.v, pr.uRight, p));
  const width = probes.map((_, i) => {
    const l = left[i];
    const r = right[i];
    return l && r ? r.u - l.u : NaN;
  });
  return { left, right, width };
}

/**
 * Luminance on an n×n grid over a square patch (side `size`, eye distances)
 * centred at (u, v), normalized to zero mean and unit length so lighting
 * level and contrast drop out. null if the patch leaves the image.
 */
export function patchVector(img: RgbaImage, f: FaceAxes, u: number, v: number, size: number, n = 12): Float64Array | null {
  const out = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const pt = fromFace(f, u + ((i + 0.5) / n - 0.5) * size, v + ((j + 0.5) / n - 0.5) * size);
      const c = sampleRgb(img, pt.x, pt.y);
      if (!c) return null;
      out[j * n + i] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    }
  }
  let mean = 0;
  for (const x of out) mean += x / out.length;
  let norm = 0;
  for (let k = 0; k < out.length; k++) {
    out[k] -= mean;
    norm += out[k] * out[k];
  }
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < out.length; k++) out[k] /= norm;
  return out;
}

/** Normalized cross-correlation of two patchVector results (1 = same shading pattern). */
export function ncc(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

/** Area under the ROC curve: chance that a `pos` value beats a `neg` value (ties count half). NaN if either is empty. */
export function auc(neg: readonly number[], pos: readonly number[]): number {
  const n = neg.filter(Number.isFinite);
  const p = pos.filter(Number.isFinite);
  if (!n.length || !p.length) return NaN;
  const all = [...n.map((x) => ({ x, pos: false })), ...p.map((x) => ({ x, pos: true }))].sort((a, b) => a.x - b.x);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].x === all[i].x) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k].pos) rankSum += rank;
    i = j + 1;
  }
  return (rankSum - (p.length * (p.length + 1)) / 2) / (p.length * n.length);
}

export function median(values: readonly number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
