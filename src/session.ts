// Face dataset sessions (schema 2): the scripted recording steps, a recorder
// that packs detection frames into compact columns, and the decoding,
// validation and quality checks shared by the collect page (collect.ts), the
// collector service (collector/server.ts) and the eval scripts.
//
// The collector runs this file in plain Node (types stripped, no bundler), so
// it must not have runtime imports.

export const SESSION_SCHEMA = 2;
export const LANDMARK_COUNT = 478;
/** Landmark coordinates are stored as Int16 in units of 1e-4. */
const LANDMARK_SCALE = 1e4;
/** Feature and blendshape values are rounded to 4 decimals. */
const VALUE_SCALE = 1e4;

export const PARTICIPANT_RE = /^pb-[a-z0-9]{4,12}$/;
export const SESSION_RE = /^s-[a-z0-9-]{8,48}$/;

// --- Scripts -------------------------------------------------------------------

export type Beep = "high" | "low";

export interface SessionStep {
  seconds: number;
  /** Instruction shown to the participant. */
  prompt: string;
  hint?: string;
  /** Stored with every frame of the step; the eval scripts group frames by it. */
  label: string;
  /** Played when the step starts: high for strain or puff, low for relax. */
  beep?: Beep;
}

export const SEGMENT_NAMES = ["calibration", "strain", "puff"] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];

/** Labels of steps where the participant strains or puffs (the rest are relaxed or "ready"). */
export const STRAIN_LABELS = ["strain", "pulseStrain", "longStrain"];
export const PUFF_LABELS = ["fullPuff", "halfPuff", "puffPulse", "lookPuff"];

/**
 * The game's calibration (relax, then strain, same prompts and phase length),
 * plus a "relax again" phase after the strain: the moment that goes wrong in
 * play, recorded so a calibration can be fitted from it.
 */
export function calibrationScript(phaseSeconds: number): SessionStep[] {
  return [
    { seconds: 1.2, prompt: "Get ready to relax…", label: "ready", beep: "low" },
    {
      seconds: phaseSeconds, prompt: "Relax your face", hint: "Neutral face. Look at the screen and relax completely.",
      label: "neutral", beep: "high",
    },
    { seconds: 1.2, prompt: "Get ready to STRAIN…", label: "ready", beep: "low" },
    {
      seconds: phaseSeconds, prompt: "STRAIN! Like you're really constipated 💩",
      hint: "Brows down, eyes squeezed, nose wrinkled, lips pressed. Hold it!", label: "strain", beep: "high",
    },
    { seconds: phaseSeconds, prompt: "Relax again", hint: "Let go completely.", label: "relaxAgain", beep: "low" },
  ];
}

/** A step length between lo and hi seconds (0.1 s steps), so people can't anticipate the cue. */
function between(random: () => number, lo: number, hi: number): number {
  return Math.round((lo + (hi - lo) * random()) * 10) / 10;
}

/**
 * Relaxed and strained faces as they happen in play: relaxing after a strain,
 * quick pulses of random length, a light strain, a long hold, and relaxed
 * faces that aren't a calm stare (looking around, laughing).
 */
export function strainScript(random: () => number = Math.random): SessionStep[] {
  const pulses = [1, 2, 3, 4].flatMap((): SessionStep[] => [
    { seconds: between(random, 1, 2.5), prompt: "STRAIN", label: "pulseStrain", beep: "high" },
    { seconds: between(random, 1, 2.5), prompt: "Relax", label: "pulseRelax", beep: "low" },
  ]);
  return [
    { seconds: 3, prompt: "Next: straining", hint: "High beep: strain. Low beep: relax.", label: "ready", beep: "low" },
    { seconds: 4, prompt: "Relax your face", label: "neutral", beep: "low" },
    { seconds: 4, prompt: "STRAIN and hold", label: "strain", beep: "high" },
    { seconds: 4, prompt: "Relax", label: "relax", beep: "low" },
    ...pulses,
    { seconds: 3, prompt: "Strain just a little", label: "lightStrain", beep: "high" },
    { seconds: 3, prompt: "Relax", label: "relax", beep: "low" },
    { seconds: 5, prompt: "STRAIN and HOLD", label: "longStrain", beep: "high" },
    { seconds: 4, prompt: "Relax", label: "relax2", beep: "low" },
    { seconds: 6, prompt: "Stay relaxed and look around", hint: "Look at the corners of the screen, tilt your head a little.", label: "look", beep: "low" },
    { seconds: 6, prompt: "Smile, laugh, talk", label: "laugh", beep: "low" },
  ];
}

/** Puff levels for the fish (none, half, full), quick puffs, and a puff held while moving. */
export function puffScript(random: () => number = Math.random): SessionStep[] {
  const pulses = [1, 2, 3, 4].flatMap((): SessionStep[] => [
    { seconds: between(random, 1, 2), prompt: "Puff", label: "puffPulse", beep: "high" },
    { seconds: between(random, 1, 2), prompt: "Relax", label: "puffRelax", beep: "low" },
  ]);
  return [
    { seconds: 3, prompt: "Next: puffing your cheeks", hint: "High beep: puff. Low beep: relax.", label: "ready", beep: "low" },
    { seconds: 3, prompt: "Relax your face", label: "neutral", beep: "low" },
    { seconds: 5, prompt: "Puff your cheeks fully and HOLD", label: "fullPuff", beep: "high" },
    { seconds: 3, prompt: "Relax", label: "relax", beep: "low" },
    { seconds: 5, prompt: "Puff halfway and hold", label: "halfPuff", beep: "high" },
    { seconds: 3, prompt: "Relax", label: "relax", beep: "low" },
    ...pulses,
    { seconds: 5, prompt: "Puff and hold while looking around", label: "lookPuff", beep: "high" },
    { seconds: 3, prompt: "Relax", label: "relax", beep: "low" },
  ];
}

// --- Recording -----------------------------------------------------------------

/** One detection frame, as FaceTracker emits it (time in ms, performance.now()). */
export interface RecordedFrame {
  time: number;
  features: Readonly<Record<string, number>> | null;
  blendshapes: Readonly<Record<string, number>>;
  box: { x: number; y: number; w: number; h: number } | null;
  landmarks: readonly { x: number; y: number; z: number }[] | null;
}

export interface SegmentData {
  name: SegmentName;
  /** The script as played, with each step's start in seconds since the segment start. */
  steps: (SessionStep & { start: number })[];
  frames: number;
  /** Seconds since the segment start. */
  t: number[];
  /** Index into `steps` per frame. */
  step: number[];
  /** 1 if a face was found in the frame, else 0. */
  face: number[];
  /** Columns per feature / blendshape name; 0 where no face was found. */
  features: Record<string, number[]>;
  blendshapes: Record<string, number[]>;
  /** x, y, w, h per frame (normalized video coordinates, not mirrored). */
  box: number[];
  /**
   * Base64 of little-endian Int16: LANDMARK_COUNT × (x, y, z) per frame in
   * units of 1e-4, each value minus the same value in the previous frame
   * (frames without a face count as all zeros). The deltas are small, so this
   * compresses about 3× better than absolute values.
   */
  landmarks: string;
}

/**
 * Plays one segment's script against the clock and packs the frames that
 * arrive while it runs. The caller drives the UI with stepAt() and feeds
 * every tracker frame to push().
 */
export class SegmentRecorder {
  readonly name: SegmentName;
  readonly steps: (SessionStep & { start: number })[];
  readonly duration: number;
  private start = -1;
  private frames = 0;
  private t: number[] = [];
  private step: number[] = [];
  private face: number[] = [];
  private features: Record<string, number[]> = {};
  private blendshapes: Record<string, number[]> = {};
  private box: number[] = [];
  private landmarkData = new Int16Array(LANDMARK_COUNT * 3 * 256);
  private previous = new Int16Array(LANDMARK_COUNT * 3);

  // No parameter properties here: Node's type stripping (collector) can't erase them.
  constructor(name: SegmentName, steps: readonly SessionStep[]) {
    this.name = name;
    let start = 0;
    this.steps = steps.map((s) => {
      const out = { ...s, start };
      start = Math.round((start + s.seconds) * 1000) / 1000;
      return out;
    });
    this.duration = start;
  }

  begin(timeMs: number): void {
    this.start = timeMs;
  }

  /** Seconds since begin() (0 before it). */
  elapsed(timeMs: number): number {
    return this.start < 0 ? 0 : Math.max(0, (timeMs - this.start) / 1000);
  }

  /** Index of the step playing at this time: -1 before begin(), steps.length once the script is over. */
  stepAt(timeMs: number): number {
    if (this.start < 0 || timeMs < this.start) return -1;
    const s = (timeMs - this.start) / 1000;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (s >= this.steps[i].start) return s < this.steps[i].start + this.steps[i].seconds ? i : this.steps.length;
    }
    return -1;
  }

  /** Records a frame if it falls inside the script; frames before begin() or after the end are ignored. */
  push(frame: RecordedFrame): void {
    const index = this.stepAt(frame.time);
    if (index < 0 || index >= this.steps.length) return;
    const n = this.frames++;
    this.t.push(Math.round(frame.time - this.start) / 1000);
    this.step.push(index);
    this.face.push(frame.features ? 1 : 0);
    addColumns(this.features, frame.features ?? {}, n);
    addColumns(this.blendshapes, frame.features ? frame.blendshapes : {}, n);
    const b = frame.features ? frame.box : null;
    this.box.push(...(b ? [b.x, b.y, b.w, b.h].map(round) : [0, 0, 0, 0]));

    const per = LANDMARK_COUNT * 3;
    if (this.landmarkData.length < (n + 1) * per) {
      const grown = new Int16Array(this.landmarkData.length * 2);
      grown.set(this.landmarkData);
      this.landmarkData = grown;
    }
    const lm = frame.features ? frame.landmarks : null;
    for (let i = 0; i < per; i++) {
      const p = lm?.[Math.floor(i / 3)];
      const v = p ? clampInt16(Math.round((i % 3 === 0 ? p.x : i % 3 === 1 ? p.y : p.z) * LANDMARK_SCALE)) : 0;
      this.landmarkData[n * per + i] = v - this.previous[i];
      this.previous[i] = v;
    }
  }

  get frameCount(): number {
    return this.frames;
  }

  toJSON(): SegmentData {
    return {
      name: this.name,
      steps: this.steps,
      frames: this.frames,
      t: this.t,
      step: this.step,
      face: this.face,
      features: this.features,
      blendshapes: this.blendshapes,
      box: this.box,
      landmarks: bytesToBase64(new Uint8Array(this.landmarkData.buffer, 0, this.frames * LANDMARK_COUNT * 3 * 2)),
    };
  }
}

/** Appends row n to the columns; a name seen for the first time gets zeros for the earlier rows. */
function addColumns(columns: Record<string, number[]>, values: Readonly<Record<string, number>>, n: number): void {
  for (const k of Object.keys(values)) {
    if (!columns[k]) columns[k] = new Array<number>(n).fill(0);
  }
  for (const [k, col] of Object.entries(columns)) col.push(round(values[k] ?? 0));
}

const round = (v: number) => Math.round(v * VALUE_SCALE) / VALUE_SCALE;
const clampInt16 = (v: number) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);

// --- Session -------------------------------------------------------------------

export interface SessionProfile {
  glasses: string;
  facialHair: string;
  lighting: string;
}

export interface SessionDevice {
  userAgent: string;
  platform: string;
  mobile: boolean;
  camera: string;
  video: { width: number; height: number };
  /** MediaPipe delegate: "GPU" or "CPU". */
  delegate: string;
}

export interface Session {
  schema: typeof SESSION_SCHEMA;
  sessionId: string;
  recordedAt: string;
  /** Git commit of the game code that recorded the session ("unknown" if not built from git). */
  app: { commit: string };
  /** The consent text the participant agreed to, verbatim. */
  consent: { version: string; text: string; agreedAt: string };
  participant: { code: string } & SessionProfile;
  device: SessionDevice;
  /** Camera check right before recording. */
  check: { brightness: number; faceSize: number };
  /** The tuning config at recording time. */
  config: Record<string, number>;
  /** Calibrations the game had saved on this device, if any. */
  savedCalibrations: { strain: unknown; puff: unknown };
  segments: SegmentData[];
}

/** Lowercase, unambiguous characters for codes people may have to read out. */
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function randomCode(length: number, random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return out;
}

export function newParticipantCode(random?: () => number): string {
  return `pb-${randomCode(6, random)}`;
}

export function newSessionId(date: Date, random?: () => number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = date;
  return `s-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${randomCode(6, random)}`;
}

// --- Decoding ------------------------------------------------------------------

export interface DecodedFrame {
  /** Seconds since the segment start. */
  t: number;
  label: string;
  /** Seconds since the start of this frame's step (reaction time is at the start). */
  since: number;
  /** null when no face was found. */
  features: Record<string, number> | null;
}

/** Frames of a segment with their step label; landmarks only with decodeLandmarks(). */
export function decodeFrames(seg: SegmentData): DecodedFrame[] {
  const names = Object.keys(seg.features);
  const out: DecodedFrame[] = [];
  for (let i = 0; i < seg.frames; i++) {
    const step = seg.steps[seg.step[i]];
    let features: Record<string, number> | null = null;
    if (seg.face[i]) {
      features = {};
      for (const k of names) features[k] = seg.features[k][i];
    }
    out.push({ t: seg.t[i], label: step.label, since: seg.t[i] - step.start, features });
  }
  return out;
}

/** Absolute landmark coordinates: LANDMARK_COUNT × (x, y, z) per frame (zeros where no face). */
export function decodeLandmarks(seg: SegmentData): Float32Array {
  const bytes = base64ToBytes(seg.landmarks);
  const deltas = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const per = LANDMARK_COUNT * 3;
  const out = new Float32Array(deltas.length);
  const acc = new Int16Array(per);
  for (let i = 0; i < deltas.length; i++) {
    const j = i % per;
    acc[j] += deltas[i];
    out[i] = acc[j] / LANDMARK_SCALE;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  // Int16Array views need an even byte offset, so copy into a fresh buffer.
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// --- Validation ----------------------------------------------------------------

const MAX_FRAMES = 20000;
const MAX_COLUMNS = 100;

/** Checks an uploaded session's shape. Returns an error message, or null if it is valid. */
export function validateSession(data: unknown): string | null {
  if (!isObject(data)) return "not an object";
  if (data.schema !== SESSION_SCHEMA) return `schema must be ${SESSION_SCHEMA}`;
  if (typeof data.sessionId !== "string" || !SESSION_RE.test(data.sessionId)) return "bad sessionId";
  if (!isShortString(data.recordedAt)) return "bad recordedAt";
  if (!isObject(data.consent) || !isShortString(data.consent.version) || typeof data.consent.text !== "string" ||
    !isShortString(data.consent.agreedAt)) {
    return "missing consent";
  }
  const p = data.participant;
  if (!isObject(p) || typeof p.code !== "string" || !PARTICIPANT_RE.test(p.code)) return "bad participant code";
  for (const k of ["glasses", "facialHair", "lighting"]) if (!isShortString(p[k])) return `bad participant.${k}`;
  if (!isObject(data.device)) return "missing device";
  if (!Array.isArray(data.segments) || data.segments.length < 1 || data.segments.length > SEGMENT_NAMES.length) {
    return "bad segments";
  }
  for (const seg of data.segments) {
    const err = validateSegment(seg);
    if (err) return `segment: ${err}`;
  }
  return null;
}

function validateSegment(seg: unknown): string | null {
  if (!isObject(seg)) return "not an object";
  if (!SEGMENT_NAMES.includes(seg.name as SegmentName)) return "bad name";
  const n = seg.frames;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_FRAMES) return "bad frame count";
  if (!Array.isArray(seg.steps) || seg.steps.length < 1 || seg.steps.length > 200) return "bad steps";
  for (const s of seg.steps) {
    if (!isObject(s) || typeof s.start !== "number" || typeof s.seconds !== "number" || !isShortString(s.label)) {
      return "bad step";
    }
  }
  if (!isNumberArray(seg.t, n) || !isNumberArray(seg.face, n) || !isNumberArray(seg.box, 4 * n)) return "bad columns";
  if (!isNumberArray(seg.step, n) || !seg.step.every((i) => Number.isInteger(i) && i >= 0 && i < (seg.steps as unknown[]).length)) {
    return "bad step indices";
  }
  for (const key of ["features", "blendshapes"]) {
    const cols = seg[key];
    if (!isObject(cols) || Object.keys(cols).length > MAX_COLUMNS) return `bad ${key}`;
    for (const col of Object.values(cols)) if (!isNumberArray(col, n)) return `bad ${key} column`;
  }
  const bytes = n * LANDMARK_COUNT * 3 * 2;
  if (typeof seg.landmarks !== "string" || seg.landmarks.length !== Math.ceil(bytes / 3) * 4) return "bad landmarks";
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isShortString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 200;
}

function isNumberArray(v: unknown, length: number): v is number[] {
  return Array.isArray(v) && v.length === length && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

// --- Quality and index -----------------------------------------------------------

export interface SessionQuality {
  /** Fraction of frames with a face, over all segments. */
  faceCoverage: number;
  /** Detection frames per second, over all segments. */
  detectionRate: number;
  /** Every segment ran to the end of its script. */
  complete: boolean;
  /**
   * Mean (browDown + eyeSquint) / 2 on strain steps minus relaxed steps of the
   * strain segment, after the reaction time; null without a strain segment.
   * Low means the participant didn't really strain (or the face wasn't tracked).
   */
  strainMoves: number | null;
  /** Human-readable problems, empty when the session looks fine. */
  flags: string[];
}

const RELAXED_LABELS = ["neutral", "relax", "pulseRelax", "relax2"];
const REACTION_SECONDS = 0.6;

export function sessionQuality(s: Session): SessionQuality {
  let frames = 0;
  let faces = 0;
  let seconds = 0;
  let complete = true;
  let strainMoves: number | null = null;
  for (const seg of s.segments) {
    frames += seg.frames;
    faces += seg.face.reduce((a, b) => a + b, 0);
    const duration = seg.steps.reduce((a, st) => Math.max(a, st.start + st.seconds), 0);
    seconds += duration;
    if (seg.frames === 0 || seg.t[seg.frames - 1] < duration - 1) complete = false;
    if (seg.name === "strain") {
      const score = (f: Record<string, number>) => ((f.browDown ?? 0) + (f.eyeSquint ?? 0)) / 2;
      const strained: number[] = [];
      const relaxed: number[] = [];
      for (const f of decodeFrames(seg)) {
        if (!f.features || f.since < REACTION_SECONDS) continue;
        if (STRAIN_LABELS.includes(f.label)) strained.push(score(f.features));
        else if (RELAXED_LABELS.includes(f.label)) relaxed.push(score(f.features));
      }
      if (strained.length && relaxed.length) strainMoves = round(mean(strained) - mean(relaxed));
    }
  }
  const faceCoverage = frames ? faces / frames : 0;
  const detectionRate = seconds ? frames / seconds : 0;
  const flags: string[] = [];
  if (faceCoverage < 0.9) flags.push(`face found in only ${Math.round(faceCoverage * 100)}% of frames`);
  if (detectionRate < 10) flags.push(`only ${detectionRate.toFixed(1)} detections per second`);
  if (!complete) flags.push("a segment stopped early");
  if (strainMoves !== null && strainMoves < 0.1) flags.push("strain steps barely move brows and eyes");
  return { faceCoverage: round(faceCoverage), detectionRate: round(detectionRate), complete, strainMoves, flags };
}

function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** One row of the collector's index: everything needed to see coverage at a glance. */
export interface IndexRow {
  participant: string;
  sessionId: string;
  recordedAt: string;
  uploadedAt: string;
  bytes: number;
  profile: SessionProfile;
  device: { platform: string; mobile: boolean; camera: string; video: { width: number; height: number }; delegate: string };
  segments: { name: SegmentName; frames: number; seconds: number }[];
  quality: SessionQuality;
  /** Set by the team after looking at a session: "ok", "bad take" or a note. */
  review: string | null;
}

export function indexRow(s: Session, upload: { uploadedAt: string; bytes: number }): IndexRow {
  const d = s.device;
  return {
    participant: s.participant.code,
    sessionId: s.sessionId,
    recordedAt: s.recordedAt,
    uploadedAt: upload.uploadedAt,
    bytes: upload.bytes,
    profile: { glasses: s.participant.glasses, facialHair: s.participant.facialHair, lighting: s.participant.lighting },
    device: {
      platform: String(d.platform ?? ""), mobile: Boolean(d.mobile), camera: String(d.camera ?? ""),
      video: { width: Number(d.video?.width ?? 0), height: Number(d.video?.height ?? 0) }, delegate: String(d.delegate ?? ""),
    },
    segments: s.segments.map((seg) => ({
      name: seg.name, frames: seg.frames, seconds: seg.steps.reduce((a, st) => Math.max(a, st.start + st.seconds), 0),
    })),
    quality: sessionQuality(s),
    review: null,
  };
}
