// The face worker: runs FaceDetector (MediaPipe and the face lock) off the
// main thread, so a 40–70 ms detection on a phone no longer holds up the
// game's frames. face.ts FaceTracker sends it video frames as ImageBitmaps
// and gets each one back with what was found in it.

import { FaceDetector, type Detection, type LockParams } from "./face-detect";

export type ToWorker =
  /** Absolute URLs: the worker's own URL is no base for the page's paths. */
  | { type: "init"; wasmPath: string; modelPath: string }
  | {
      type: "frame";
      bitmap: ImageBitmap;
      /** Main-thread performance.now() when the frame was taken. */
      now: number;
      switchFace: boolean;
      params: LockParams;
    }
  | { type: "reset" };

export type FromWorker =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "error"; message: string }
  /** The frame's bitmap comes back too, for whoever wants to crop the face out of it. */
  | { type: "detection"; bitmap: ImageBitmap; detection: Detection | null };

let detector: FaceDetector | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      // No CPU fallback here: MediaPipe on the CPU is slow enough that face.ts
      // would rather try the main thread, where the GPU may work.
      detector ??= await FaceDetector.create(msg.wasmPath, msg.modelPath, true, false);
      post({ type: "ready", delegate: detector.delegate });
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "frame") {
    const b = msg.bitmap;
    let detection: Detection | null = null;
    try {
      if (detector) detection = detector.detect(b, b.width, b.height, msg.now, msg.switchFace, msg.params);
    } catch (err) {
      // A bad frame must never kill the loop.
      console.warn("[face] detection error", err);
    }
    post({ type: "detection", bitmap: b, detection }, [b]);
  } else {
    detector?.resetLock();
  }
};
