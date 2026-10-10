// MediaPipe Face Landmarker + webcam plumbing. Everything here is I/O; the
// strain math lives in strain.ts.
//
// Detection runs on its own loop, driven by new video frames
// (requestVideoFrameCallback, or a rAF fallback that checks currentTime), so
// it is decoupled from the game's fixed-timestep physics.
//
// Face lock: with several people in view, MediaPipe (numFaces: 1) returns
// whichever face it happens to track, and may jump to a bystander whenever its
// tracking confidence drops (straining or puffing does that). So once a face is
// found we lock onto it and only show MediaPipe a square crop around it: other
// faces are simply not in its input. Detecting more faces instead costs one
// landmark-model run per visible face; the crop costs nothing extra.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { config } from "./config";
import { faceGeometry, type LandmarkPoint } from "./puff";
import { extractFeatures, type FeatureVector } from "./strain";

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/face_landmarker.task`;
/** Side of the square canvas the crop around the locked face is scaled into. */
const CROP_PX = 384;
/** Most faces the full-frame search for the player looks at. */
const ACQUIRE_MAX_FACES = 3;
/** Margin (× the face box) when painting a face over so MediaPipe looks for another one. */
const MASK_MARGIN = 1.3;

/** Face bounding box in normalized video coordinates (0..1, not mirrored). */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceFrame {
  /** null when no face was found in this frame. */
  features: FeatureVector | null;
  /** All raw blendshape scores by name (for the debug panel). */
  blendshapes: Record<string, number>;
  box: FaceBox | null;
  /** The 478 normalized landmarks (for the debug recorder). */
  landmarks: readonly LandmarkPoint[] | null;
  /** Region the detection ran on (normalized, not mirrored); null = the full frame. */
  crop: FaceBox | null;
  /** performance.now() of the detection. */
  time: number;
}

/** A square crop region in video pixels. */
interface Region {
  x: number;
  y: number;
  side: number;
}

interface Hit {
  blendshapes: Record<string, number>;
  /** Landmarks normalized to the full video frame. */
  landmarks: LandmarkPoint[];
}

export type FaceListener = (frame: FaceFrame) => void;

export class FaceTracker {
  readonly video: HTMLVideoElement;
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private starting: Promise<void> | null = null;
  private running = false;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private listeners = new Set<FaceListener>();
  private detectionTimes: number[] = [];
  delegate: "GPU" | "CPU" | null = null;
  /** The player's face (normalized box) and when it was last seen. */
  private lock: { box: FaceBox; seen: number } | null = null;
  /** Set while the locked face is missing: the crop widens to cover everywhere it may have moved. */
  private lost = false;
  /** What the previous detection ran on; MediaPipe's tracking only carries over within one kind. */
  private lastInput: "full" | "crop" | "mask" | null = null;
  private switchRequest: ((found: boolean) => void) | null = null;
  private cropCanvas: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get ready(): boolean {
    return this.landmarker !== null && this.stream !== null;
  }

  /** Detections per second over the last second. */
  get detectionRate(): number {
    const now = performance.now();
    while (this.detectionTimes.length && now - this.detectionTimes[0] > 1000) this.detectionTimes.shift();
    return this.detectionTimes.length;
  }

  onFrame(fn: FaceListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Whether detection is locked onto a face (false: it searches the full frame). */
  get locked(): boolean {
    return this.lock !== null;
  }

  /** Forgets the locked face; the next detection picks one from the full frame. */
  resetLock(): void {
    this.lock = null;
    this.lost = false;
  }

  /**
   * On the next frame, looks for a face other than the locked one (by masking
   * the locked one out) and locks onto it. Resolves false if there was none,
   * in which case the lock stays where it was.
   */
  switchFace(): Promise<boolean> {
    if (!this.running || !this.lock) return Promise.resolve(false);
    this.switchRequest?.(false);
    return new Promise((resolve) => (this.switchRequest = resolve));
  }

  /** Loads the model (GPU, falling back to CPU). Safe to call repeatedly. */
  async loadModel(): Promise<void> {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
    try {
      this.landmarker = await make("GPU");
      this.delegate = "GPU";
    } catch (err) {
      console.warn("[face] GPU delegate failed, falling back to CPU", err);
      this.landmarker = await make("CPU");
      this.delegate = "CPU";
    }
  }

  /** Asks for the camera. Throws if permission is denied or no camera exists. */
  startCamera(): Promise<void> {
    if (this.stream) return Promise.resolve();
    // Concurrent callers share one request, so we never open two streams.
    this.starting ??= this.openCamera().finally(() => (this.starting = null));
    return this.starting;
  }

  private async openCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser can't access the camera here (needs HTTPS or localhost).");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
      audio: false,
    });
    this.stream = stream;
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.switchRequest?.(false);
    this.switchRequest = null;
  }

  /** Stops detection and releases the webcam. The loaded model is kept for next time. */
  stopCamera(): void {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.resetLock();
  }

  dispose(): void {
    this.stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(() => this.tick());
    } else {
      requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (!this.running) return;
    try {
      // Only detect when the video actually has a new frame.
      if (this.landmarker && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        this.detect();
      }
    } catch (err) {
      // A bad frame must never kill the loop.
      console.warn("[face] detection error", err);
    }
    this.scheduleNext();
  }

  private detect(): void {
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (!this.landmarker || !W || !H) return;
    const now = performance.now();
    this.detectionTimes.push(now);

    let hit: Hit | null = null;
    let crop: FaceBox | null = null;
    if (this.switchRequest) {
      const resolve = this.switchRequest;
      this.switchRequest = null;
      hit = this.lock ? this.detectMasked([this.lock.box], W, H) : null;
      resolve(hit !== null);
    }
    if (!hit) {
      const lock = this.lock;
      const region = lock ? this.cropRegion(lock.box, W, H) : null;
      hit = region ? this.detectCrop(region, W, H) : this.acquire(W, H);
      if (region) crop = { x: region.x / W, y: region.y / H, w: region.side / W, h: region.side / H };
      // A face in the crop that isn't where the locked one was is someone else
      // (e.g. right behind the player). MediaPipe would keep following them,
      // so look again with them painted over.
      if (region && hit && lock) {
        const other = boundingBox(hit.landmarks);
        if (!continues(lock.box, other, config.faceLockMaxJump)) {
          hit = this.detectCrop(region, W, H, other);
          if (hit && !continues(lock.box, boundingBox(hit.landmarks), config.faceLockMaxJump)) hit = null;
        }
      }
    }

    let frame: FaceFrame;
    if (hit) {
      const box = boundingBox(hit.landmarks);
      this.lock = { box, seen: now };
      this.lost = false;
      frame = {
        features: extractFeatures(hit.blendshapes, faceGeometry(hit.landmarks, W / H)),
        blendshapes: hit.blendshapes,
        box,
        landmarks: hit.landmarks,
        crop,
        time: now,
      };
    } else {
      // Lost the locked face: keep looking around where it was, and only
      // after a grace period search the full frame again. Never jump to
      // another face straight away.
      if (this.lock) {
        this.lost = true;
        if (now - this.lock.seen > config.faceRelockSeconds * 1000) this.resetLock();
      }
      frame = { features: null, blendshapes: {}, box: null, landmarks: null, crop, time: now };
    }
    for (const fn of this.listeners) fn(frame);
  }

  /**
   * The square crop around the locked face, kept inside the video. While the
   * face is lost it widens to cover every position `continues` would accept.
   */
  private cropRegion(box: FaceBox, W: number, H: number): Region {
    const scale = config.faceCropScale + (this.lost ? 2 * config.faceLockMaxJump : 0);
    const size = Math.max(box.w * W, box.h * H) * scale;
    const side = Math.min(size, W, H);
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    return {
      x: clamp((box.x + box.w / 2) * W - side / 2, W - side),
      y: clamp((box.y + box.h / 2) * H - side / 2, H - side),
      side,
    };
  }

  /** Detects in the crop `r`, optionally with the face `mask` (normalized box) painted over. */
  private detectCrop(r: Region, W: number, H: number, mask?: FaceBox): Hit | null {
    this.cropCanvas ??= Object.assign(document.createElement("canvas"), { width: CROP_PX, height: CROP_PX });
    const g = this.cropCanvas.getContext("2d")!;
    g.drawImage(this.video, r.x, r.y, r.side, r.side, 0, 0, CROP_PX, CROP_PX);
    if (mask) {
      const k = CROP_PX / r.side;
      paintOver(g, mask, (x) => (x * W - r.x) * k, (y) => (y * H - r.y) * k);
    }
    // MediaPipe's z uses roughly the same scale as x, so it scales with the crop width too.
    return this.run(mask ? "mask" : "crop", this.cropCanvas, (p) => ({
      x: (r.x + p.x * r.side) / W,
      y: (r.y + p.y * r.side) / H,
      z: (p.z * r.side) / W,
    }));
  }

  private detectAt(input: HTMLVideoElement | HTMLCanvasElement) {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return this.landmarker!.detectForVideo(input, ts);
  }

  /**
   * Full-frame search for the player. MediaPipe's own pick among several
   * faces is not necessarily the one in front, so find each face in turn
   * (painting over the ones found so far) and take the biggest. Several
   * detections, but only when there is no lock yet.
   */
  private acquire(W: number, H: number): Hit | null {
    const hits: Hit[] = [];
    let hit = this.run("full", this.video, (p) => p);
    while (hit) {
      hits.push(hit);
      if (hits.length >= ACQUIRE_MAX_FACES) break;
      hit = this.detectMasked(hits.map((h) => boundingBox(h.landmarks)), W, H);
    }
    const area = (h: Hit) => {
      const b = boundingBox(h.landmarks);
      return b.w * W * b.h * H;
    };
    return hits.reduce<Hit | null>((best, h) => (!best || area(h) > area(best) ? h : best), null);
  }

  /** Full frame with the given faces painted over, so MediaPipe finds someone else. */
  private detectMasked(boxes: readonly FaceBox[], W: number, H: number): Hit | null {
    const c = (this.maskCanvas ??= document.createElement("canvas"));
    if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
    const g = c.getContext("2d")!;
    g.drawImage(this.video, 0, 0, W, H);
    for (const box of boxes) paintOver(g, box, (x) => x * W, (y) => y * H);
    // Every masked image is new to MediaPipe's tracking, so always allow the retry.
    this.lastInput = null;
    return this.run("mask", c, (p) => p);
  }

  /**
   * One detection; `toFrame` maps landmarks from the input's coordinates to
   * the full video frame. In VIDEO mode MediaPipe follows the previous
   * frame's face and only runs its face detector on the frame after that
   * fails, so when the kind of input changes (its coordinates no longer
   * match) a miss gets one immediate retry.
   */
  private run(
    kind: "full" | "crop" | "mask",
    input: HTMLVideoElement | HTMLCanvasElement,
    toFrame: (p: LandmarkPoint) => LandmarkPoint,
  ): Hit | null {
    const changed = kind !== this.lastInput;
    this.lastInput = kind;
    let result = this.detectAt(input);
    if (changed && !result.faceLandmarks?.length) result = this.detectAt(input);
    const shapes = result.faceBlendshapes?.[0]?.categories;
    const landmarks = result.faceLandmarks?.[0];
    if (!shapes?.length || !landmarks?.length) return null;
    const blendshapes: Record<string, number> = {};
    for (const c of shapes) blendshapes[c.categoryName] = c.score;
    return { blendshapes, landmarks: landmarks.map(toFrame) };
  }
}

/** Paints over a face (normalized box, plus a margin); `px`/`py` map normalized coordinates to the canvas. */
function paintOver(g: CanvasRenderingContext2D, box: FaceBox, px: (x: number) => number, py: (y: number) => number): void {
  const w = box.w * MASK_MARGIN;
  const h = box.h * MASK_MARGIN;
  const x = box.x + box.w / 2 - w / 2;
  const y = box.y + box.h / 2 - h / 2;
  g.fillStyle = "#808080";
  g.fillRect(px(x), py(y), px(x + w) - px(x), py(y + h) - py(y));
}

/** Whether `next` is plausibly the same face as `prev`: centre within `maxJump` face sizes, similar size. */
function continues(prev: FaceBox, next: FaceBox, maxJump: number): boolean {
  const size = Math.max(prev.w, prev.h);
  const dx = next.x + next.w / 2 - (prev.x + prev.w / 2);
  const dy = next.y + next.h / 2 - (prev.y + prev.h / 2);
  const ratio = Math.max(next.w, next.h) / size;
  return Math.hypot(dx, dy) <= maxJump * size && ratio > 0.67 && ratio < 1.5;
}

function boundingBox(landmarks: readonly LandmarkPoint[]): FaceBox {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Human-friendly message for getUserMedia / model loading failures. */
export function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found.";
  if (name === "NotReadableError") return "The camera is busy (another app or tab is using it).";
  if (err instanceof Error) return err.message;
  return "Something went wrong starting the camera.";
}
