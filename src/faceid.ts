// Face recognition (I/O): a 128-d descriptor of an aligned face crop, from
// dlib's ResNet face model (public-domain weights, 99.38% on LFW) run by
// @vladmandic/face-api's FaceRecognitionNet. Only that net is used: MediaPipe
// already found the face, and its eyes align the crop (known-faces.ts).
// main.ts uses it to tell whether the player is a face this tab has already
// calibrated (known-faces.ts has the matching and the privacy rules).
//
// Loaded lazily (dynamic import) when face mode starts, so keyboard play
// never downloads it. The weights are served from public/faceid (copied from
// node_modules on install), never from a CDN.
//
// WebGL only: on tfjs's CPU backend one descriptor blocks the main thread for
// a second or more (phones), which the game can't afford. Without WebGL the
// recognizer fails and every face counts as new, as before face recognition.

import { ALIGNED_SIZE, alignTransform, eyeCentres, goodView } from "./known-faces";
import type { FaceBox } from "./face";
import type { LandmarkPoint } from "./puff";

type FaceApi = typeof import("@vladmandic/face-api");

const WEIGHTS = `${import.meta.env.BASE_URL}faceid`;

export class FaceRecognizer {
  status: "idle" | "loading" | "ready" | "failed" = "idle";
  /** Milliseconds the last descriptor took. */
  lastMs = 0;
  private api: FaceApi | null = null;
  private busy = false;
  private loading: Promise<boolean> | null = null;

  get ready(): boolean {
    return this.status === "ready";
  }

  /** Loads the library on WebGL and the weights. Resolves false on failure (every face then counts as new). */
  load(): Promise<boolean> {
    this.loading ??= this.doLoad();
    return this.loading;
  }

  private async doLoad(): Promise<boolean> {
    this.status = "loading";
    try {
      const api = await import("@vladmandic/face-api");
      // The bundled tfjs has these at runtime; face-api's types leave them out.
      const tf = api.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      if (!(await tf.setBackend("webgl"))) throw new Error("WebGL unavailable");
      await tf.ready();
      await api.nets.faceRecognitionNet.loadFromUri(WEIGHTS);
      this.api = api;
      // Warm up (compiles the shaders) so the first real check isn't slow.
      const warm = Object.assign(document.createElement("canvas"), { width: ALIGNED_SIZE, height: ALIGNED_SIZE });
      await api.nets.faceRecognitionNet.computeFaceDescriptor(warm);
      this.status = "ready";
      console.info("[faceid] face recognition ready");
      return true;
    } catch (err) {
      console.warn("[faceid] face recognition unavailable; every face counts as new", err);
      this.api = null;
      this.status = "failed";
      return false;
    }
  }

  /**
   * The descriptor of an aligned face crop (alignedFaceCrop). null when not
   * ready, or still busy with the previous one (requests are dropped, never queued).
   */
  describe(crop: HTMLCanvasElement): Promise<number[]> | null {
    if (!this.api || this.busy) return null;
    this.busy = true;
    const t0 = performance.now();
    return this.api.nets.faceRecognitionNet
      .computeFaceDescriptor(crop)
      .then((d) => Array.from((Array.isArray(d) ? d[0] : d) as Float32Array))
      .finally(() => {
        this.busy = false;
        this.lastMs = performance.now() - t0;
      });
  }
}

/**
 * The face aligned for recognition (eyes level at fixed spots in a
 * ALIGNED_SIZE² crop), or null for a poor view (small or turned away).
 * `landmarks` must be from the video frame showing now: call it from the
 * tracker's frame callback.
 */
export function alignedFaceCrop(
  video: HTMLVideoElement, landmarks: readonly LandmarkPoint[], box: FaceBox, minPx: number,
): HTMLCanvasElement | null {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H || !goodView(landmarks, box, W, H, minPx)) return null;
  const eyes = eyeCentres(landmarks, W, H);
  const m = eyes && alignTransform(eyes.left, eyes.right, ALIGNED_SIZE);
  if (!m) return null;
  // A fresh canvas per crop: the net reads it asynchronously.
  const c = Object.assign(document.createElement("canvas"), { width: ALIGNED_SIZE, height: ALIGNED_SIZE });
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, ALIGNED_SIZE, ALIGNED_SIZE);
  g.setTransform(...m);
  g.drawImage(video, 0, 0, W, H);
  return c;
}
