// Known faces (pure): the faces this browser tab has calibrated, so a player
// who comes back skips calibration and someone new gets their own instead of
// the last player's. A face is a few 128-d descriptors from faceid.ts, and two
// faces are the same person when their descriptors are close (Euclidean
// distance; dlib's model puts the same person under ~0.6).
//
// Privacy: descriptors are biometric data. main.ts keeps them in memory and
// sessionStorage only (storage.ts), so they go when the tab closes, and
// Settings → "Forget faces" deletes them at once. They are never sent anywhere.
//
// Also the geometry recognition needs: eye centres from MediaPipe's landmarks,
// the similarity transform that aligns them for the net, and whether a view of
// the face is good enough to describe.

import type { FaceBox } from "./face";
import type { LandmarkPoint } from "./puff";
import { PUFF_FEATURES, STRAIN_FEATURES, restoreCalibration, type Calibration } from "./strain";

export type Descriptor = readonly number[];

/** The tutorials (new-player lessons), each shown once per face. */
export const TUTORIALS = ["city", "ocean"] as const;
export type Tutorial = (typeof TUTORIALS)[number];

export interface KnownFace {
  id: number;
  /** A few descriptors of the face, from different moments (light and expression vary a little). */
  descriptors: Descriptor[];
  /** The strain calibration, if one was made for this face. */
  strain: Calibration | null;
  /** `strain` is the default one (the perch's quick relaxed-face read), not a full calibration. */
  strainIsDefault: boolean;
  /** The puff calibration (the swim lesson's), if one passed for this face. */
  puff: Calibration | null;
  /** The tutorials this face has seen. */
  tutorials: Tutorial[];
  /** Date.now() when last recognized or calibrated; the oldest face goes when there are too many. */
  lastSeen: number;
}

/** Most faces kept (a busy booth): the one seen longest ago goes first. */
export const MAX_KNOWN_FACES = 20;
/** Most descriptors kept per face. */
export const MAX_DESCRIPTORS = 6;
/** A descriptor closer than this to one already kept adds nothing. */
const MIN_DESCRIPTOR_NOVELTY = 0.15;

// --- Matching -------------------------------------------------------------------------

export function euclidean(a: Descriptor, b: Descriptor): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Distance from a descriptor to a set of them: the nearest one (Infinity if empty). */
export function galleryDistance(d: Descriptor, gallery: readonly Descriptor[]): number {
  let best = Infinity;
  for (const g of gallery) best = Math.min(best, euclidean(d, g));
  return best;
}

/** Distance from fresh samples of a face to a known face: the median over the samples, so one odd view doesn't decide. */
export function faceDistance(samples: readonly Descriptor[], face: KnownFace): number {
  if (!samples.length) return Infinity;
  const ds = samples.map((s) => galleryDistance(s, face.descriptors)).sort((a, b) => a - b);
  const mid = ds.length >> 1;
  return ds.length % 2 ? ds[mid] : (ds[mid - 1] + ds[mid]) / 2;
}

/** The known face nearest to the samples, if it's nearer than `maxDistance`; null = someone new. */
export function recognize(
  samples: readonly Descriptor[], faces: readonly KnownFace[], maxDistance: number,
): { face: KnownFace; distance: number } | null {
  let best: { face: KnownFace; distance: number } | null = null;
  for (const face of faces) {
    const distance = faceDistance(samples, face);
    if (distance < maxDistance && (!best || distance < best.distance)) best = { face, distance };
  }
  return best;
}

/**
 * A sample joins a recognized face's descriptors only within this share of the
 * match distance: a borderline match (maybe someone else) mustn't widen the
 * face, or that someone would match it from then on.
 */
export const GROW_WITHIN = 0.7;

/**
 * `face` with the samples that add something kept too (the newest ones, up to
 * MAX_DESCRIPTORS): not near-copies of one it has, nor farther than `maxDistance`.
 */
export function withDescriptors(face: KnownFace, samples: readonly Descriptor[], maxDistance = Infinity): KnownFace {
  const descriptors = [...face.descriptors];
  for (const s of samples) {
    const d = galleryDistance(s, descriptors);
    if (!descriptors.length || (d >= MIN_DESCRIPTOR_NOVELTY && d < maxDistance)) descriptors.push(s);
  }
  // The first one stays (it was the clearest view: the face had just sat down); the oldest of the rest go.
  while (descriptors.length > MAX_DESCRIPTORS) descriptors.splice(1, 1);
  return { ...face, descriptors };
}

/** `faces` with `face` added or replaced (by id), at most MAX_KNOWN_FACES, dropping the one seen longest ago. */
export function upsertFace(faces: readonly KnownFace[], face: KnownFace): KnownFace[] {
  const out = faces.filter((f) => f.id !== face.id);
  out.push(face);
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out.slice(0, MAX_KNOWN_FACES);
}

/** An id not taken by any of `faces`. */
export function nextFaceId(faces: readonly KnownFace[]): number {
  return faces.reduce((m, f) => Math.max(m, f.id), 0) + 1;
}

// --- Storage format --------------------------------------------------------------------

/** For storage: descriptors rounded to 4 decimals (they're ~±0.3, so that's well below the noise). */
export function serializeFaces(faces: readonly KnownFace[]): string {
  return JSON.stringify(faces.map((f) => ({ ...f, descriptors: f.descriptors.map((d) => d.map((x) => Math.round(x * 1e4) / 1e4)) })));
}

/** Faces from storage; anything malformed is dropped (one bad entry doesn't lose the rest). */
export function parseFaces(raw: unknown): KnownFace[] {
  if (!Array.isArray(raw)) return [];
  const out: KnownFace[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Partial<Record<keyof KnownFace, unknown>>;
    if (typeof f.id !== "number" || !Number.isFinite(f.id) || !Array.isArray(f.descriptors)) continue;
    const descriptors = f.descriptors.filter(
      (d): d is number[] => Array.isArray(d) && d.length > 0 && d.every((x) => typeof x === "number" && Number.isFinite(x)),
    );
    if (!descriptors.length) continue;
    out.push({
      id: f.id,
      descriptors: descriptors.slice(0, MAX_DESCRIPTORS),
      strain: f.strain ? restoreCalibration(f.strain, STRAIN_FEATURES) : null,
      strainIsDefault: f.strainIsDefault === true,
      puff: f.puff ? restoreCalibration(f.puff, PUFF_FEATURES) : null,
      tutorials: Array.isArray(f.tutorials) ? TUTORIALS.filter((t) => (f.tutorials as unknown[]).includes(t)) : [],
      lastSeen: typeof f.lastSeen === "number" && Number.isFinite(f.lastSeen) ? f.lastSeen : 0,
    });
  }
  return out.slice(0, MAX_KNOWN_FACES);
}

// --- Alignment ----------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/** Outer and inner eye corners (MediaPipe face mesh), image-left eye first in a frontal face. */
const EYE_OUTER = [33, 263] as const;
const EYE_INNER = [133, 362] as const;
const NOSE_TIP = 1;

/** Side of the aligned face crop the recognition net takes. */
export const ALIGNED_SIZE = 150;
/** Where the eye centres go in the aligned crop (fractions of its side), dlib-chip-like. */
export const ALIGNED_EYES = { left: { x: 0.32, y: 0.38 }, right: { x: 0.68, y: 0.38 } } as const;

/** Eye centres (mean of the inner and outer corners) in video pixels; `left` is the image-left one. */
export function eyeCentres(lm: readonly LandmarkPoint[], width: number, height: number): { left: Point; right: Point } | null {
  const pts = [EYE_OUTER[0], EYE_INNER[0], EYE_OUTER[1], EYE_INNER[1]].map((i) => lm[i]);
  if (pts.some((p) => !p)) return null;
  const a = { x: ((pts[0].x + pts[1].x) / 2) * width, y: ((pts[0].y + pts[1].y) / 2) * height };
  const b = { x: ((pts[2].x + pts[3].x) / 2) * width, y: ((pts[2].y + pts[3].y) / 2) * height };
  return a.x <= b.x ? { left: a, right: b } : { left: b, right: a };
}

/** A canvas transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

/**
 * The similarity transform (rotation, uniform scale, translation) that puts
 * the eye centres `left`, `right` (source pixels) at their canonical spots in
 * a `size`² crop: eyes level, face centred. null if the eyes coincide.
 */
export function alignTransform(left: Point, right: Point, size = ALIGNED_SIZE): Affine | null {
  const tl = { x: ALIGNED_EYES.left.x * size, y: ALIGNED_EYES.left.y * size };
  const tr = { x: ALIGNED_EYES.right.x * size, y: ALIGNED_EYES.right.y * size };
  const vx = right.x - left.x;
  const vy = right.y - left.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) return null;
  const tx = tr.x - tl.x;
  const ty = tr.y - tl.y;
  const s = Math.hypot(tx, ty) / len;
  const theta = Math.atan2(ty, tx) - Math.atan2(vy, vx);
  const a = s * Math.cos(theta);
  const b = s * Math.sin(theta);
  const c = -b;
  const d = a;
  const e = tl.x - (a * left.x + c * left.y);
  const f = tl.y - (b * left.x + d * left.y);
  return [a, b, c, d, e, f];
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * Whether a view of the face is good enough for a descriptor: at least `minPx`
 * wide in the video and roughly frontal (nose offset from the eye midpoint,
 * along the eye line, at most `maxYaw` eye distances).
 */
export function goodView(lm: readonly LandmarkPoint[], box: FaceBox, width: number, height: number, minPx: number, maxYaw = 0.45): boolean {
  const eyes = eyeCentres(lm, width, height);
  const nose = lm[NOSE_TIP];
  if (!eyes || !nose || box.w * width < minPx) return false;
  const mid = { x: (eyes.left.x + eyes.right.x) / 2, y: (eyes.left.y + eyes.right.y) / 2 };
  const dist = Math.hypot(eyes.right.x - eyes.left.x, eyes.right.y - eyes.left.y);
  if (dist < 1e-6) return false;
  // Along the eye line, so a tilted head isn't mistaken for a turned one.
  const ux = (eyes.right.x - eyes.left.x) / dist;
  const uy = (eyes.right.y - eyes.left.y) / dist;
  const yaw = ((nose.x * width - mid.x) * ux + (nose.y * height - mid.y) * uy) / dist;
  return Math.abs(yaw) <= maxYaw;
}
