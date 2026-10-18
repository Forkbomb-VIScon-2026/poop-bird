// Webcam plumbing and the face detection loop. The detection itself (MediaPipe
// Face Landmarker and the face lock) is face-detect.ts; the strain math lives
// in strain.ts.
//
// Detection runs on its own loop, driven by new video frames
// (requestVideoFrameCallback, or a rAF fallback that checks currentTime), so
// it is decoupled from the game's fixed-timestep physics. It runs in a worker
// (face-worker.ts) where it can: each MediaPipe run takes 40–70 ms on a phone,
// and on the main thread that much blocking costs the game most of its frames.
// One frame is in flight at a time; video frames that come in meanwhile are
// skipped, so the face data is never more than one detection old. Without a
// worker (no OffscreenCanvas, no GPU in workers, or the faceWorker tunable
// off) it runs on the main thread as before.

import { config } from "./config";
import { FaceDetector, boundingBox, type Detection, type FaceBox, type LockParams } from "./face-detect";
import type { FromWorker, ToWorker } from "./face-worker";
import { faceGeometry, type LandmarkPoint } from "./puff";
import { extractFeatures, type FeatureVector } from "./strain";
import { RollingTiming } from "./timing";

export type { FaceBox } from "./face-detect";

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/face_landmarker.task`;

/** A video frame to draw from: the video element, or a copy of one of its frames. */
export interface FrameImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface FaceFrame {
  /** null when no face was found in this frame. */
  features: FeatureVector | null;
  /** All raw blendshape scores by name (for the debug panel). */
  blendshapes: Record<string, number>;
  box: FaceBox | null;
  /** The 478 normalized landmarks (for the debug recorder). */
  landmarks: readonly LandmarkPoint[] | null;
  /**
   * The lock just moved to a newly picked face (N, or a full-frame search
   * after losing the previous one): these features don't continue the
   * previous frames', so smoothed signals and sample collection start over.
   */
  newFace: boolean;
  /** Region the detection ran on (normalized, not mirrored); null = the full frame. */
  crop: FaceBox | null;
  /** performance.now() when the video frame was taken. */
  time: number;
  /**
   * The video frame the landmarks are from, to crop the face out of. Only
   * valid during the listener call (a worker frame is closed after it).
   */
  image: FrameImage;
}

export type FaceListener = (frame: FaceFrame) => void;

/** The video element as a FrameImage (its current frame). */
export function videoImage(video: HTMLVideoElement): FrameImage {
  return { source: video, width: video.videoWidth, height: video.videoHeight };
}

/** Whether this browser can run the detection in a worker (MediaPipe's GPU delegate there needs OffscreenCanvas). */
function workersWork(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function";
}

function lockParams(): LockParams {
  return {
    faceCropScale: config.faceCropScale,
    faceLockMaxJump: config.faceLockMaxJump,
    faceRelockSeconds: config.faceRelockSeconds,
  };
}

/** The frame in the worker: when it was taken, and what is waiting for it. */
interface InFlight {
  now: number;
  /** The tracker's generation when it was sent; a result from an older one is dropped. */
  generation: number;
  /** A switchFace() call this frame answers. */
  switched: ((found: boolean) => void) | null;
  /** Main-thread time spent sending it, ms. */
  sendMs: number;
}

export class FaceTracker {
  readonly video: HTMLVideoElement;
  /** Detection on the main thread (no worker). */
  private detector: FaceDetector | null = null;
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private stream: MediaStream | null = null;
  private starting: Promise<void> | null = null;
  private running = false;
  private lastVideoTime = -1;
  private listeners = new Set<FaceListener>();
  private detectionTimes: number[] = [];
  delegate: "GPU" | "CPU" | null = null;
  /** Main-thread time of each detection (sending the frame or detecting, plus the listeners), for the debug panel. */
  readonly detectTiming = new RollingTiming();
  /** Time of each MediaPipe run (a detection can make several: retries, the full-frame search). */
  readonly mediapipeTiming = new RollingTiming();
  /** Age of each video frame when its detection reaches the listeners. */
  readonly latencyTiming = new RollingTiming();
  private inFlight: InFlight | null = null;
  /** Bumped by stop() and resetLock(): detections of frames sent before are dropped. */
  private generation = 0;
  private switchRequest: ((found: boolean) => void) | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get ready(): boolean {
    return (this.detector !== null || this.worker !== null) && this.stream !== null;
  }

  /** Whether detection runs in the worker. */
  get inWorker(): boolean {
    return this.worker !== null;
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

  /** Forgets the locked face; the next detection picks one from the full frame. */
  resetLock(): void {
    this.generation++;
    this.detector?.resetLock();
    this.post({ type: "reset" });
  }

  /**
   * On the next frame, looks for a face other than the locked one (by masking
   * the locked one out) and locks onto it. Resolves false if there was none
   * (or no face was locked), in which case the lock stays where it was.
   */
  switchFace(): Promise<boolean> {
    if (!this.running) return Promise.resolve(false);
    this.switchRequest?.(false);
    return new Promise((resolve) => (this.switchRequest = resolve));
  }

  /** Loads the model, in the worker if it can. Safe to call repeatedly. */
  loadModel(): Promise<void> {
    if (this.detector || this.worker) return Promise.resolve();
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<void> {
    if (config.faceWorker && workersWork()) {
      try {
        await this.startWorker();
        return;
      } catch (err) {
        console.warn("[face] no detection in a worker, running it on the main thread", err);
      }
    }
    const abs = (p: string) => new URL(p, location.href).href;
    this.detector = await FaceDetector.create(abs(WASM_PATH), abs(MODEL_PATH), false, true);
    this.delegate = this.detector.delegate;
  }

  private async startWorker(): Promise<void> {
    const w = new Worker(new URL("./face-worker.ts", import.meta.url), { type: "module" });
    try {
      this.delegate = await new Promise<"GPU" | "CPU">((resolve, reject) => {
        w.onmessage = (e: MessageEvent<FromWorker>) => {
          if (e.data.type === "ready") resolve(e.data.delegate);
          else if (e.data.type === "error") reject(new Error(e.data.message));
        };
        w.onerror = (e) => reject(new Error(e.message || "the face worker failed to load"));
        const abs = (p: string) => new URL(p, location.href).href;
        w.postMessage({ type: "init", wasmPath: abs(WASM_PATH), modelPath: abs(MODEL_PATH) } satisfies ToWorker);
      });
    } catch (err) {
      w.terminate();
      throw err;
    }
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === "detection") this.onWorkerDetection(e.data.bitmap, e.data.detection);
    };
    w.onerror = (e) => console.warn("[face] worker error", e.message);
    this.worker = w;
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
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
    this.generation++;
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
    this.detector?.close();
    this.detector = null;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight?.switched?.(false);
    this.inFlight = null;
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
    this.detectIfNew();
    this.scheduleNext();
  }

  /** Detects in the video's frame if it is one we haven't seen and nothing is in flight. */
  private detectIfNew(): void {
    try {
      const v = this.video;
      if (this.inFlight || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
      if (!v.videoWidth || !v.videoHeight) return;
      if (this.worker) {
        this.lastVideoTime = v.currentTime;
        this.send();
      } else if (this.detector) {
        this.lastVideoTime = v.currentTime;
        this.detectHere();
      }
    } catch (err) {
      // A bad frame must never kill the loop.
      console.warn("[face] detection error", err);
    }
  }

  /** Sends the video's frame to the worker. */
  private send(): void {
    const now = performance.now();
    const flight: InFlight = { now, generation: this.generation, switched: this.switchRequest, sendMs: 0 };
    this.switchRequest = null;
    this.inFlight = flight;
    const drop = () => {
      if (this.inFlight === flight) this.inFlight = null;
      flight.switched?.(false);
    };
    createImageBitmap(this.video).then(
      (bitmap) => {
        if (this.inFlight !== flight || flight.generation !== this.generation || !this.worker) {
          bitmap.close();
          drop();
          return;
        }
        const start = performance.now();
        this.post({ type: "frame", bitmap, now, switchFace: flight.switched !== null, params: lockParams() }, [bitmap]);
        flight.sendMs += performance.now() - start;
      },
      (err) => {
        console.warn("[face] couldn't copy the video frame", err);
        drop();
      },
    );
    flight.sendMs = performance.now() - now;
  }

  private onWorkerDetection(bitmap: ImageBitmap, detection: Detection | null): void {
    const flight = this.inFlight;
    this.inFlight = null;
    try {
      if (!flight || flight.generation !== this.generation) {
        flight?.switched?.(false);
        return;
      }
      const start = performance.now();
      this.emit(detection, { source: bitmap, width: bitmap.width, height: bitmap.height }, flight.now, flight.switched);
      const end = performance.now();
      this.detectTiming.add(end, flight.sendMs + end - start);
    } finally {
      bitmap.close();
    }
    // A newer video frame may be waiting already: no need to wait for the next one.
    if (this.running) this.detectIfNew();
  }

  /** Detects on the main thread (no worker). */
  private detectHere(): void {
    const v = this.video;
    const now = performance.now();
    const switched = this.switchRequest;
    this.switchRequest = null;
    try {
      const detection = this.detector!.detect(v, v.videoWidth, v.videoHeight, now, switched !== null, lockParams());
      this.emit(detection, videoImage(v), now, switched);
    } catch (err) {
      switched?.(false);
      throw err;
    } finally {
      const end = performance.now();
      this.detectTiming.add(end, end - now);
    }
  }

  /** Turns a detection of the frame taken at `now` into a FaceFrame for the listeners. */
  private emit(d: Detection | null, image: FrameImage, now: number, switched: ((found: boolean) => void) | null): void {
    const end = performance.now();
    this.detectionTimes.push(end);
    this.latencyTiming.add(end, end - now);
    for (const ms of d?.mediapipeMs ?? []) this.mediapipeTiming.add(end, ms);
    switched?.(d?.switched ?? false);
    let frame: FaceFrame;
    if (d?.blendshapes && d.landmarks) {
      frame = {
        newFace: d.newFace,
        features: extractFeatures(d.blendshapes, faceGeometry(d.landmarks, image.width / image.height)),
        blendshapes: d.blendshapes,
        box: boundingBox(d.landmarks),
        landmarks: d.landmarks,
        crop: d.crop,
        time: now,
        image,
      };
    } else {
      frame = { features: null, blendshapes: {}, box: null, landmarks: null, newFace: false, crop: d?.crop ?? null, time: now, image };
    }
    for (const fn of this.listeners) fn(frame);
  }
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
