// Two players' faces from one webcam (I/O). The decisions are pure and live in
// duo.ts; this runs the detectors and feeds them.
//
// One face lock per player, modelled on face.ts's lock: each player has their
// own FaceLandmarker (numFaces: 1, its own VIDEO timestamps) that only ever
// sees a square crop around that player's face, with the other player's face
// painted over. It can't jump to the other player: they're not in its input.
//
// A lost lock is searched for only while allowed (the seat check, or a paused
// match): in the player's half of the image (no recognition), or anywhere
// (recognition decides whose face it is). Strangers found while searching are
// painted over for a while so the search moves on to other faces.
//
// Identity checks run at a low rate on top: face recognition (faceid.ts) when
// the model loaded, else a coarse colour signature of clothes and hair.

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { config } from "./config";
import { CROP_PX, MASK_MARGIN, blendshapeRecord, boundingBox, createFaceLandmarker, faceFeatures, paintOver, type FaceBox } from "./face";
import { FaceRecognizer } from "./faceid";
import {
  acquireFace,
  alignTransform,
  appearanceCheck,
  appearanceVerdict,
  continuesTrack,
  eyeCentres,
  faceQuality,
  galleryDistance,
  guardConvergence,
  headRoll,
  hsvHistogram,
  initialIdentity,
  recognitionCheck,
  recognize,
  signatureSimilarity,
  trackFace,
  tracking,
  clearPlayer,
  ALIGNED_SIZE,
  type IdentityEvent,
  type IdentityParams,
  type IdentityState,
  type PlayerId,
  type Signature,
} from "./duo";
import type { LandmarkPoint } from "./puff";
import type { FeatureVector } from "./strain";

/** Most descriptors kept per player. */
export const GALLERY_MAX = 8;
/** Descriptors per player before recognition takes over from the fallback. */
export const GALLERY_MIN = 2;
/** Seconds between recognition checks of one player while playing. */
const RECOGNITION_INTERVAL = 0.75;
/** Seconds a stranger found while searching stays painted over. */
const STRANGER_MASK = 3;
/** Extra width (share of the image) each side's search region reaches past the middle. */
const SEARCH_OVERLAP = 0.08;
/** Milliseconds between two searches for the same lost face. */
const SEARCH_INTERVAL = 150;
/** Milliseconds two detections may take per video frame before the seats take turns (auto mode). */
const ALTERNATE_MS = 25;

export interface PlayerFrame {
  player: PlayerId;
  /** null: no face for this player in this detection. */
  features: FeatureVector | null;
  box: FaceBox | null;
  landmarks: readonly LandmarkPoint[] | null;
  /** Head roll in degrees (positive = toward the player's right). */
  roll: number | null;
  /** performance.now() of the detection. */
  time: number;
}

export type DuoListener = (frame: PlayerFrame) => void;

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Hit {
  blendshapes: Record<string, number>;
  landmarks: LandmarkPoint[];
}

/** What a player's detector last looked at (for the debug overlay). */
export interface SeatDebug {
  region: FaceBox | null;
  masks: FaceBox[];
  kind: "crop" | "search" | "idle";
}

export class DuoFaceTracker {
  readonly video: HTMLVideoElement;
  readonly recognizer = new FaceRecognizer();
  private landmarkers: [FaceLandmarker | null, FaceLandmarker | null] = [null, null];
  delegate: "GPU" | "CPU" | null = null;
  identity: IdentityState = initialIdentity();
  /** Players tracked by face (a keys player isn't). */
  active: [boolean, boolean] = [true, true];
  /** Searching for a lost player's face is allowed (the seat check, or a paused match). */
  acquire: [boolean, boolean] = [true, true];
  /** Fallback appearance references (clothes and hair colours), from the seat check. */
  refs: [Signature | null, Signature | null] = [null, null];
  /** Face descriptors enrolled at the seat check and early in the match. In memory only. */
  galleries: [Float32Array[], Float32Array[]] = [[], []];
  /** Identity events not yet drained by the controller. */
  private pendingEvents: IdentityEvent[] = [];
  private listeners = new Set<DuoListener>();
  private running = false;
  private disposed = false;
  private loopId = 0;
  private lastVideoTime = -1;
  private lastTick = 0;
  private frameNo = 0;
  private lastTs: [number, number] = [0, 0];
  private lastInput: [string | null, string | null] = [null, null];
  private lastLandmarks: [LandmarkPoint[] | null, LandmarkPoint[] | null] = [null, null];
  private lastCheck: [number, number] = [0, 0];
  private lastSearch: [number, number] = [0, 0];
  private autoAlternate = false;
  /** Debug counters per player: follow detections, retries with a face painted over, accepted, missed. */
  stats = [0, 1].map(() => ({ follows: 0, retries: 0, accepted: 0, missed: 0, searches: 0, poorView: 0 }));
  /** A search candidate waiting for its descriptor. */
  private candidatePending = false;
  private rejected: { box: FaceBox; until: number }[] = [];
  private cropCanvas: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  private searchCanvas: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  private sigCanvas: HTMLCanvasElement | null = null;
  private detections: number[][] = [[], []];
  private detectMs: [number, number] = [0, 0];
  /** For the debug overlay. */
  seatDebug: [SeatDebug, SeatDebug] = [
    { region: null, masks: [], kind: "idle" },
    { region: null, masks: [], kind: "idle" },
  ];

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get ready(): boolean {
    return this.landmarkers[0] !== null && this.landmarkers[1] !== null;
  }

  /** Recognition decides identity: the model is up and every face player has a gallery. */
  get recognizing(): boolean {
    if (!this.recognizer.ready) return false;
    return ([0, 1] as const).every((p) => !this.active[p] || this.galleries[p].length >= GALLERY_MIN);
  }

  /** Detections per second over the last second, per player. */
  detectionRate(p: PlayerId): number {
    const now = performance.now();
    const list = this.detections[p];
    while (list.length && now - list[0] > 1000) list.shift();
    return list.length;
  }

  /** Smoothed milliseconds per detection, per player. */
  detectionMs(p: PlayerId): number {
    return this.detectMs[p];
  }

  /**
   * Track one seat per video frame instead of both: on slow machines (two
   * detections over ALTERNATE_MS), or when forced by duelAlternateSeats.
   * Each seat then updates at half the video rate, but the game stays smooth.
   */
  get alternating(): boolean {
    const mode = Math.round(config.duelAlternateSeats);
    if (mode === 1) return false;
    if (mode === 2) return true;
    // Hysteresis, so it doesn't flip every frame near the threshold.
    const cost = this.detectMs[0] + this.detectMs[1];
    this.autoAlternate = this.autoAlternate ? cost > ALTERNATE_MS * 0.7 : cost > ALTERNATE_MS;
    return this.autoAlternate;
  }

  onFrame(fn: DuoListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  drainEvents(): IdentityEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  params(): IdentityParams {
    return {
      maxJump: config.duelLockMaxJump,
      maxScale: 1.5,
      convergeIoU: config.duelConvergeIoU,
      lostTime: config.duelLostTime,
      midlineMargin: config.duelMidlineMargin,
      strikes: Math.max(1, Math.round(config.duelIdentityStrikes)),
      confirmChecks: 2,
      sides: !this.recognizing,
      unknown: config.duelIdUnknown,
      margin: config.duelIdMargin,
    };
  }

  /** Loads both landmarkers (and starts loading recognition, which may fail on its own). */
  async load(): Promise<void> {
    void this.recognizer.load();
    for (const p of [0, 1] as const) {
      if (this.landmarkers[p]) continue;
      const made = await createFaceLandmarker();
      if (this.disposed) {
        // Left the mode while loading.
        made.landmarker.close();
        return;
      }
      this.landmarkers[p] = made.landmarker;
      this.delegate = made.delegate;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const id = ++this.loopId;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const onVideoFrame = () => {
      if (!this.running || id !== this.loopId) return;
      this.tick();
      v.requestVideoFrameCallback!(onVideoFrame);
    };
    if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(onVideoFrame);
    // A rAF poll too: it detects whenever the video callbacks stall (some
    // browsers don't fire them for a video that isn't on screen).
    const poll = () => {
      if (!this.running || id !== this.loopId) return;
      if (performance.now() - this.lastTick > 120) this.tick();
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  stop(): void {
    this.running = false;
    this.loopId++;
  }

  /** Stops detection and frees both landmarkers and the recognition net. Galleries are forgotten. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const p of [0, 1] as const) {
      try {
        this.landmarkers[p]?.close();
      } catch (err) {
        console.warn("[duo] closing a landmarker failed", err);
      }
      this.landmarkers[p] = null;
    }
    this.recognizer.dispose();
    this.forgetAll();
  }

  /** Forgets every lock, reference and descriptor (leaving the mode). */
  forgetAll(): void {
    this.identity = initialIdentity();
    this.refs = [null, null];
    this.galleries = [[], []];
    this.lastLandmarks = [null, null];
    this.rejected = [];
    this.pendingEvents = [];
  }

  /** A player's seat starts over: lock, references and descriptors dropped. */
  resetPlayer(p: PlayerId): void {
    this.identity = clearPlayer(this.identity, p);
    this.refs[p] = null;
    this.galleries[p] = [];
    this.lastLandmarks[p] = null;
  }

  setActive(p: PlayerId, on: boolean): void {
    this.active[p] = on;
    if (!on) this.identity = clearPlayer(this.identity, p);
  }

  setAcquire(p: PlayerId, on: boolean): void {
    this.acquire[p] = on;
  }

  // --- the detection loop ---------------------------------------------------------

  private tick(): void {
    this.lastTick = performance.now();
    try {
      if (this.ready && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        this.detect();
      }
    } catch (err) {
      // A bad frame must never kill the loop.
      console.warn("[duo] detection error", err);
    }
  }

  private detect(): void {
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!W || !H) return;
    const now = performance.now();
    this.rejected = this.rejected.filter((r) => r.until > now);
    this.frameNo++;
    const order: PlayerId[] = this.alternating ? [(this.frameNo % 2) as PlayerId] : [0, 1];
    const frames: PlayerFrame[] = [];
    // Searching an empty seat costs a full detection: at most one search per
    // video frame, and each seat at most every SEARCH_INTERVAL.
    let searched = false;
    for (const p of order) {
      if (!this.active[p]) {
        this.seatDebug[p] = { region: null, masks: [], kind: "idle" };
        continue;
      }
      let frame: PlayerFrame | null;
      if (tracking(this.identity.players[p])) frame = this.follow(p, W, H, now);
      else if (!searched && now - this.lastSearch[p] >= SEARCH_INTERVAL) {
        searched = true;
        this.lastSearch[p] = now;
        this.stats[p].searches++;
        frame = this.search(p, W, H, now);
      } else frame = this.frameFor(p, null, W, H, now);
      if (frame) frames.push(frame);
    }
    this.apply(guardConvergence(this.identity, this.params()));
    this.runChecks(W, H, now);
    for (const f of frames) for (const fn of this.listeners) fn(f);
  }

  /** Detect around player p's lock and let duo.ts decide whether it continues. */
  private follow(p: PlayerId, W: number, H: number, now: number): PlayerFrame {
    const t = this.identity.players[p];
    const P = this.params();
    const region = this.cropRegion(t.box!, t.status === "missing", W, H);
    const masks = this.masksFor(p);
    // The wide crop (face missing) is its own kind of input: MediaPipe's tracking doesn't carry
    // over a big change of scale, so switching between them gets the retry (see run()).
    let hit = this.detectRegion(p, t.status === "missing" ? "wide" : "crop", region, masks, W, H);
    this.stats[p].follows++;
    let box = hit ? boundingBox(hit.landmarks) : null;
    // Someone else in the crop (right behind the player): look again with them painted over.
    if (hit && box && !continuesTrack(t.box!, box, P.maxJump, P.maxScale)) {
      this.stats[p].retries++;
      hit = this.detectRegion(p, "mask", region, [...masks, box], W, H);
      box = hit ? boundingBox(hit.landmarks) : null;
    }
    this.apply(trackFace(this.identity, p, box, now, P));
    const accepted = hit !== null && box !== null && this.identity.players[p].box === box;
    if (accepted) this.stats[p].accepted++;
    else this.stats[p].missed++;
    return this.frameFor(p, accepted ? hit : null, W, H, now);
  }

  /** Look for player p's lost face (only while allowed). */
  private search(p: PlayerId, W: number, H: number, now: number): PlayerFrame | null {
    if (!this.acquire[p]) {
      this.seatDebug[p] = { region: null, masks: [], kind: "idle" };
      return this.frameFor(p, null, W, H, now);
    }
    const recognizing = this.recognizing;
    // Without recognition (or at the seat check, before there's a gallery) only the player's half.
    const half = !recognizing;
    const x0 = half ? (p === 0 ? 0.5 - SEARCH_OVERLAP : 0) : 0;
    const x1 = half ? (p === 0 ? 1 : 0.5 + SEARCH_OVERLAP) : 1;
    const region: Region = { x: x0 * W, y: 0, w: (x1 - x0) * W, h: H };
    const masks = [...this.masksFor(p), ...this.rejected.map((r) => r.box)];
    const hit = this.detectRegion(p, "search", region, masks, W, H);
    if (!hit) return this.frameFor(p, null, W, H, now);
    const box = boundingBox(hit.landmarks);
    if (recognizing) {
      this.recognizeCandidate(hit, box, W, H);
      return this.frameFor(p, null, W, H, now);
    }
    // Fallback: the seat side and the colour signature decide.
    const hasGallery = this.galleries[p].length > 0 || this.refs[p] !== null;
    const sig = hasGallery ? this.signatureAt(box, W, H) : null;
    const verdict = sig ? appearanceVerdict(sig, this.refs, p, this.appearanceParams()) : null;
    const res = acquireFace(this.identity, p, box, verdict, now, this.params());
    this.apply(res);
    if (!res.accepted && verdict === "stranger") this.rejected.push({ box, until: now + STRANGER_MASK * 1000 });
    if (res.accepted) {
      this.lastLandmarks[p] = hit.landmarks;
      return this.frameFor(p, hit, W, H, now);
    }
    return this.frameFor(p, null, W, H, now);
  }

  /** A face found while searching, with recognition up: whose is it? (async) */
  private recognizeCandidate(hit: Hit, box: FaceBox, W: number, H: number): void {
    if (this.candidatePending || !this.recognizer.idle) return;
    const crop = this.alignedCrop(hit.landmarks, box, W, H);
    if (!crop) return;
    const request = this.recognizer.describe(crop);
    if (!request) return;
    this.candidatePending = true;
    const gen = this.identity.generation;
    void request
      .then((d) => {
        if (gen !== this.identity.generation) return;
        const now = performance.now();
        const dist: [number, number] = [galleryDistance(d, this.galleries[0]), galleryDistance(d, this.galleries[1])];
        const who = recognize(dist, this.params());
        if (who === null || !this.active[who] || tracking(this.identity.players[who]) || !this.acquire[who]) {
          if (who === null) {
            this.rejected.push({ box, until: now + STRANGER_MASK * 1000 });
            this.identity = { ...this.identity, counts: { ...this.identity.counts, stranger: this.identity.counts.stranger + 1 } };
          }
          return;
        }
        const res = acquireFace(this.identity, who, box, "match", now, this.params());
        this.apply(res);
        if (res.accepted) this.identity.players[who].dist = dist;
      })
      .catch((err) => console.warn("[duo] recognition failed", err))
      .finally(() => (this.candidatePending = false));
  }

  /** Identity checks of the current locks: recognition (async) or the colour fallback. */
  private runChecks(W: number, H: number, now: number): void {
    if (this.recognizing) {
      this.runRecognition(W, H, now);
      return;
    }
    for (const p of [0, 1] as const) {
      const t = this.identity.players[p];
      if (!this.active[p] || t.status !== "locked" || !t.box) continue;
      if (this.refs[p]) {
        const interval = (t.verified && !t.suspicious ? config.duelIdentityCheck : 0.15) * 1000;
        if (now - this.lastCheck[p] < interval) continue;
        this.lastCheck[p] = now;
        const sig = this.signatureAt(t.box, W, H);
        if (!sig) continue;
        const sim: [number, number] = [
          this.refs[0] ? signatureSimilarity(sig, this.refs[0]) : 0,
          this.refs[1] ? signatureSimilarity(sig, this.refs[1]) : 0,
        ];
        const verdict = appearanceVerdict(sig, this.refs, p, this.appearanceParams());
        this.apply(appearanceCheck(this.identity, p, verdict, sim, this.params()));
      } else if (!t.verified) {
        // Nothing to check against (seat check): the seat side vouches for it.
        this.apply(appearanceCheck(this.identity, p, null, null, this.params()));
      }
    }
  }

  /**
   * One recognition request at a time, for the most overdue locked player
   * (unverified locks are due sooner). Taking turns this way means neither
   * player can starve the other, so paired checks always complete.
   */
  private runRecognition(W: number, H: number, now: number): void {
    if (!this.recognizer.idle) return;
    let pick: PlayerId | null = null;
    let overdue = 0;
    for (const p of [0, 1] as const) {
      const t = this.identity.players[p];
      if (!this.active[p] || t.status !== "locked" || !t.box || !this.lastLandmarks[p]) continue;
      const interval = (t.verified ? RECOGNITION_INTERVAL : 0.15) * 1000;
      const late = now - this.lastCheck[p] - interval;
      if (late >= 0 && (pick === null || late > overdue)) {
        pick = p;
        overdue = late;
      }
    }
    if (pick === null) return;
    const p = pick;
    const t = this.identity.players[p];
    const crop = this.alignedCrop(this.lastLandmarks[p]!, t.box!, W, H);
    // A poor view (turned, too small): try again a bit later.
    if (!crop) {
      this.stats[p].poorView++;
      this.lastCheck[p] = now - (t.verified ? RECOGNITION_INTERVAL : 0.15) * 1000 + 250;
      return;
    }
    const request = this.recognizer.describe(crop);
    if (!request) return;
    this.lastCheck[p] = now;
    const gen = this.identity.generation;
    void request
      .then((d) => {
        if (gen !== this.identity.generation) return;
        const dist: [number, number] = [galleryDistance(d, this.galleries[0]), galleryDistance(d, this.galleries[1])];
        this.apply(recognitionCheck(this.identity, p, dist, performance.now(), this.params()));
      })
      .catch((err) => console.warn("[duo] recognition failed", err));
  }

  private appearanceParams() {
    return { minSimilarity: config.duelIdentitySimilarity, margin: config.duelIdentityMargin };
  }

  private apply(res: { state: IdentityState; events: IdentityEvent[] }): void {
    this.identity = res.state;
    this.pendingEvents.push(...res.events);
  }

  private frameFor(p: PlayerId, hit: Hit | null, W: number, H: number, now: number): PlayerFrame {
    if (!hit) return { player: p, features: null, box: null, landmarks: null, roll: null, time: now };
    this.lastLandmarks[p] = hit.landmarks;
    return {
      player: p,
      features: faceFeatures(hit.blendshapes, hit.landmarks, W / H),
      box: boundingBox(hit.landmarks),
      landmarks: hit.landmarks,
      roll: headRoll(hit.landmarks, W / H),
      time: now,
    };
  }

  /** Faces player p's detector must not see: the other player's lock. */
  private masksFor(p: PlayerId): FaceBox[] {
    const other = this.identity.players[(1 - p) as PlayerId];
    return this.active[(1 - p) as PlayerId] && tracking(other) ? [other.box!] : [];
  }

  /** The square crop around a lock, kept inside the video; wider while the face is missing (like face.ts). */
  private cropRegion(box: FaceBox, missing: boolean, W: number, H: number): Region {
    const scale = config.faceCropScale + (missing ? 2 * config.duelLockMaxJump : 0);
    const side = Math.min(Math.max(box.w * W, box.h * H) * scale, W, H);
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return {
      x: clamp((box.x + box.w / 2) * W - side / 2, W - side),
      y: clamp((box.y + box.h / 2) * H - side / 2, H - side),
      w: side,
      h: side,
    };
  }

  /** Runs player p's landmarker on a region of the video with `masks` painted over. */
  private detectRegion(p: PlayerId, kind: "crop" | "wide" | "mask" | "search", r: Region, masks: readonly FaceBox[], W: number, H: number): Hit | null {
    const square = kind !== "search";
    const cw = square ? CROP_PX : Math.round(r.w);
    const ch = square ? CROP_PX : Math.round(r.h);
    const store = square ? this.cropCanvas : this.searchCanvas;
    const c = (store[p] ??= document.createElement("canvas"));
    if (c.width !== cw || c.height !== ch) Object.assign(c, { width: cw, height: ch });
    const g = c.getContext("2d")!;
    g.drawImage(this.video, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    const kx = cw / r.w;
    const ky = ch / r.h;
    for (const m of masks) paintOver(g, m, (x) => (x * W - r.x) * kx, (y) => (y * H - r.y) * ky);
    this.seatDebug[p] = {
      region: { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H },
      masks: masks.map((m) => ({ x: m.x + m.w / 2 - (m.w * MASK_MARGIN) / 2, y: m.y + m.h / 2 - (m.h * MASK_MARGIN) / 2, w: m.w * MASK_MARGIN, h: m.h * MASK_MARGIN })),
      kind: kind === "search" ? "search" : "crop",
    };
    const t0 = performance.now();
    const hit = this.run(p, kind, c, (q) => ({ x: (r.x + q.x * r.w) / W, y: (r.y + q.y * r.h) / H, z: (q.z * r.w) / W }));
    this.detectMs[p] += (performance.now() - t0 - this.detectMs[p]) * 0.1;
    this.detections[p].push(performance.now());
    return hit;
  }

  /** One detection; a miss right after the kind of input changed gets one retry (see face.ts run()). */
  private run(p: PlayerId, kind: string, input: HTMLCanvasElement, toFrame: (q: LandmarkPoint) => LandmarkPoint): Hit | null {
    const lm = this.landmarkers[p];
    if (!lm) return null;
    const changed = kind !== this.lastInput[p];
    this.lastInput[p] = kind;
    const detectAt = () => {
      const ts = Math.max(performance.now(), this.lastTs[p] + 1);
      this.lastTs[p] = ts;
      return lm.detectForVideo(input, ts);
    };
    let result = detectAt();
    if (changed && !result.faceLandmarks?.length) result = detectAt();
    const shapes = result.faceBlendshapes?.[0]?.categories;
    const landmarks = result.faceLandmarks?.[0];
    if (!shapes?.length || !landmarks?.length) return null;
    return { blendshapes: blendshapeRecord(shapes), landmarks: landmarks.map(toFrame) };
  }

  // --- recognition and appearance ---------------------------------------------------

  /** The face aligned for recognition (eyes level at fixed spots), or null for a poor view. */
  private alignedCrop(lm: readonly LandmarkPoint[], box: FaceBox, W: number, H: number): HTMLCanvasElement | null {
    if (!faceQuality(lm, box, W, H).ok) return null;
    const eyes = eyeCentres(lm, W, H);
    const m = eyes && alignTransform(eyes.left, eyes.right, ALIGNED_SIZE);
    if (!m) return null;
    // A fresh canvas per request: the net reads it asynchronously, so a shared
    // one could be redrawn (with the other player's face) before it's read.
    const c = Object.assign(document.createElement("canvas"), { width: ALIGNED_SIZE, height: ALIGNED_SIZE });
    const g = c.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, ALIGNED_SIZE, ALIGNED_SIZE);
    g.setTransform(...m);
    g.drawImage(this.video, 0, 0, W, H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  /**
   * Adds a descriptor of player p's current face to their gallery (the seat
   * check and the first seconds of the match). Resolves false if the view was
   * poor, the net was busy, or it isn't there.
   */
  async enroll(p: PlayerId): Promise<boolean> {
    const t = this.identity.players[p];
    const lm = this.lastLandmarks[p];
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!this.recognizer.ready || t.status !== "locked" || !t.box || !lm || !W || !H) return false;
    if (this.galleries[p].length >= GALLERY_MAX) return false;
    const crop = this.alignedCrop(lm, t.box, W, H);
    const request = crop && this.recognizer.describe(crop);
    if (!request) return false;
    const gen = this.identity.generation;
    try {
      const d = await request;
      if (gen !== this.identity.generation || this.galleries[p].length >= GALLERY_MAX) return false;
      this.galleries[p].push(d);
      return true;
    } catch (err) {
      console.warn("[duo] enrolment failed", err);
      return false;
    }
  }

  /** Player p's current colour signature (fallback identity), or null. */
  signatureOf(p: PlayerId): Signature | null {
    const t = this.identity.players[p];
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (t.status !== "locked" || !t.box || !W || !H) return null;
    return this.signatureAt(t.box, W, H);
  }

  /** Colour histograms of the clothes under a face and of the head (hair, skin). */
  private signatureAt(box: FaceBox, W: number, H: number): Signature | null {
    const c = (this.sigCanvas ??= Object.assign(document.createElement("canvas"), { width: 32, height: 32 }));
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    const grab = (x0: number, y0: number, x1: number, y1: number, minShare: number): number[] | null => {
      const want = (x1 - x0) * (y1 - y0);
      const cx0 = Math.max(0, x0);
      const cy0 = Math.max(0, y0);
      const cx1 = Math.min(1, x1);
      const cy1 = Math.min(1, y1);
      if (cx1 <= cx0 || cy1 <= cy0 || ((cx1 - cx0) * (cy1 - cy0)) / want < minShare) return null;
      g.clearRect(0, 0, 32, 32);
      g.drawImage(this.video, cx0 * W, cy0 * H, (cx1 - cx0) * W, (cy1 - cy0) * H, 0, 0, 32, 32);
      try {
        return hsvHistogram(g.getImageData(0, 0, 32, 32).data);
      } catch {
        return null;
      }
    };
    const cx = box.x + box.w / 2;
    const head = grab(box.x - box.w * 0.1, box.y - box.h * 0.35, box.x + box.w * 1.1, box.y + box.h * 0.45, 0.3);
    if (!head) return null;
    const torso = grab(cx - box.w * 0.9, box.y + box.h * 1.1, cx + box.w * 0.9, box.y + box.h * 2.3, 0.3);
    return { head, torso };
  }
}
