// Face recognition for the two-player mode (I/O): a 128-d descriptor of an
// aligned face crop, from dlib's ResNet face model (public-domain weights,
// 99.38% on LFW) run by @vladmandic/face-api's FaceRecognitionNet. Only that
// net is used: MediaPipe finds and aligns the faces (duo.ts alignTransform).
//
// Loaded lazily (dynamic import) when two-player mode starts, so the
// single-player game never downloads it. The weights are served from
// public/faceid (copied from node_modules on install), never from a CDN.
//
// Privacy: descriptors are biometric data. They live in memory for the
// current two-player session only, are never stored and never sent anywhere.

type FaceApi = typeof import("@vladmandic/face-api");

const WEIGHTS = `${import.meta.env.BASE_URL}faceid`;

export class FaceRecognizer {
  status: "idle" | "loading" | "ready" | "failed" = "idle";
  backend = "–";
  /** Milliseconds the last descriptor took. */
  lastMs = 0;
  private api: FaceApi | null = null;
  private busy = false;
  private loading: Promise<boolean> | null = null;
  /** Bumped by dispose(), so a load that finishes afterwards frees what it loaded. */
  private generation = 0;

  get ready(): boolean {
    return this.status === "ready";
  }

  get idle(): boolean {
    return this.ready && !this.busy;
  }

  /** Loads the library, picks a tfjs backend and loads the weights. Resolves false on failure (the duel falls back). */
  load(): Promise<boolean> {
    this.loading ??= this.doLoad();
    return this.loading;
  }

  private async doLoad(): Promise<boolean> {
    const gen = this.generation;
    this.status = "loading";
    try {
      const api = await import("@vladmandic/face-api");
      // The bundled tfjs has these at runtime; face-api's types leave them out.
      const tf = api.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      // WebGL next to MediaPipe's GPU delegate; CPU if WebGL isn't there.
      let backend = "webgl";
      try {
        if (!(await tf.setBackend("webgl"))) throw new Error("webgl unavailable");
      } catch {
        backend = "cpu";
        await tf.setBackend("cpu");
      }
      await tf.ready();
      await api.nets.faceRecognitionNet.loadFromUri(WEIGHTS);
      if (gen !== this.generation) {
        api.nets.faceRecognitionNet.dispose();
        return false;
      }
      this.api = api;
      this.backend = backend;
      // Warm up (compiles the shaders) so the first real check isn't slow.
      const warm = Object.assign(document.createElement("canvas"), { width: 150, height: 150 });
      await api.nets.faceRecognitionNet.computeFaceDescriptor(warm);
      this.status = "ready";
      console.info(`[faceid] face recognition ready (${backend})`);
      return true;
    } catch (err) {
      console.warn("[faceid] face recognition unavailable; two players fall back to seats and appearance", err);
      this.status = "failed";
      return false;
    }
  }

  /**
   * The descriptor of an aligned 150×150 face crop. null when not ready, or
   * still busy with the previous one (requests are dropped, never queued).
   */
  describe(crop: HTMLCanvasElement): Promise<Float32Array> | null {
    if (!this.api || this.busy) return null;
    this.busy = true;
    const t0 = performance.now();
    const api = this.api;
    return api.nets.faceRecognitionNet
      .computeFaceDescriptor(crop)
      .then((d) => (Array.isArray(d) ? d[0] : d) as Float32Array)
      .finally(() => {
        this.busy = false;
        this.lastMs = performance.now() - t0;
      });
  }

  /** Frees the net's GPU memory. */
  dispose(): void {
    try {
      this.api?.nets.faceRecognitionNet.dispose();
    } catch {
      // ignore
    }
    this.api = null;
    this.status = "idle";
    this.loading = null;
    this.generation++;
  }
}
