// The face detection itself: MediaPipe Face Landmarker plus the face lock.
// No DOM and no global config (params are passed in), so it runs the same in
// the face worker (face-worker.ts) and, where workers can't, on the main
// thread (face.ts FaceTracker).
//
// Face lock: with several people in view, MediaPipe (numFaces: 1) returns
// whichever face it happens to track, and may jump to a bystander whenever its
// tracking confidence drops (straining or puffing does that). So once a face is
// found we lock onto it and only show MediaPipe a square crop around it: other
// faces are simply not in its input. Detecting more faces instead costs one
// landmark-model run per visible face; the crop costs nothing extra.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { LandmarkPoint } from "./puff";

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

/** The face lock tunables (config.ts "Face lock"), passed with every frame so live tuning works. */
export interface LockParams {
  faceCropScale: number;
  faceLockMaxJump: number;
  faceRelockSeconds: number;
}

/** What one detection found. */
export interface Detection {
  /** null when no face was found. */
  blendshapes: Record<string, number> | null;
  /** Landmarks normalized to the full video frame (null without a face). */
  landmarks: LandmarkPoint[] | null;
  /** The lock just moved to a newly picked face (see FaceFrame.newFace). */
  newFace: boolean;
  /** Region the detection ran on (normalized, not mirrored); null = the full frame. */
  crop: FaceBox | null;
  /** Whether a requested switch to another face found one (null: no switch was requested). */
  switched: boolean | null;
  /** Duration of each MediaPipe run in this detection, ms. */
  mediapipeMs: number[];
}

/** A frame to detect in: an ImageBitmap (in the worker) or the video element. */
type Source = ImageBitmap | HTMLVideoElement | OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Canvas = OffscreenCanvas | HTMLCanvasElement;

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

export class FaceDetector {
  private lastTimestamp = 0;
  /** The player's face (normalized box) and when it was last seen. */
  private lock: { box: FaceBox; seen: number } | null = null;
  /** Set while the locked face is missing: the crop widens to cover everywhere it may have moved. */
  private lost = false;
  /** What the previous detection ran on; MediaPipe's tracking only carries over within one kind. */
  private lastInput: "full" | "crop" | "mask" | null = null;
  /** Whether a face was locked before, since the last reset (so the next pick is a new face). */
  private hadLock = false;
  private cropCanvas: Canvas | null = null;
  private maskCanvas: Canvas | null = null;
  /** MediaPipe run times of the detection in progress. */
  private runs: number[] = [];
  private params: LockParams = { faceCropScale: 2.2, faceLockMaxJump: 0.8, faceRelockSeconds: 2 };

  private constructor(
    private readonly landmarker: FaceLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  /**
   * Loads the model on the GPU, falling back to the CPU if `allowCpu`.
   * `module`: load MediaPipe's WASM loader as an ES module, which a module
   * worker needs.
   */
  static async create(wasmPath: string, modelPath: string, module: boolean, allowCpu: boolean): Promise<FaceDetector> {
    const fileset = await FilesetResolver.forVisionTasks(wasmPath, module);
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
    try {
      return new FaceDetector(await make("GPU"), "GPU");
    } catch (err) {
      if (!allowCpu) throw err;
      console.warn("[face] GPU delegate failed, falling back to CPU", err);
      return new FaceDetector(await make("CPU"), "CPU");
    }
  }

  /** Forgets the locked face; the next detection picks one from the full frame. */
  resetLock(): void {
    this.lock = null;
    this.lost = false;
    this.hadLock = false;
  }

  close(): void {
    this.landmarker.close();
  }

  /**
   * Detects the player's face in `source` (W×H px), taken at `now` (ms, the
   * caller's clock). `switchFace`: look for a face other than the locked one
   * (by masking the locked one out) and lock onto it.
   */
  detect(source: Source, W: number, H: number, now: number, switchFace: boolean, params: LockParams): Detection {
    this.params = params;
    this.runs = [];
    let hit: Hit | null = null;
    let crop: FaceBox | null = null;
    let switched: boolean | null = null;
    // A face that doesn't continue the lock: picked by N, or by the full-frame search.
    let picked = false;
    if (switchFace) {
      hit = this.lock ? this.detectMasked(source, [this.lock.box], W, H) : null;
      picked = switched = hit !== null;
    }
    if (!hit) {
      const lock = this.lock;
      const region = lock ? this.cropRegion(lock.box, W, H) : null;
      hit = region ? this.detectCrop(source, region, W, H) : this.acquire(source, W, H);
      picked = !region && hit !== null;
      if (region) crop = { x: region.x / W, y: region.y / H, w: region.side / W, h: region.side / H };
      // A face in the crop that isn't where the locked one was is someone else
      // (e.g. right behind the player). MediaPipe would keep following them,
      // so look again with them painted over.
      if (region && hit && lock) {
        const other = boundingBox(hit.landmarks);
        if (!continues(lock.box, other, params.faceLockMaxJump)) {
          hit = this.detectCrop(source, region, W, H, other);
          if (hit && !continues(lock.box, boundingBox(hit.landmarks), params.faceLockMaxJump)) hit = null;
        }
      }
    }

    if (hit) {
      const newFace = picked && this.hadLock;
      this.lock = { box: boundingBox(hit.landmarks), seen: now };
      this.lost = false;
      this.hadLock = true;
      return { blendshapes: hit.blendshapes, landmarks: hit.landmarks, newFace, crop, switched, mediapipeMs: this.runs };
    }
    // Lost the locked face: keep looking around where it was, and only
    // after a grace period search the full frame again. Never jump to
    // another face straight away.
    if (this.lock) {
      this.lost = true;
      if (now - this.lock.seen > params.faceRelockSeconds * 1000) {
        this.lock = null;
        this.lost = false;
      }
    }
    return { blendshapes: null, landmarks: null, newFace: false, crop, switched, mediapipeMs: this.runs };
  }

  /**
   * The square crop around the locked face, kept inside the video. While the
   * face is lost it widens to cover every position `continues` would accept.
   */
  private cropRegion(box: FaceBox, W: number, H: number): Region {
    const scale = this.params.faceCropScale + (this.lost ? 2 * this.params.faceLockMaxJump : 0);
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
  private detectCrop(source: Source, r: Region, W: number, H: number, mask?: FaceBox): Hit | null {
    this.cropCanvas ??= newCanvas(CROP_PX, CROP_PX);
    const g = context(this.cropCanvas);
    g.drawImage(source, r.x, r.y, r.side, r.side, 0, 0, CROP_PX, CROP_PX);
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

  private detectAt(input: Source) {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const start = performance.now();
    const result = this.landmarker.detectForVideo(input, ts);
    this.runs.push(performance.now() - start);
    return result;
  }

  /**
   * Full-frame search for the player. MediaPipe's own pick among several
   * faces is not necessarily the one in front, so find each face in turn
   * (painting over the ones found so far) and take the biggest. Several
   * detections, but only when there is no lock yet.
   */
  private acquire(source: Source, W: number, H: number): Hit | null {
    const hits: Hit[] = [];
    let hit = this.run("full", source, (p) => p);
    while (hit) {
      hits.push(hit);
      if (hits.length >= ACQUIRE_MAX_FACES) break;
      hit = this.detectMasked(source, hits.map((h) => boundingBox(h.landmarks)), W, H);
    }
    const area = (h: Hit) => {
      const b = boundingBox(h.landmarks);
      return b.w * W * b.h * H;
    };
    return hits.reduce<Hit | null>((best, h) => (!best || area(h) > area(best) ? h : best), null);
  }

  /** Full frame with the given faces painted over, so MediaPipe finds someone else. */
  private detectMasked(source: Source, boxes: readonly FaceBox[], W: number, H: number): Hit | null {
    const c = (this.maskCanvas ??= newCanvas(W, H));
    if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
    const g = context(c);
    g.drawImage(source, 0, 0, W, H);
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
  private run(kind: "full" | "crop" | "mask", input: Source, toFrame: (p: LandmarkPoint) => LandmarkPoint): Hit | null {
    const changed = kind !== this.lastInput;
    this.lastInput = kind;
    let result = this.detectAt(input);
    if (changed && !result.faceLandmarks?.length) result = this.detectAt(input);
    const shapes = result.faceBlendshapes?.[0]?.categories;
    const landmarks = result.faceLandmarks?.[0];
    if (!shapes?.length || !landmarks?.length) return null;
    const blendshapes: Record<string, number> = {};
    for (const c of shapes) blendshapes[c.categoryName] = c.score;
    // Plain objects: MediaPipe's own may carry fields that can't be posted from the worker.
    return { blendshapes, landmarks: landmarks.map((p) => toFrame({ x: p.x, y: p.y, z: p.z })) };
  }
}

/** An OffscreenCanvas where there is one (always in a worker), else a DOM canvas. */
function newCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

function context(c: Canvas): Ctx2D {
  return c.getContext("2d") as Ctx2D;
}

/** Paints over a face (normalized box, plus a margin); `px`/`py` map normalized coordinates to the canvas. */
function paintOver(g: Ctx2D, box: FaceBox, px: (x: number) => number, py: (y: number) => number): void {
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

export function boundingBox(landmarks: readonly LandmarkPoint[]): FaceBox {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
