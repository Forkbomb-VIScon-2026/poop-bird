// Two players from one webcam: everything about who is who, and how a face
// steers, as pure functions (no DOM, no global config; duo-face.ts does the
// I/O and feeds this).
//
// Identity is layered, and the rule is: when in doubt, freeze and ask; never
// guess. A paused game is fine, a swapped player is a broken game.
//
// 1. Per-player locks (frame to frame). Each player has a face lock, like the
//    main game's (face.ts): its own landmarker only ever sees a crop around
//    that player's face, with the other player's face painted over. A lock
//    that jumps (> maxJump face widths, or an abrupt size change) is not
//    followed; a lock missing for `lostTime` is dropped.
// 2. Recognition (low rate, the ground truth): a 128-d face descriptor per
//    player every ~0.75 s, compared with the galleries enrolled at the seat
//    check. A closed-set two-way decision: if "swapped" beats "as is" by a
//    margin on `confirmChecks` consecutive paired checks, the locks change
//    owners (each player keeps their bird, score and calibration). A face far
//    from both galleries is a stranger: never given a slot.
// 3. Fallback without the recognition model: seat sides (P1 on the left of
//    the mirrored image) and a coarse clothing/hair colour signature. A swap
//    then can't be resolved: the game pauses and asks.
// Guards on top: two locks never on one face (convergence), and a lock that
// drifts across the midline (fallback mode) must pass a check to stay.

import type { FaceBox } from "./face";
import type { LandmarkPoint } from "./puff";

export type PlayerId = 0 | 1;
/** Seconds a face may be missing (dropped detections) and still count as the same, confirmed face. */
export const REVERIFY_AFTER = 0.5;
const OTHER = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- Box geometry -------------------------------------------------------------

export function boxCentre(b: FaceBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Horizontal centre in the mirrored image (what the players see): 0 = left. */
export function mirroredX(b: FaceBox): number {
  return 1 - (b.x + b.w / 2);
}

export function boxIoU(a: FaceBox, b: FaceBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Whether `next` continues the track `prev`: the centre moved at most
 * `maxJump` face sizes, and the size changed by less than `maxScale`×.
 */
export function continuesTrack(prev: FaceBox, next: FaceBox, maxJump: number, maxScale = 1.5): boolean {
  const size = Math.max(prev.w, prev.h, 1e-6);
  const a = boxCentre(prev);
  const b = boxCentre(next);
  const ratio = Math.max(next.w, next.h) / size;
  return Math.hypot(b.x - a.x, b.y - a.y) <= maxJump * size && ratio < maxScale && ratio > 1 / maxScale;
}

/** Whether the box sits on the player's side of the mirrored image (P1 left, P2 right), with `margin` of slack past the middle. */
export function onSide(b: FaceBox, p: PlayerId, margin: number): boolean {
  const x = mirroredX(b);
  return p === 0 ? x <= 0.5 + margin : x >= 0.5 - margin;
}

// --- Steering: bank your head -------------------------------------------------

/** Outer eye corners in MediaPipe's face mesh: 33 is the person's right eye (image left), 263 their left. */
export const EYE_OUTER = [33, 263] as const;
/** Inner eye corners, same order. */
export const EYE_INNER = [133, 362] as const;
export const NOSE_TIP = 1;

/**
 * Head roll in degrees from the line between the outer eye corners, in the
 * raw (unmirrored) video. Positive = tilted toward the player's own right
 * shoulder, which is toward the right of the mirrored image they see.
 * `aspect` = video width / height (landmarks are normalized per axis).
 */
export function headRoll(lm: readonly LandmarkPoint[], aspect: number): number | null {
  const a = lm[EYE_OUTER[0]];
  const b = lm[EYE_OUTER[1]];
  if (!a || !b || !(aspect > 0)) return null;
  const dx = (b.x - a.x) * aspect;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  // Tilting right lowers the right eye (a, larger y) relative to the left eye (b).
  return (Math.atan2(a.y - b.y, dx) * 180) / Math.PI;
}

export interface BankParams {
  /** Degrees of tilt (from home) that don't steer. */
  deadZone: number;
  /** Degrees of tilt (from home) for a full turn. */
  full: number;
}

/** Steer command -1..1 from the head roll relative to the player's home roll (their natural tilt). */
export function bankCommand(roll: number, home: number, p: BankParams): number {
  const e = roll - home;
  if (!Number.isFinite(e)) return 0;
  const span = Math.max(1e-3, p.full - p.deadZone);
  const mag = clamp((Math.abs(e) - p.deadZone) / span, 0, 1);
  return mag === 0 ? 0 : Math.sign(e) * mag;
}

/** Exponential smoothing toward `target` with time constant `tau` seconds. */
export function smoothToward(prev: number, target: number, dt: number, tau: number): number {
  if (!Number.isFinite(target)) return prev;
  if (tau <= 0) return target;
  return prev + (target - prev) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

export function median(values: readonly number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Where a player's steering comes from. The sim only sees the command; a new
 * source (e.g. arms from a pose model) just implements this.
 */
export interface SteerSource {
  readonly kind: "bank" | "keys";
  /** -1 (full left) .. 1 (full right); 0 = keep going straight. */
  command(): number;
  reset(): void;
}

/** Two held keys: left and right. Both or neither = straight. */
export class KeySteer implements SteerSource {
  readonly kind = "keys";
  left = false;
  right = false;
  command(): number {
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }
  reset(): void {
    this.left = false;
    this.right = false;
  }
}

/** Head bank: feed it the roll of each detection; level head (within the dead zone) = straight. */
export class BankSteer implements SteerSource {
  readonly kind = "bank";
  home = 0;
  value = 0;
  constructor(private params: () => BankParams & { smoothing: number }) {}
  /** A detection: `roll` in degrees, or null when the face wasn't found (the bird levels out). */
  update(roll: number | null, dt: number): void {
    const p = this.params();
    const target = roll === null ? 0 : bankCommand(roll, this.home, p);
    this.value = clamp(smoothToward(this.value, target, dt, p.smoothing), -1, 1);
  }
  command(): number {
    return this.value;
  }
  reset(): void {
    this.value = 0;
  }
}

// --- Recognition: alignment and quality ----------------------------------------

export interface Point {
  x: number;
  y: number;
}

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

export interface FaceQuality {
  ok: boolean;
  /** Face box width in video pixels. */
  sizePx: number;
  /** Nose offset from the eye midpoint / eye distance (≈0 frontal, ±0.3 turned). */
  yaw: number;
}

/** Whether a face is good enough for a descriptor: big enough and roughly frontal. */
export function faceQuality(lm: readonly LandmarkPoint[], box: FaceBox, width: number, height: number, minPx = 80, maxYaw = 0.45): FaceQuality {
  const eyes = eyeCentres(lm, width, height);
  const nose = lm[NOSE_TIP];
  const sizePx = box.w * width;
  if (!eyes || !nose) return { ok: false, sizePx, yaw: Infinity };
  const mid = { x: (eyes.left.x + eyes.right.x) / 2, y: (eyes.left.y + eyes.right.y) / 2 };
  const dist = Math.hypot(eyes.right.x - eyes.left.x, eyes.right.y - eyes.left.y);
  // Along the eye line, so a tilted (banking) head isn't mistaken for a turned one.
  const ux = (eyes.right.x - eyes.left.x) / Math.max(dist, 1e-6);
  const uy = (eyes.right.y - eyes.left.y) / Math.max(dist, 1e-6);
  const yaw = dist > 1e-6 ? ((nose.x * width - mid.x) * ux + (nose.y * height - mid.y) * uy) / dist : Infinity;
  return { ok: sizePx >= minPx && Math.abs(yaw) <= maxYaw, sizePx, yaw };
}

// --- Recognition: distances and decisions ----------------------------------------

export type Descriptor = ArrayLike<number>;

export function euclidean(a: Descriptor, b: Descriptor): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Distance from a descriptor to a gallery: the nearest of its descriptors (Infinity if empty). */
export function galleryDistance(d: Descriptor, gallery: readonly Descriptor[]): number {
  let best = Infinity;
  for (const g of gallery) best = Math.min(best, euclidean(d, g));
  return best;
}

export interface RecognitionParams {
  /** Above this distance to a gallery a face isn't that player (dlib: ~0.6). */
  unknown: number;
  /** How much closer one answer must be than the other to count. */
  margin: number;
}

export type Verdict = "match" | "other" | "stranger" | "ambiguous";

/** One face against both players' galleries: is it its own player, the other one, a stranger, or unclear? */
export function distanceVerdict(own: number, other: number, p: RecognitionParams): Verdict {
  if (!(Math.min(own, other) <= p.unknown)) return "stranger";
  if (own <= p.unknown && other - own > p.margin) return "match";
  if (other <= p.unknown && own - other > p.margin) return "other";
  return "ambiguous";
}

/**
 * Both players seen: does "as is" or "swapped" explain the two faces better?
 * `d0` = face tracked as P1 against [gallery P1, gallery P2], `d1` likewise for P2.
 */
export function pairDecision(d0: readonly [number, number], d1: readonly [number, number], margin: number): "identity" | "swapped" | "ambiguous" {
  const asIs = d0[0] + d1[1];
  const swapped = d0[1] + d1[0];
  if (!Number.isFinite(asIs) && !Number.isFinite(swapped)) return "ambiguous";
  if (asIs - swapped > margin) return "swapped";
  if (swapped - asIs > margin) return "identity";
  return "ambiguous";
}

/** A face found while searching: whose is it? null = nobody's (stranger or unclear). */
export function recognize(d: readonly [number, number], p: RecognitionParams): PlayerId | null {
  for (const id of [0, 1] as const) {
    if (distanceVerdict(d[id], d[OTHER(id)], p) === "match") return id;
  }
  return null;
}

// --- Fallback appearance: colour signatures ---------------------------------------

/** Coarse colour histograms: the torso (clothing) under the face, and the head (hair, skin). */
export interface Signature {
  torso: number[] | null;
  head: number[];
}

const HUE_BINS = 8;
const GRAY_BINS = 4;
export const HIST_BINS = HUE_BINS * 4 + GRAY_BINS;

/**
 * Normalized HSV histogram of RGBA pixels: 8 hues × 2 saturation × 2 value
 * levels for coloured pixels, plus 4 brightness bins for greys (whose hue is
 * noise). Coarse on purpose: it should survive lighting and pose changes.
 */
export function hsvHistogram(rgba: ArrayLike<number>): number[] {
  const h = new Array<number>(HIST_BINS).fill(0);
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const s = max > 0 ? (max - min) / max : 0;
    let bin: number;
    if (s < 0.2 || v < 0.15) {
      bin = HUE_BINS * 4 + Math.min(GRAY_BINS - 1, Math.floor(v * GRAY_BINS));
    } else {
      let hue: number;
      const d = max - min;
      if (max === r) hue = ((g - b) / d + 6) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      const hb = Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS));
      bin = hb * 4 + (s >= 0.55 ? 2 : 0) + (v >= 0.6 ? 1 : 0);
    }
    h[bin]++;
    n++;
  }
  return n > 0 ? h.map((c) => c / n) : h;
}

/** Bhattacharyya coefficient of two normalized histograms: 1 = identical, 0 = disjoint. */
export function bhattacharyya(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.sqrt(Math.max(0, a[i]) * Math.max(0, b[i]));
  return clamp(s, 0, 1);
}

/** Similarity of two signatures: mostly the clothing when both have it, else the head alone. */
export function signatureSimilarity(a: Signature, b: Signature): number {
  const head = bhattacharyya(a.head, b.head);
  if (!a.torso || !b.torso) return head;
  return 0.7 * bhattacharyya(a.torso, b.torso) + 0.3 * head;
}

function averageHist(list: readonly number[][]): number[] {
  const out = new Array<number>(HIST_BINS).fill(0);
  for (const h of list) for (let i = 0; i < HIST_BINS; i++) out[i] += (h[i] ?? 0) / list.length;
  return out;
}

/** The reference signature from several samples (null if none). */
export function averageSignature(list: readonly Signature[]): Signature | null {
  if (!list.length) return null;
  const torsos = list.map((s) => s.torso).filter((t): t is number[] => t !== null);
  return { torso: torsos.length * 2 >= list.length ? averageHist(torsos) : null, head: averageHist(list.map((s) => s.head)) };
}

/**
 * A signature against both players' references. If the two references look
 * alike (similar clothes) they can't tell the players apart: then only "is it
 * the player at all" counts, and the seat sides keep them apart.
 */
export function appearanceVerdict(
  sig: Signature,
  refs: readonly [Signature | null, Signature | null],
  p: PlayerId,
  params: { minSimilarity: number; margin: number },
): Verdict | null {
  const ownRef = refs[p];
  if (!ownRef) return null;
  const otherRef = refs[OTHER(p)];
  const own = signatureSimilarity(sig, ownRef);
  const distinguishable = otherRef !== null && signatureSimilarity(ownRef, otherRef) < params.minSimilarity;
  if (!distinguishable || !otherRef) return own >= params.minSimilarity ? "match" : "stranger";
  const other = signatureSimilarity(sig, otherRef);
  if (own >= params.minSimilarity && own - other >= params.margin) return "match";
  if (other >= params.minSimilarity && other - own >= params.margin) return "other";
  if (own < params.minSimilarity && other < params.minSimilarity) return "stranger";
  return "ambiguous";
}

// --- The identity state machine -----------------------------------------------------

export type TrackStatus = "locked" | "missing" | "lost";
export type LostReason = "none" | "away" | "jump" | "stranger" | "converge" | "swap" | "midline";
export type IdentityEventType = "acquired" | "lost" | "jump" | "stranger" | "converge" | "swap" | "remap" | "midline";

export interface IdentityEvent {
  type: IdentityEventType;
  player: PlayerId;
}

export interface PlayerTrack {
  status: TrackStatus;
  /** The lock (kept while missing, so tracking resumes around it). */
  box: FaceBox | null;
  /** ms of the last accepted detection. */
  seen: number;
  reason: LostReason;
  /** Crossed the midline (fallback mode): must pass the next check to stay. */
  suspicious: boolean;
  /** An identity check confirmed this lock since it was (re)made. */
  verified: boolean;
  /** Consecutive failed appearance checks (fallback mode). */
  strikes: number;
  /** Consecutive recognition checks calling this face a stranger / the other player. */
  strangerStreak: number;
  otherStreak: number;
  /** Last recognition distances to the galleries of P1 and P2. */
  dist: [number, number] | null;
  /** Last appearance similarities to the references of P1 and P2 (fallback). */
  sim: [number, number] | null;
}

export type IdentityCounts = Record<IdentityEventType, number>;

/** A recognition measurement waiting to be paired with the other player's. */
interface Pending {
  dist: [number, number];
  time: number;
}

export interface IdentityState {
  players: [PlayerTrack, PlayerTrack];
  /** Consecutive paired checks that said "swapped". */
  swapStreak: number;
  /** Bumped whenever a lock is made, dropped or changes owner: older async results are stale. */
  generation: number;
  counts: IdentityCounts;
  pending: [Pending | null, Pending | null];
}

export interface IdentityParams extends RecognitionParams {
  /** Face sizes a lock may move in one frame. */
  maxJump: number;
  maxScale: number;
  /** Box IoU at which two locks count as the same face. */
  convergeIoU: number;
  /** Seconds missing before the lock is dropped. */
  lostTime: number;
  /** Share of the image a face may cross the middle (fallback mode). */
  midlineMargin: number;
  /** Failed appearance checks in a row before a lock is dropped (fallback). */
  strikes: number;
  /** Consecutive recognition checks needed to act (remap, drop a stranger). */
  confirmChecks: number;
  /** No recognition model: seat sides decide, and a swap pauses instead of remapping. */
  sides: boolean;
}

export function emptyTrack(): PlayerTrack {
  return {
    status: "lost", box: null, seen: 0, reason: "none", suspicious: false, verified: false,
    strikes: 0, strangerStreak: 0, otherStreak: 0, dist: null, sim: null,
  };
}

export function initialIdentity(): IdentityState {
  return {
    players: [emptyTrack(), emptyTrack()],
    swapStreak: 0,
    generation: 0,
    counts: { acquired: 0, lost: 0, jump: 0, stranger: 0, converge: 0, swap: 0, remap: 0, midline: 0 },
    pending: [null, null],
  };
}

export interface IdentityResult {
  state: IdentityState;
  events: IdentityEvent[];
}

function clone(s: IdentityState): IdentityState {
  return {
    players: [{ ...s.players[0] }, { ...s.players[1] }],
    swapStreak: s.swapStreak,
    generation: s.generation,
    counts: { ...s.counts },
    pending: [s.pending[0], s.pending[1]],
  };
}

function emit(s: IdentityState, events: IdentityEvent[], type: IdentityEventType, player: PlayerId): void {
  s.counts[type]++;
  events.push({ type, player });
}

/** Has a face lock (following it, or briefly missing). */
export function tracking(t: PlayerTrack): boolean {
  return t.status !== "lost" && t.box !== null;
}

function drop(s: IdentityState, events: IdentityEvent[], p: PlayerId, reason: LostReason): void {
  const t = s.players[p];
  s.players[p] = { ...emptyTrack(), reason };
  s.pending[p] = null;
  s.generation++;
  if (t.status !== "lost") emit(s, events, "lost", p);
}

/** Forget a player's lock entirely (seat reset, or the player switched to keys). */
export function clearPlayer(state: IdentityState, p: PlayerId): IdentityState {
  const s = clone(state);
  s.players[p] = emptyTrack();
  s.pending[p] = null;
  s.swapStreak = 0;
  s.generation++;
  return s;
}

/**
 * One tracking detection for player p (from the crop around its lock). null =
 * no face. A face that doesn't continue the lock is not followed.
 */
export function trackFace(state: IdentityState, p: PlayerId, box: FaceBox | null, now: number, P: IdentityParams): IdentityResult {
  const s = clone(state);
  const events: IdentityEvent[] = [];
  const t = s.players[p];
  if (!tracking(t)) return { state, events };
  let next = box;
  if (next && !continuesTrack(t.box!, next, P.maxJump, P.maxScale)) {
    emit(s, events, "jump", p);
    next = null;
  }
  if (!next) {
    if (now - t.seen > P.lostTime * 1000) drop(s, events, p, "away");
    else t.status = "missing";
    return { state: s, events };
  }
  // Back after more than a blink: the face must be confirmed again. (A dropped
  // frame or two at the same spot is the same face; the regular checks still run.)
  if (t.status === "missing" && now - t.seen > REVERIFY_AFTER * 1000) t.verified = false;
  t.box = next;
  t.seen = now;
  t.status = "locked";
  if (P.sides && !onSide(next, p, P.midlineMargin) && !t.suspicious) {
    t.suspicious = true;
    emit(s, events, "midline", p);
  }
  return { state: s, events };
}

/**
 * A face found while searching for player p's lost lock. `verdict`: what the
 * identity check said about it (null = no identity yet, at the seat check).
 * Returns accepted=false when it isn't given the slot.
 */
export function acquireFace(
  state: IdentityState,
  p: PlayerId,
  box: FaceBox,
  verdict: Verdict | null,
  now: number,
  P: IdentityParams,
): IdentityResult & { accepted: boolean } {
  const t = state.players[p];
  if (t.status !== "lost") return { state, events: [], accepted: false };
  // Without identity (the seat check) or without the model, the seat side decides.
  if ((verdict === null || P.sides) && !onSide(box, p, P.midlineMargin)) return { state, events: [], accepted: false };
  const other = state.players[OTHER(p)];
  if (tracking(other) && boxIoU(other.box!, box) > P.convergeIoU) return { state, events: [], accepted: false };
  const s = clone(state);
  const events: IdentityEvent[] = [];
  if (verdict === "match" || verdict === null) {
    s.players[p] = { ...emptyTrack(), status: "locked", box, seen: now, verified: true };
    s.generation++;
    emit(s, events, "acquired", p);
    return { state: s, events, accepted: true };
  }
  if (verdict === "other" && s.players[p].reason !== "swap") {
    // Fallback mode: this player's seat holds the other player. Ask them to swap back.
    s.players[p].reason = "swap";
    emit(s, events, "swap", p);
  } else if (verdict === "stranger") {
    emit(s, events, "stranger", p);
  }
  return { state: s, events, accepted: false };
}

/**
 * A recognition measurement of player p's current lock: distances to the
 * galleries [P1, P2]. Paired with the other player's measurement when both
 * are tracked (each measurement is used in one decision only), alone when the
 * other isn't. Acts only after `confirmChecks` consecutive agreeing checks.
 */
export function recognitionCheck(
  state: IdentityState,
  p: PlayerId,
  dist: [number, number],
  now: number,
  P: IdentityParams,
): IdentityResult {
  const s = clone(state);
  const events: IdentityEvent[] = [];
  const t = s.players[p];
  if (!tracking(t)) return { state, events };
  t.dist = dist;
  const q = OTHER(p);
  const other = s.players[q];
  const paired = tracking(other);
  // Strangers first: a face far from both galleries never keeps a slot.
  if (!(Math.min(dist[0], dist[1]) <= P.unknown)) {
    t.strangerStreak++;
    t.verified = false;
    if (t.strangerStreak >= P.confirmChecks) {
      emit(s, events, "stranger", p);
      drop(s, events, p, "stranger");
    }
    s.pending[p] = null;
    return { state: s, events };
  }
  t.strangerStreak = 0;

  if (paired) {
    const mine = { dist, time: now };
    const theirs = s.pending[q];
    if (!theirs || now - theirs.time > 2000) {
      s.pending[p] = mine;
      s.pending[q] = null;
      return { state: s, events };
    }
    s.pending = [null, null];
    const d0 = p === 0 ? dist : theirs.dist;
    const d1 = p === 0 ? theirs.dist : dist;
    const decision = pairDecision(d0, d1, P.margin);
    if (decision === "swapped") {
      s.swapStreak++;
      if (s.swapStreak >= P.confirmChecks) {
        s.swapStreak = 0;
        const [a, b] = s.players;
        s.players = [
          { ...b, verified: true, suspicious: false, strikes: 0, otherStreak: 0, dist: b.dist ? [b.dist[0], b.dist[1]] : null },
          { ...a, verified: true, suspicious: false, strikes: 0, otherStreak: 0, dist: a.dist ? [a.dist[0], a.dist[1]] : null },
        ];
        s.generation++;
        emit(s, events, "remap", 0);
      }
    } else {
      s.swapStreak = 0;
      if (decision === "identity") {
        if (d0[0] <= P.unknown) s.players[0].verified = true;
        if (d1[1] <= P.unknown) s.players[1].verified = true;
        s.players[0].suspicious = s.players[1].suspicious = false;
      }
    }
    return { state: s, events };
  }

  // The other player isn't tracked: judge this face alone.
  s.pending[p] = null;
  const v = distanceVerdict(dist[p], dist[q], P);
  if (v === "match") {
    t.verified = true;
    t.suspicious = false;
    t.otherStreak = 0;
  } else if (v === "other") {
    t.verified = false;
    t.otherStreak++;
    // It's the other player, whose lock is lost: the lock changes owner.
    if (t.otherStreak >= P.confirmChecks && other.status === "lost") {
      s.players[q] = { ...t, verified: true, otherStreak: 0, suspicious: false, reason: "none" };
      s.players[p] = { ...emptyTrack(), reason: "away" };
      s.generation++;
      emit(s, events, "remap", q);
    }
  } else {
    t.otherStreak = 0;
  }
  return { state: s, events };
}

/** A fallback appearance check (no recognition model) of player p's lock. */
export function appearanceCheck(state: IdentityState, p: PlayerId, verdict: Verdict | null, sim: [number, number] | null, P: IdentityParams): IdentityResult {
  const s = clone(state);
  const events: IdentityEvent[] = [];
  const t = s.players[p];
  if (!tracking(t)) return { state, events };
  t.sim = sim;
  if (verdict === null || verdict === "match") {
    t.strikes = 0;
    t.suspicious = false;
    t.verified = true;
    return { state: s, events };
  }
  t.strikes++;
  t.verified = false;
  if (t.suspicious || t.strikes >= P.strikes) {
    if (verdict === "other") emit(s, events, "swap", p);
    else if (verdict === "stranger") emit(s, events, "stranger", p);
    drop(s, events, p, verdict === "other" ? "swap" : t.suspicious ? "midline" : "stranger");
  }
  return { state: s, events };
}

/**
 * Guard: two locks may never sit on one face. If their boxes overlap, the lock
 * whose identity matches worse is dropped (and that player asked back).
 */
export function guardConvergence(state: IdentityState, P: IdentityParams): IdentityResult {
  const [a, b] = state.players;
  if (!tracking(a) || !tracking(b) || boxIoU(a.box!, b.box!) <= P.convergeIoU) return { state, events: [] };
  const s = clone(state);
  const events: IdentityEvent[] = [];
  // Lower = matches its own player better.
  const badness = (t: PlayerTrack, p: PlayerId): number => {
    if (t.dist) return t.dist[p];
    if (t.sim) return 1 - t.sim[p];
    return NaN;
  };
  const ba = badness(a, 0);
  const bb = badness(b, 1);
  let worse: PlayerId;
  if (Number.isFinite(ba) && Number.isFinite(bb) && ba !== bb) worse = ba > bb ? 0 : 1;
  else {
    // No identity to go by: the one off its own side, else the newer lock.
    const offA = onSide(a.box!, 0, 0) ? 0 : 1;
    const offB = onSide(b.box!, 1, 0) ? 0 : 1;
    worse = offA !== offB ? (offA > offB ? 0 : 1) : a.seen > b.seen ? 0 : 1;
  }
  emit(s, events, "converge", worse);
  drop(s, events, worse, "converge");
  return { state: s, events };
}

/** Whether the match may run: every face player has a verified lock that isn't under suspicion. */
export function identitySettled(state: IdentityState, facePlayers: readonly [boolean, boolean], now: number): boolean {
  return ([0, 1] as const).every((p) => {
    if (!facePlayers[p]) return true;
    const t = state.players[p];
    const seen = t.status === "locked" || (t.status === "missing" && now - t.seen <= REVERIFY_AFTER * 1000);
    return seen && t.verified && !t.suspicious;
  });
}

/** Seconds player p's face has been out of view (0 while it's seen). */
export function missingFor(state: IdentityState, p: PlayerId, now: number): number {
  const t = state.players[p];
  if (t.status === "locked") return 0;
  if (t.status === "missing") return Math.max(0, (now - t.seen) / 1000);
  return Infinity;
}
