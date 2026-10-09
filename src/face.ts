// MediaPipe Face Landmarker + webcam plumbing. Everything here is I/O; the
// strain math lives in strain.ts.
//
// Detection runs on its own loop, driven by new video frames
// (requestVideoFrameCallback, or a rAF fallback that checks currentTime), so
// it is decoupled from the game's fixed-timestep physics.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { extractFeatures, type FeatureVector } from "./strain";

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}mediapipe/face_landmarker.task`;

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
  /** performance.now() of the detection. */
  time: number;
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
  }

  /** Stops detection and releases the webcam. The loaded model is kept for next time. */
  stopCamera(): void {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
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
    if (!this.landmarker) return;
    // MediaPipe requires strictly increasing timestamps.
    const now = performance.now();
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const result = this.landmarker.detectForVideo(this.video, ts);
    this.detectionTimes.push(now);

    const shapes = result.faceBlendshapes?.[0]?.categories;
    const landmarks = result.faceLandmarks?.[0];
    let frame: FaceFrame;
    if (shapes && shapes.length && landmarks && landmarks.length) {
      const blendshapes: Record<string, number> = {};
      for (const c of shapes) blendshapes[c.categoryName] = c.score;
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of landmarks) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      frame = {
        features: extractFeatures(blendshapes),
        blendshapes,
        box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        time: now,
      };
    } else {
      frame = { features: null, blendshapes: {}, box: null, time: now };
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
