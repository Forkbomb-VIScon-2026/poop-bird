// App glue: screens, input, the fixed-timestep game loop, face tracking,
// calibration (strain, and puff at the first dive), sound and the debug panel.

import "./style.css";
import calibPuffedUrl from "./assets/calib-puffed.jpg";
import calibStrainedUrl from "./assets/calib-strained.jpg";
import { config } from "./config";
import { Sound, type PoopSize } from "./audio";
import { DebugPanel } from "./debug";
import { DEBUG } from "./env";
import { FaceTracker, describeCameraError, type FaceBox, type FaceFrame } from "./face";
import { FaceRecognizer, alignedFaceCrop } from "./faceid";
import { BIRD_RADIUS, GROUND_Y, Game, VIEW_H, wireAt } from "./game";
import { buttonForKey, decorate, decorateAll, keyBlocked, keyName, pressFromKey } from "./keyhints";
import { Renderer, drawFrontPage, drawTrophyPrint, drawWeddingPrint, type Photo } from "./render";
import { StrainSnapshot, captureFace } from "./snapshot";
import {
  GROW_WITHIN,
  faceDistance,
  nextFaceId,
  parseFaces,
  recognize,
  serializeFaces,
  upsertFace,
  withDescriptors,
  type Descriptor,
  type KnownFace,
} from "./known-faces";
import { BOARD_KEEP, strainPercent, type RunStats } from "./leaderboard";
import { showBoards, submitRun } from "./leaderboard-view";
import {
  assessPuffCalibration,
  buildInteractivePuffCalibration,
  initialPuffState,
  stepKeyPuff,
  stepPuff,
} from "./puff";
import {
  CALIBRATION_KEY,
  PUFF_CALIBRATION_KEY,
  loadBest,
  loadGraphics,
  loadKnownFacesJson,
  loadSeenTutorials,
  saveBest,
  saveGraphics,
  saveKnownFacesJson,
  saveSeenTutorials,
  storageGet,
  storageRemove,
  storageSet,
  TUTORIALS,
  type Tutorial,
} from "./storage";
import {
  FEATURE_NAMES,
  PUFF_FEATURES,
  MAX_NEUTRAL_FALSE_RATE,
  STRAIN_FEATURES,
  assessCalibration,
  buildCalibration,
  defaultCalibration,
  featureStats,
  initialStrainState,
  robustFeatureStats,
  restoreCalibration,
  smoothStrain,
  stepStrain,
  strainedness,
  type Calibration,
  type FeatureName,
  type FeatureVector,
} from "./strain";

// --- DOM ----------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("game");
const video = $<HTMLVideoElement>("video");
const screens = {
  start: $("screen-start"),
  loading: $("screen-loading"),
  calibrate: $("screen-calibrate"),
  ready: $("screen-ready"),
  pause: $("screen-pause"),
  gameover: $("screen-gameover"),
  leaderboard: $("screen-leaderboard"),
};
const hud = $("hud");
const cam = $("cam");
/** Where #cam lives in the DOM when it isn't docked beside the bird on the perch. */
const camHome = { parent: cam.parentElement!, next: cam.nextElementSibling };
/** Where the coach lives when it isn't docked on the perch. */
const coachHome = { parent: $("coach").parentElement!, next: $("coach").nextElementSibling };
const rotateScreen = $("screen-rotate");

/** A phone or tablet: no hover, coarse pointer. Swaps key hints for touch wording (CSS `.touch`). */
const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
document.body.classList.toggle("touch", isTouch);

function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle("hidden", !visible);
}

function showScreen(name: keyof typeof screens | null): void {
  for (const [k, el] of Object.entries(screens)) show(el, k === name);
  dockCam(mode !== "face" ? null : name === "ready" ? "perch" : name === "calibrate" ? "calib" : null);
  dockCoach(name === "ready");
  // Game over gets longer: players often die mid-press, and shouldn't skip their score.
  armButtonKeys(name === "gameover" ? 800 : 300);
}

/** Enter / Space / R… press buttons only after this time, so a press from the previous screen can't. */
let buttonKeysArmedAt = 0;

function armButtonKeys(ms: number): void {
  buttonKeysArmedAt = performance.now() + ms;
}

// --- State ------------------------------------------------------------------------

type AppState =
  | "menu" | "loading" | "calibrating" | "ready" | "playing" | "paused" | "gameover";
type Mode = "face" | "keyboard";

let state: AppState = "menu";
let mode: Mode = "keyboard";

const renderer = new Renderer(canvas);
renderer.graphics = loadGraphics();
const game = new Game(renderer.resize());
const sound = new Sound();
const tracker = new FaceTracker(video);
const snapshot = new StrainSnapshot();
const debug = DEBUG
  ? new DebugPanel($("debug"), () => void recalibrate(), () => startOceanRun(), openDatasetRecorder, forgetCalibration)
  : null;
if (!DEBUG) document.querySelectorAll("[data-debug-only]").forEach((el) => el.remove());

let calibration: Calibration | null = loadCalibration(CALIBRATION_KEY, STRAIN_FEATURES);
/** `calibration` is a guess from the relaxed face ("Play anyway" after failed strains), not a fitted one. */
let calibrationIsDefault = false;
/** Puff calibration (neutral vs. full puff), on top of the fixed pucker range. null = the pucker range alone. */
let puffCalibration: Calibration | null = loadCalibration(PUFF_CALIBRATION_KEY, PUFF_FEATURES);
/** Flow token of the ocean tips in progress, if any. */
let activePuffCalibration: number | null = null;
/** Set to cut the ocean tips short. */
let abortPuffCalibration = false;
/** The coach (#coach) belongs to whoever claimed it last (claimCoach); older owners can't change or hide it. */
let coachOwner = 0;
/** The coach claim of the ocean tips in progress. */
let puffCoach = 0;
/** The coach claim of the perch. */
let perchCoach = 0;
/** Poops and accidents this run, for the city lesson. */
const lessonCount = { poops: 0, accidents: 0, lastAccident: -Infinity };
/** The last strain calibration that failed the quality check; used only if the player picks "Play anyway". */
let rejectedCalibration: Calibration | null = null;
/**
 * Bumped on every screen-flow transition. Async flows (camera startup,
 * calibration) capture it and bail out if it changed, so a stale
 * flow can never take over the screen.
 */
let flow = 0;
let strain = initialStrainState();
let puffSignal = initialPuffState();
/** Analog puff from Space / pointer (inflates while held, deflates otherwise). */
let keyPuff = 0;
let lastFace: FaceFrame | null = null;
/** How far the player's mouth is open, 0..1 (smoothed jawOpen); the bird's beak mirrors it. */
let mouthOpen = 0;
let lastFaceTime = 0;
let lastFaceSeen = 0;
let keyHeld = false;
/** Pointers (fingers, mouse) held down on the canvas. Any one of them holds. */
const heldPointers = new Set<number>();
let best = loadBest();
let currentSnapshotUrl: string | null = null;
/** The run on the game-over screen, as it would go to the leaderboard. null once submitted. */
let lastRun: { score: number; stats: RunStats; face: { url: string; strain: number } | null } | null = null;
/** Smoothed `strainedness` of the face (the finest-strain snapshot's and the leaderboard's measure). */
let faceStrain = 0;
/** Tutorials already shown (kept in memory too, so they show once per session even without storage). */
const seenTutorials = loadSeenTutorials();

sound.setMuted(storageGet("poopybird.muted.v1") === "1");

/** Space / pointer held. Counts only in keyboard mode: face mode is face-only. */
function manualHeld(): boolean {
  return mode === "keyboard" && (keyHeld || heldPointers.size > 0);
}

/** The single "is the player straining?" signal: the face in face mode, Space / pointer in keyboard mode. */
function straining(): boolean {
  return mode === "face" ? faceFresh() && strain.active : manualHeld();
}

/** Face puff 0..1 (0 in keyboard mode, or if the detector stalled). */
function facePuff(): number {
  return mode === "face" && faceFresh() ? puffSignal.smoothed : 0;
}

/** The single puff signal for the fish: max of face and key (only one is ever nonzero, see manualHeld()). */
function puffInput(): number {
  return Math.max(keyPuff, facePuff());
}

/** Face data counts only if the detector produced it recently. */
function faceFresh(): boolean {
  return performance.now() - lastFaceTime < 500;
}

function faceVisible(): boolean {
  return faceFresh() && strain.faceVisible;
}

// --- Face tracking ------------------------------------------------------------------

/** Samples collected during the current calibration phase. */
let calibSamples: { t: number; f: FeatureVector }[] | null = null;
/** Detection frames (with or without a face) during the current calibration phase. */
let calibFrames: number[] | null = null;

tracker.onFrame((frame) => {
  if (frame.newFace) onNewFace();
  const dt = lastFaceTime ? Math.min(0.25, (frame.time - lastFaceTime) / 1000) : 1 / 30;
  lastFaceTime = frame.time;
  lastFace = frame;
  if (frame.features) lastFaceSeen = frame.time;
  // Here, while the video still shows the frame these landmarks are from.
  if (wantFaceCrop && frame.landmarks && frame.box) {
    faceCrop = alignedFaceCrop(video, frame.landmarks, frame.box, config.faceIdMinFacePx);
    if (faceCrop) wantFaceCrop = false;
  }
  calibFrames?.push(frame.time);
  if (calibSamples && frame.features) calibSamples.push({ t: frame.time, f: frame.features });
  if (frame.features) readRelaxed(frame.features);
  strain = stepStrain(strain, frame.features, calibration, dt, config);
  puffSignal = stepPuff(puffSignal, frame.features, puffCalibration, dt, config, puffCalibration ?? calibration);
  if (debug) {
    // Debug panel toggle: outline the locked face and the crop detection runs on.
    placeCamBox($("cam-lock"), debug.showFaceLock ? frame.box : null);
    placeCamBox($("cam-crop"), debug.showFaceLock ? frame.crop : null);
  }
  faceStrain = frame.features ? smoothStrain(faceStrain, strainedness(frame.features), config.emaAlpha, dt) : 0;
  const jaw = frame.features ? (frame.blendshapes.jawOpen ?? 0) : 0;
  const open = Math.min(1, Math.max(0, (jaw - config.mouthOpenFrom) / Math.max(0.01, config.mouthOpenFull - config.mouthOpenFrom)));
  mouthOpen = smoothStrain(mouthOpen, open, config.mouthOpenAlpha, dt);
  // Only while the game counts it as straining: a laugh or a blink isn't a finest strain.
  if (state === "playing" && game.phase === "playing" && game.stage === "city" && strain.active) {
    snapshot.offer(video, frame.box, faceStrain);
  }
});

/**
 * The tracker locked onto a different face: drop the smoothed signals and
 * restart any calibration step that is collecting samples, so two people's
 * samples never mix.
 */
function onNewFace(): void {
  strain = initialStrainState();
  puffSignal = initialPuffState();
  newFaceLock();
  // The relaxed read and any hold so far were someone else's: start over (a known face skips it).
  if (state === "calibrating") void runCalibration();
  // On the perch, recognition decides (recognizeFace): a new face calibrates first.
}

// --- Face recognition: who's playing ----------------------------------------------------
// Calibrations belong to a face. When the tracker locks onto one, faceid.ts
// describes it and known-faces.ts looks it up among the faces this tab has
// calibrated (sessionStorage only). A known face gets its calibrations back:
// no relaxed-face read on the perch, no puff calibration at the dive. A new
// face calibrates like a first-time player and is remembered with its first
// calibration. Without face recognition (no WebGL, or it failed to load) a
// saved full calibration is used whoever plays, as before.

const recognizer = new FaceRecognizer();
/** The faces this tab has calibrated. */
let knownFaces: KnownFace[] = parseFaces(loadKnownFacesJson());
/** The locked face. */
const faceId = {
  /** Bumped whenever the tracker locks onto a face that may be someone else. */
  lock: 0,
  /**
   * idle: not recognized, and recognition isn't running; known: `known` is them;
   * new: nobody this tab knows (`descriptors` are enrolled with their first calibration);
   * off: no face recognition here.
   */
  status: "idle" as "idle" | "running" | "known" | "new" | "off",
  known: null as KnownFace | null,
  descriptors: [] as Descriptor[],
  /** The match's descriptor distance (debug). */
  distance: Infinity,
  /** Calibrations made for this face since the lock, remembered with it (rememberFace). */
  strain: null as { cal: Calibration; isDefault: boolean } | null,
  puff: null as Calibration | null,
};
/**
 * Set by recognizeFace: the tracker callback aligns the next good view of the
 * locked face into `faceCrop` (there, the video frame matches the landmarks).
 */
let wantFaceCrop = false;
let faceCrop: HTMLCanvasElement | null = null;

/** Whether face recognition can tell players apart here (it's loading, or loaded). */
function faceIdWorks(): boolean {
  return recognizer.status !== "failed";
}

/** Forgets who the locked face is (nothing about it is remembered until it's recognized again). */
function resetFaceId(): void {
  faceId.lock++;
  faceId.status = "idle";
  faceId.known = null;
  faceId.descriptors = [];
  faceId.distance = Infinity;
  faceId.strain = null;
  faceId.puff = null;
  wantFaceCrop = false;
  faceCrop = null;
  // A failed fit was the previous face's: "Play anyway" mustn't hand it to this one.
  rejectedCalibration = null;
}

/** The tracker locked onto a face that may be someone else: recognize it. */
function newFaceLock(): void {
  resetFaceId();
  void recognizeFace();
}

/**
 * Takes faceIdSamples descriptors of the locked face and looks them up among
 * the known faces. Gives up quietly (status back to idle) if the face changes
 * or face mode ends before that.
 */
async function recognizeFace(): Promise<void> {
  if (faceId.status !== "idle" || mode !== "face") return;
  const lock = faceId.lock;
  faceId.status = "running";
  const ok = await recognizer.load();
  if (faceId.lock !== lock) return;
  if (!ok) {
    faceId.status = "off";
    return;
  }
  const stale = (): boolean => {
    if (faceId.lock === lock && mode === "face" && tracker.ready) return false;
    if (faceId.lock === lock) {
      faceId.status = "idle";
      wantFaceCrop = false;
    }
    return true;
  };
  const samples: Descriptor[] = [];
  while (samples.length < Math.max(1, Math.round(config.faceIdSamples))) {
    if (samples.length) await wait(config.faceIdSpacing * 1000);
    if (stale()) return;
    faceCrop = null;
    wantFaceCrop = true;
    while (!faceCrop) {
      await wait(50);
      if (stale()) return;
    }
    const crop = faceCrop;
    faceCrop = null;
    const d = await recognizer.describe(crop);
    if (stale()) return;
    if (d) samples.push(d);
  }

  const match = recognize(samples, knownFaces, config.faceIdSameDistance);
  console.info(`[faceid] ${match ? `known face #${match.face.id}` : "new face"}`, {
    distances: Object.fromEntries(knownFaces.map((f) => [f.id, +faceDistance(samples, f).toFixed(3)])),
    ms: Math.round(recognizer.lastMs),
  });
  if (match) {
    faceId.status = "known";
    faceId.distance = match.distance;
    faceId.known = withDescriptors(match.face, samples, config.faceIdSameDistance * GROW_WITHIN);
    adoptKnownFace(faceId.known);
  } else {
    faceId.status = "new";
    faceId.descriptors = samples;
    // Someone new took over (mid-run, say): the puff calibration is someone else's. Pursed lips until they calibrate.
    if (!faceId.puff && puffCalibration) {
      puffCalibration = null;
      puffSignal = initialPuffState();
    }
  }
  rememberFace();
  // Someone not calibrated here sat down at the perch: calibrate them first. (Mid-run
  // the run goes on; the next one starts with the calibration, see startFaceMode.)
  if (state === "ready" && mode === "face" && !faceCalibrated()) void runCalibration(false);
}

/**
 * The locked face is one this tab calibrated: their calibrations come back.
 * One made since the lock is newer and stays, except that a full strain
 * calibration beats a default one.
 */
function adoptKnownFace(face: KnownFace): void {
  let adopted = false;
  if (face.strain && (!faceId.strain || (faceId.strain.isDefault && !face.strainIsDefault))) {
    calibration = face.strain;
    calibrationIsDefault = face.strainIsDefault;
    rejectedCalibration = null;
    strain = initialStrainState();
    faceId.strain = null;
    adopted = true;
  }
  if (face.puff && !faceId.puff) {
    puffCalibration = face.puff;
    puffSignal = initialPuffState();
    adopted = true;
  } else if (!face.puff && !faceId.puff && puffCalibration) {
    // They skipped the puff: pursed lips alone, not whoever's puff was active.
    puffCalibration = null;
    puffSignal = initialPuffState();
  }
  if (adopted) showToast("👋 Welcome back! You're still calibrated", 2500);
}

/** Saves the calibrations made for the locked face with it, enrolling a new face with its first one. */
function rememberFace(): void {
  if (faceId.status === "new" && (faceId.strain || faceId.puff)) {
    const blank: KnownFace = { id: nextFaceId(knownFaces), descriptors: [], strain: null, strainIsDefault: false, puff: null, lastSeen: 0 };
    faceId.known = withDescriptors(blank, faceId.descriptors);
    faceId.status = "known";
  }
  if (faceId.status !== "known" || !faceId.known) return;
  const f = faceId.known;
  faceId.known = {
    ...f,
    strain: faceId.strain?.cal ?? f.strain,
    strainIsDefault: faceId.strain ? faceId.strain.isDefault : f.strainIsDefault,
    puff: faceId.puff ?? f.puff,
    lastSeen: Date.now(),
  };
  knownFaces = upsertFace(knownFaces, faceId.known);
  saveKnownFacesJson(serializeFaces(knownFaces));
  updateFacesSetting();
}

/** A strain calibration was made for the locked face. */
function rememberStrain(cal: Calibration, isDefault: boolean): void {
  faceId.strain = { cal, isDefault };
  rememberFace();
}

/** A puff calibration was made for the locked face. */
function rememberPuff(cal: Calibration): void {
  faceId.puff = cal;
  rememberFace();
}

/** Settings → Forget faces: every known face goes, including the locked one's. */
function forgetFaces(): void {
  const n = knownFaces.length;
  knownFaces = [];
  saveKnownFacesJson(null);
  resetFaceId();
  updateFacesSetting();
  console.info(`[faceid] forgot ${n} face${n === 1 ? "" : "s"}`);
}

/** The settings' face line: how many faces this tab remembers. */
function updateFacesSetting(): void {
  const n = knownFaces.length;
  $("faces-count").textContent = n ? `${n} face${n === 1 ? "" : "s"} remembered in this tab.` : "No faces remembered.";
  $<HTMLButtonElement>("btn-forget-faces").disabled = n === 0;
}

/**
 * Positions an overlay over the webcam preview at a normalized video box,
 * matching the preview's mirroring and object-fit: cover cropping.
 */
function placeCamBox(el: HTMLElement, box: FaceBox | null): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  show(el, box !== null && vw > 0 && vh > 0);
  if (!box || !vw || !vh) return;
  const wrap = el.parentElement!;
  const scale = Math.max(wrap.clientWidth / vw, wrap.clientHeight / vh);
  const offX = (wrap.clientWidth - vw * scale) / 2;
  const offY = (wrap.clientHeight - vh * scale) / 2;
  el.style.left = `${offX + (1 - box.x - box.w) * vw * scale}px`;
  el.style.top = `${offY + box.y * vh * scale}px`;
  el.style.width = `${box.w * vw * scale}px`;
  el.style.height = `${box.h * vh * scale}px`;
}

/** N: lock onto another face in view (when the wrong one got picked). */
async function switchFace(): Promise<void> {
  if (mode !== "face" || !tracker.ready) return;
  const found = await tracker.switchFace();
  showToast(found ? "🔄 Tracking another face" : "Only one face in view", 1500);
}

/** Debug: opens the face dataset recorder (collect.html) in a new tab, pausing a running game. */
function openDatasetRecorder(): void {
  if (state === "playing") togglePause();
  window.open(`${import.meta.env.BASE_URL}collect.html`, "_blank");
}

function updateStrainBars(): void {
  const value = faceFresh() ? strain.smoothed : 0;
  const active = straining();
  const fill = $("cam-strain-fill");
  fill.style.width = `${value * 100}%`;
  fill.classList.toggle("active", active);
  $("cam-strain-on").style.left = `${config.strainOn * 100}%`;
  $("cam-strain-off").style.left = `${config.strainOff * 100}%`;
  // Short grace period so a single dropped frame doesn't flash the warning.
  const lost = mode === "face" && tracker.ready && performance.now() - lastFaceSeen > 300;
  show($("cam-noface"), lost);
  if (state === "ready" && mode === "face") updateGauge(value, active);
}

/** The perch's upright strain gauge beside the webcam: fills with the face's strain, 💩 line = strainOn. */
function updateGauge(value: number, active: boolean): void {
  const fill = $("gauge-fill");
  fill.style.height = `${Math.min(1, value) * 100}%`;
  fill.classList.toggle("active", active);
  $("gauge-line").style.bottom = `${config.strainOn * 100}%`;
  const gauge = fill.closest(".gauge")!;
  gauge.classList.toggle("strained", active);
  gauge.classList.toggle("relaxed", !active && value < config.strainOff);
}

async function startFaceMode(forceCalibrate = false): Promise<void> {
  const token = ++flow;
  sound.unlock();
  mode = "face";
  // A camera that wasn't on yet locks onto a face that may be anyone.
  const freshCamera = !tracker.ready;
  if (!tracker.ready) {
    state = "loading";
    showScreen("loading");
    show(hud, false);
    $("loading-title").textContent = "Warming up…";
    $("loading-text").textContent = "Allow camera access when your browser asks. Loading the face tracker…";
    show($("loading-spinner"), true);
    show($("loading-error"), false);
    try {
      // Ask for the camera first so the permission prompt appears right away.
      await tracker.startCamera();
      if (token !== flow) return releaseCameraIfUnused();
      $("loading-text").textContent = "Camera on! Loading the face tracker…";
      await tracker.loadModel();
      if (token !== flow) return releaseCameraIfUnused();
    } catch (err) {
      console.error(err);
      tracker.stopCamera();
      if (token !== flow) return;
      $("loading-title").textContent = "No face tracking 😢";
      $("loading-error-text").textContent = `${describeCameraError(err)} You can still play with the keyboard.`;
      show($("loading-spinner"), false);
      show($("loading-error"), true);
      mode = "keyboard";
      return;
    }
  }
  tracker.start();
  if (freshCamera) newFaceLock();
  else void recognizeFace();
  show(cam, true);
  // A calibrated face goes straight to the perch; anyone else (or still being recognized)
  // gets the calibration screen, which lets a face that turns out to be known through.
  // Without face recognition a saved calibration is used, whoever plays.
  if (!forceCalibrate && (faceCalibrated() || (!faceIdWorks() && calibration && !calibrationIsDefault))) startReady();
  else await runCalibration(forceCalibrate);
}

function startKeyboardMode(): void {
  sound.unlock();
  mode = "keyboard";
  tracker.stopCamera();
  show(cam, false);
  startReady();
}

/** A face-mode startup finished after the player moved on: turn the camera back off. */
function releaseCameraIfUnused(): void {
  if (mode !== "face" || state === "menu") tracker.stopCamera();
}

async function recalibrate(): Promise<void> {
  if (state === "loading" || state === "calibrating") return;
  await startFaceMode(true);
}

// --- Calibration ---------------------------------------------------------------------

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The calibration screen: before the first run of a face this tab doesn't
// know, the player strains once and puffs once, each started with a button,
// with an example photo next to their webcam. The relaxed face is never asked
// for: it's read in the background from the moment a face shows, while the
// player reads the screen. Nothing else in the game calibrates.

/** What the calibration screen is doing, and its relaxed-face read. */
const calib = {
  /** Read the relaxed face from the tracker: only during the welcome, before any example face shows. */
  relaxing: false,
  relaxed: [] as FeatureVector[],
  /** The button was pressed (cleared when a phase starts waiting for it). */
  pressed: false,
  skipped: false,
  /** The player chose to recalibrate: a known face doesn't skip it. */
  forced: false,
};

/** Relaxed-face samples kept (the newest): ~10 s of a 30 fps tracker. */
const RELAXED_KEEP = 300;
/** Fewest relaxed-face samples a calibration needs. */
const MIN_RELAXED_SAMPLES = 20;
/** The welcome lasts at least this long with a face in view (the relaxed read). */
const WELCOME_MS = 2000;
/** Longest the welcome waits for recognition to decide, once the relaxed read is done. */
const WELCOME_RECOGNITION_MS = 4000;
/** Failed tries of a phase before "Play anyway" shows. */
const TRIES_BEFORE_SKIP = 2;

const examples = { strain: calibStrainedUrl, puff: calibPuffedUrl };

/** Called by the tracker with each face frame: the relaxed-face read. */
function readRelaxed(features: FeatureVector): void {
  if (!calib.relaxing || state !== "calibrating") return;
  calib.relaxed.push(features);
  if (calib.relaxed.length > RELAXED_KEEP) calib.relaxed.splice(0, calib.relaxed.length - RELAXED_KEEP);
}

/**
 * The face has been through the calibration screen here: a known face, or
 * (without face recognition) a saved calibration. A phase they skipped stays
 * skipped; Recalibrate redoes both.
 */
function faceCalibrated(): boolean {
  if (faceId.status === "known" && faceId.known) return !!faceId.known.strain;
  return faceId.status === "off" && !!calibration;
}

/**
 * The calibration screen. `forced`: the player asked to recalibrate (a known
 * face doesn't skip it). Ends on the perch, or abandoned when the flow moves on.
 */
async function runCalibration(forced = calib.forced): Promise<void> {
  const token = ++flow;
  calib.forced = forced;
  state = "calibrating";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  calib.relaxed = [];
  rejectedCalibration = null;
  strain = initialStrainState();
  // Both get redone: nothing of the last player's may carry over (Play anyway on the puff means none).
  puffCalibration = null;
  puffSignal = initialPuffState();
  if (!(await welcome(token))) return;
  const strained = await calibrateStrain(token);
  const puffed = strained === null ? null : await calibratePuff(token);
  if (token === flow) calib.relaxing = false;
  if (token !== flow || strained === null || puffed === null) return;
  strain = initialStrainState();
  puffSignal = initialPuffState();
  startReady();
  showToast(strained && puffed ? "All set! 💪 The bird and the fish know your face now" : "Let's go! Recalibrate (C) any time", 3500);
}

/**
 * The screen opens with a welcome and no example face, so nobody practises a
 * face yet: the relaxed face is read meanwhile (WELCOME_MS of a face in view)
 * and then kept as it is, and recognition gets a moment to decide (a known
 * face goes on to the perch). false = abandoned, or the face was known.
 */
async function welcome(token: number): Promise<boolean> {
  $("calib-step").textContent = "Calibration";
  $("calib-prompt").textContent = "Hi! 👋 Let's get the game to know your face";
  $("calib-hint").textContent = "Just look at the camera for a moment…";
  screens.calibrate.classList.add("welcome");
  show($("calib-buttons"), false);
  show($("calib-run"), true);
  $("calib-count").textContent = "";
  const progress = $("calib-progress");
  progress.style.width = "0%";
  calibStatus("", "");
  calib.relaxing = true;
  let faceFor = 0;
  let doneAt = -1;
  let last = performance.now();
  try {
    for (; ;) {
      await wait(50);
      if (token !== flow) return false;
      const now = performance.now();
      if (faceVisible()) faceFor += now - last;
      last = now;
      if (!calib.forced && faceCalibrated()) {
        calib.relaxing = false;
        startReady();
        showToast("👋 Welcome back! You're still calibrated", 2500);
        return false;
      }
      const read = Math.min(faceFor / WELCOME_MS, calib.relaxed.length / MIN_RELAXED_SAMPLES, 1);
      progress.style.width = `${read * 100}%`;
      if (read < 1) {
        calibStatus(faceVisible() ? "" : "Looking for your face… 👀", "");
        continue;
      }
      calib.relaxing = false;
      if (doneAt < 0) doneAt = now;
      const deciding = faceId.status === "running" || faceId.status === "idle";
      if (!calib.forced && deciding && faceIdWorks() && now - doneAt < WELCOME_RECOGNITION_MS) {
        calibStatus("Have we met? Checking… 🤔", "");
        continue;
      }
      return true;
    }
  } finally {
    calib.relaxing = false;
    screens.calibrate.classList.remove("welcome");
  }
}

/** The strain phase, until a good calibration (true) or "Play anyway" (false). null = abandoned (or skipped by recognition). */
async function calibrateStrain(token: number): Promise<boolean | null> {
  for (let tries = 0; ; tries++) {
    const go = await calibrationIntro(token, "strain", tries);
    if (!go) return null;
    if (go === "skip") {
      // Play anyway: the closest thing to their strain we have (else a guess from the relaxed face).
      const neutral = robustFeatureStats(calib.relaxed);
      calibration = rejectedCalibration ?? defaultCalibration(neutral, config.defaultStrainScale);
      calibrationIsDefault = true;
      rememberStrain(calibration, true);
      return false;
    }
    const held = await holdFace(token, "strain");
    if (!held) return null;
    const neutral = [...calib.relaxed];
    const cal = buildCalibration(robustFeatureStats(neutral), featureStats(held.samples), config);
    const quality = assessCalibration(cal, neutral, held.samples, config, { neutral: 1, strain: held.coverage });
    console.info("[calibration] strain", { cal, quality, relaxed: neutral.length, strained: held.samples.length });
    if (quality.ok) {
      calibration = cal;
      calibrationIsDefault = false;
      rejectedCalibration = null;
      saveCalibration(CALIBRATION_KEY, cal);
      rememberStrain(cal, false);
      return true;
    }
    if (quality.totalChange > 0) rejectedCalibration = cal;
    calibStatus(strainRetryReason(quality), "bad");
  }
}

/** The puff phase: a hold, then "let it out". Like calibrateStrain. */
async function calibratePuff(token: number): Promise<boolean | null> {
  for (let tries = 0; ; tries++) {
    const go = await calibrationIntro(token, "puff", tries);
    if (!go) return null;
    // Play anyway: pursed lips alone (the pucker range) drive the fish.
    if (go === "skip") {
      puffCalibration = null;
      storageRemove(PUFF_CALIBRATION_KEY);
      puffSignal = initialPuffState();
      // Also for the face, so recognition doesn't bring back the one they just skipped.
      faceId.puff = null;
      if (faceId.known) {
        faceId.known = { ...faceId.known, puff: null };
        rememberFace();
      }
      return false;
    }
    const held = await holdFace(token, "puff");
    if (!held) return null;
    const after = await letOut(token);
    if (!after) return null;
    const relaxed = [...calib.relaxed, ...after];
    const cal = buildInteractivePuffCalibration(relaxed, held.samples, config);
    const quality = cal
      ? assessPuffCalibration(cal, held.samples, { strain: held.coverage }, { ...config, minSinkRate: config.oceanPuffMinSinkRate }, relaxed)
      : null;
    console.info("[calibration] puff", { cal, quality, relaxed: relaxed.length, puffs: held.samples.length });
    if (cal && quality?.ok) {
      puffCalibration = cal;
      saveCalibration(PUFF_CALIBRATION_KEY, cal);
      rememberPuff(cal);
      return true;
    }
    calibStatus(puffRetryReason(quality?.reason), "bad");
  }
}

function strainRetryReason(q: ReturnType<typeof assessCalibration>): string {
  if (q.reason?.startsWith("I couldn't see")) return "I couldn't see your face well. Face the camera, in good light.";
  if (q.totalChange < config.minCalibrationChange) return "That looked a lot like your normal face. Strain harder! Scrunch up everything.";
  if (q.strainHitRate < 0.6) return "Hold the strain for the whole bar, then try again.";
  if (q.neutralFalseRate > MAX_NEUTRAL_FALSE_RATE) return "Your strain looked too much like your normal face. Strain much harder!";
  return q.reason ?? "That didn't work. Try again!";
}

function puffRetryReason(reason: string | undefined): string {
  switch (reason) {
    case "puff looked like your relaxed face": return "That looked like your normal face. Fill your cheeks with air and purse your lips!";
    case "puff wasn't held steadily": return "Keep the cheeks puffed for the whole bar, then try again.";
    case "your face didn't relax between puffs": return "Let all the air out after the puff, lips loose.";
    case "couldn't see your face": return "I couldn't see your face well. Face the camera, in good light.";
    default: return "That didn't work. Try again!";
  }
}

const CALIB_TEXT = {
  strain: {
    step: "Calibration 1/2: poop face",
    prompt: "Strain like you really need to go 💩",
    hint: "Brows down, eyes squeezed, lips pressed. You'll hold it for 3 seconds.",
  },
  puff: {
    step: "Calibration 2/2: pufferfish face",
    prompt: "Puff your cheeks like a pufferfish 🐡",
    hint: "Cheeks full of air, lips pursed. Hold it, then let the air out.",
  },
};

/**
 * Shows a phase's instructions and waits for the button. "go" once pressed
 * with a face in view;
 * "skip" for Play anyway; null = abandoned, or the face turned out to be
 * calibrated already (then it's on the perch).
 */
async function calibrationIntro(token: number, phase: "strain" | "puff", tries: number): Promise<"go" | "skip" | null> {
  const text = CALIB_TEXT[phase];
  $("calib-step").textContent = text.step;
  $("calib-prompt").textContent = text.prompt;
  $("calib-hint").textContent = text.hint;
  $<HTMLImageElement>("calib-example").src = examples[phase];
  screens.calibrate.querySelector(".calib")!.classList.remove("holding");
  show($("calib-run"), false);
  const go = $<HTMLButtonElement>("btn-calib-go");
  go.textContent = tries ? "Try again" : "I'm ready";
  decorate(go);
  show($("calib-buttons"), true);
  show($("btn-calib-skip"), tries >= TRIES_BEFORE_SKIP);
  if (!tries) calibStatus("", "");
  armButtonKeys(300);
  calib.pressed = calib.skipped = false;
  for (; ;) {
    await wait(50);
    if (token !== flow) return null;
    // A face this tab knows (recognized late, while they read this): straight to the perch.
    if (!calib.forced && phase === "strain" && !tries && faceCalibrated()) {
      startReady();
      showToast("👋 Welcome back! You're still calibrated", 2500);
      return null;
    }
    if (calib.skipped) return "skip";
    if (!tries) calibStatus(faceVisible() ? "" : "Looking for your face… 👀", "");
    if (calib.pressed && faceVisible()) return "go";
    if (calib.pressed && !faceVisible()) calibStatus("I can't see you. Face the camera, then press again.", "bad");
    if (!faceVisible()) calib.pressed = false;
  }
}

/** The calibration screen's status line (`kind`: "bad" for a failed try, "" for news). */
function calibStatus(text: string, kind: "" | "bad"): void {
  const el = $("calib-status");
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle("bad", kind === "bad");
}

/**
 * "3, 2, 1", then holds the phase's face while it's sampled (calibrationSeconds
 * for the strain, oceanCalibrationSeconds for the puff; the first
 * calibrationSettle s don't count). null = abandoned.
 */
async function holdFace(token: number, phase: "strain" | "puff"): Promise<{ samples: FeatureVector[]; coverage: number } | null> {
  show($("calib-buttons"), false);
  calibStatus("", "");
  show($("calib-run"), true);
  const card = screens.calibrate.querySelector(".calib")!;
  const count = $("calib-count");
  const progress = $("calib-progress");
  progress.style.width = "0%";
  $("calib-prompt").textContent = phase === "strain" ? "Get ready to strain…" : "Get ready to puff…";
  for (let i = 3; i > 0; i--) {
    count.textContent = String(i);
    await wait(800);
    if (token !== flow) return null;
  }
  $("calib-prompt").textContent = phase === "strain" ? "STRAIN! Hold it! 💩" : "PUFF! Hold it! 🐡";
  card.classList.add("holding");
  const total = (phase === "strain" ? config.calibrationSeconds : config.oceanCalibrationSeconds) * 1000;
  const settle = config.calibrationSettle * 1000;
  const start = performance.now();
  const mine = startSampling();
  try {
    for (; ;) {
      if (token !== flow) return null;
      const elapsed = performance.now() - start;
      if (elapsed >= total) break;
      count.textContent = String(Math.ceil((total - elapsed) / 1000));
      progress.style.width = `${(elapsed / total) * 100}%`;
      if (phase === "strain") sound.setGroan(Math.min(1, elapsed / total), false);
      else sound.setBurble(elapsed / total);
      await wait(50);
    }
  } finally {
    sound.setGroan(-1, false);
    sound.setBurble(-1);
    card.classList.remove("holding");
    stopSampling(mine.samples);
  }
  progress.style.width = "100%";
  count.textContent = "✓";
  const samples = mine.samples.filter((x) => x.t - start >= settle).map((x) => x.f);
  const frames = mine.frames.filter((t) => t - start >= settle).length;
  return { samples, coverage: frames > 0 ? samples.length / frames : 0 };
}

/**
 * After the puff: "let it out" for oceanLessonLetOutSeconds, sampled as the
 * relaxed face right after a puff, which isn't the one from before (the
 * mouth stays narrower, the lips pressed): the fit needs it, or the fish
 * won't sink (see buildInteractivePuffCalibration). null = abandoned.
 */
async function letOut(token: number): Promise<FeatureVector[] | null> {
  $("calib-prompt").textContent = "And let it out 😮‍💨";
  $("calib-progress").style.width = "0%";
  const total = config.oceanLessonLetOutSeconds * 1000;
  const start = performance.now();
  const mine = startSampling();
  try {
    for (; ;) {
      if (token !== flow) return null;
      const elapsed = performance.now() - start;
      if (elapsed >= total) break;
      $("calib-count").textContent = "";
      $("calib-progress").style.width = `${(elapsed / total) * 100}%`;
      await wait(50);
    }
  } finally {
    stopSampling(mine.samples);
  }
  // The first moment is still the air going out.
  return mine.samples.filter((x) => x.t - start >= config.calibrationSettle * 1000).map((x) => x.f);
}

/** Starts collecting face samples into fresh shared arrays (filled by the tracker callback). */
function startSampling(): { samples: { t: number; f: FeatureVector }[]; frames: number[] } {
  const mine = { samples: [] as { t: number; f: FeatureVector }[], frames: [] as number[] };
  calibSamples = mine.samples;
  calibFrames = mine.frames;
  return mine;
}

/**
 * Stops collecting into `samples`, unless a newer sampling run has already
 * replaced them (an abandoned run must not cut off the one that replaced it).
 */
function stopSampling(samples: readonly unknown[] | null): void {
  if (samples && calibSamples !== samples) return;
  calibSamples = null;
  calibFrames = null;
}

const FEATURE_LABELS: Record<FeatureName, string> = {
  browDown: "brows",
  eyeSquint: "eye squint",
  eyeBlink: "eyes shut",
  noseSneer: "nose wrinkle",
  cheekSquint: "cheeks",
  mouthPress: "pressed lips",
  mouthRollLower: "rolled lower lip",
  mouthRollUpper: "rolled upper lip",
  mouthShrugUpper: "upper lip shrug",
  mouthShrugLower: "chin shrug",
  cheekPuff: "cheek puff",
  mouthPucker: "pucker",
  mouthFunnel: "funnel lips",
  cheekWidth: "cheek width",
  mouthWidth: "mouth width",
  eyeMouth: "eye–mouth distance",
};

/** Labels of the (up to 3) features a calibration weights most. */
function topFeatureLabels(cal: Calibration): string[] {
  return FEATURE_NAMES.filter((f) => cal.weights[f] > 0)
    .sort((a, b) => cal.weights[b] - cal.weights[a])
    .slice(0, 3)
    .map((f) => FEATURE_LABELS[f]);
}

function saveCalibration(key: string, cal: Calibration): void {
  storageSet(key, JSON.stringify(cal));
}

/** Calibrations saved before the puff features existed still load (see restoreCalibration). */
function loadCalibration(key: string, required: readonly FeatureName[]): Calibration | null {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    return restoreCalibration(JSON.parse(raw), required);
  } catch {
    return null;
  }
}

/** Debug: delete both saved calibrations and the known faces, and reload, to test the first-time flow. */
function forgetCalibration(): void {
  storageRemove(CALIBRATION_KEY);
  storageRemove(PUFF_CALIBRATION_KEY);
  saveKnownFacesJson(null);
  location.reload();
}

// --- Ocean tips --------------------------------------------------------------------

/** The ocean tips for new players, as banners over the calm water, after `intro` if given. */
async function oceanTipBanners(token: number, intro?: [string, string]): Promise<boolean> {
  const tips: [string, string][] = [
    ...(intro ? [intro] : []),
    ["Spikes! 🐡", "Puff past the red line to spike out. Hold it too long and you pop"],
  ];
  for (const [title, hint] of tips) {
    setPuffOverlay(title, hint, null, true);
    if (!(await waitPlaying(token, 4500))) return false;
  }
  return true;
}

/** Waits `ms` of playing time (pauses don't count). false = abandoned. */
async function waitPlaying(token: number, ms: number): Promise<boolean> {
  let left = ms;
  let last = performance.now();
  while (left > 0) {
    if (token !== flow || abortPuffCalibration) {
      abortPuffCalibration = false;
      return false;
    }
    const now = performance.now();
    if (state === "playing") left -= now - last;
    last = now;
    await wait(50);
  }
  return true;
}

/** The lesson's coach line: a title, a hint and the face to make (null: no pictogram). `tips`: no progress bar, bigger hint. */
function setPuffOverlay(title: string, hint: string, face: "relaxed" | "puffed" | null, tips = false): void {
  coachSay(puffCoach, { title, hint, face, bar: !tips, tips });
}

/** Hides the lesson's coach if `token`'s lesson still owns it. */
function endPuffCalibrationOverlay(token: number): void {
  if (activePuffCalibration !== token) return;
  activePuffCalibration = null;
  releaseCoach(puffCoach);
  sound.setBurble(-1);
}

// --- Coach (the tutorial banner) ---------------------------------------------------------

type CoachFace = "relaxed" | "strained" | "puffed";

interface CoachLine {
  title: string;
  hint?: string;
  /** The face to make (null: no pictogram). */
  face?: CoachFace | null;
  /** The puff calibration's step progress bar. */
  bar?: boolean;
  /** The ocean tips: no bar, bigger hint. */
  tips?: boolean;
  /** Just done: the title turns green. */
  done?: boolean;
  /** Where the player is in the flight lesson: [current step, steps]. */
  dots?: readonly [number, number] | null;
}

/** Takes the coach over (hiding whatever an older owner showed) and returns the claim for coachSay. */
function claimCoach(): number {
  coachHide();
  return ++coachOwner;
}

/** Hides the coach if `owner` still has it. */
function releaseCoach(owner: number): void {
  if (owner === coachOwner) coachHide();
}

function coachHide(): void {
  show($("coach"), false);
}

/** Shows `line` on the coach, if `owner` still has it. Cheap to call every frame. */
function coachSay(owner: number, line: CoachLine): void {
  if (owner !== coachOwner) return;
  const el = $("coach");
  const title = $("coach-title");
  if (title.textContent !== line.title) {
    title.textContent = line.title;
    // A new line wobbles in.
    title.classList.remove("wobble");
    void title.offsetWidth;
    title.classList.add("wobble");
  }
  const hint = $("coach-hint");
  if (hint.textContent !== (line.hint ?? "")) hint.textContent = line.hint ?? "";
  const face = line.face ?? null;
  const pictogram = $("coach-face");
  if (face) $("coach-face-use").setAttribute("href", `#face-${face}`);
  pictogram.classList.toggle("puffing", face === "puffed");
  show(pictogram, face !== null);
  show($("coach-bar"), !!line.bar);
  el.classList.toggle("tips", !!line.tips);
  el.classList.toggle("done", !!line.done);
  const dots = $("coach-dots");
  const key = line.dots ? line.dots.join("/") : "";
  if (dots.dataset.key !== key) {
    dots.dataset.key = key;
    const [now, total] = line.dots ?? [0, 0];
    dots.replaceChildren(
      ...Array.from({ length: total }, (_, i) => {
        const li = document.createElement("li");
        li.className = i < now ? "done" : i === now ? "now" : "";
        return li;
      }),
    );
  }
  show(dots, !!line.dots);
  show(el, true);
}

/** Moves the coach beside the bird on the perch, or back over the game. Leaving the perch hides the perch's line. */
function dockCoach(perched: boolean): void {
  const el = $("coach");
  if (perched === el.classList.contains("docked")) return;
  el.classList.toggle("docked", perched);
  if (perched) $("perch-coach-slot").append(el);
  else {
    coachHome.parent.insertBefore(el, coachHome.next);
    releaseCoach(perchCoach);
  }
}

// --- Tutorials (new-player tips) ---------------------------------------------------------

/** "I'm new here" in the menu: some tutorial hasn't been shown yet. */
function isNewPlayer(): boolean {
  return TUTORIALS.some((t) => !seenTutorials.has(t));
}

/** The menu toggle: on shows every tutorial again, off skips them all. */
function setNewPlayer(isNew: boolean): void {
  seenTutorials.clear();
  if (!isNew) for (const t of TUTORIALS) seenTutorials.add(t);
  saveSeenTutorials(seenTutorials);
}

function markTutorialSeen(t: Tutorial): void {
  seenTutorials.add(t);
  saveSeenTutorials(seenTutorials);
}

/**
 * The bird just turned into a deflated fish. A new player gets the ocean tips
 * as banners over calm water; everyone else swims right into the level. (The
 * puff was calibrated before the run, on the calibration screen.)
 */
function onSubmerged(): void {
  if (!seenTutorials.has("ocean")) void runOceanTips();
  else showToast(mode === "face" ? "Puff your cheeks to float 🐡" : isTouch ? "Hold the screen to puff up 🐡" : "Hold SPACE to puff up 🐡");
}

/**
 * A new player's first dive: the fish swims on in calm water (see
 * Game.calmWater) under banners on how to puff and the ocean tips, then the
 * level starts. Belongs to the run's flow token.
 */
async function runOceanTips(): Promise<void> {
  const token = flow;
  activePuffCalibration = token;
  puffCoach = claimCoach();
  abortPuffCalibration = false;
  game.calmWater = true;
  while (game.transition && token === flow) await wait(50);
  const hold = isTouch ? "Hold the screen" : "Hold SPACE";
  const done = await oceanTipBanners(token, [
    "Swim, little pufferfish! 🐡",
    mode === "face" ? "Puff your cheeks to float, let the air out to sink" : `${hold} to puff up and float, let go to sink`,
  ]);
  endPuffCalibrationOverlay(token);
  if (token !== flow) return;
  if (done) markTutorialSeen("ocean");
  game.calmWater = false;
}

let toastTimer = 0;

function showToast(text: string, ms = 2600): void {
  const el = $("hud-toast");
  el.textContent = text;
  show(el, true);
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => show(el, false), ms);
}

function hideToast(): void {
  clearTimeout(toastTimer);
  show($("hud-toast"), false);
}

// --- Ready & run -----------------------------------------------------------------

/**
 * Debug: a fresh run that dives straight into the ocean (no city). From the
 * menu it starts in keyboard mode; mid-calibration it does nothing.
 */
function startOceanRun(): void {
  if (state === "loading" || state === "calibrating") return;
  if (state === "menu") {
    sound.unlock();
    mode = "keyboard";
    tracker.stopCamera();
  }
  startReady(true);
}

/**
 * Set once the player stops straining on the perch, so a strain held over
 * from the previous screen doesn't charge the bird by itself.
 */
let readyArmed = false;

/**
 * The perch: before a run the bird sits on a street lamp and the player
 * practises on a parked car below. A new player is walked through it (strain,
 * relax, splat); after that, the first poop takes off and starts the run.
 * `ocean` (debug) skips it and dives straight in.
 */
function startReady(ocean = false): void {
  flow++;
  calibSamples = null;
  calibFrames = null;
  cam.classList.remove("large");
  show(cam, mode === "face");
  game.reset();
  renderer.photos.clear();
  snapshot.reset();
  keyHeld = false;
  heldPointers.clear();
  keyPuff = 0;
  hideToast();
  show(hud, true);
  if (ocean) {
    // The dive transition is the lead-in; its gateEntered event handles calibration and hints.
    showScreen(null);
    state = "playing";
    game.diveNow();
    return;
  }
  readyArmed = false;
  state = "ready";
  game.perch();
  const face = mode === "face";
  show($("perch-you"), face);
  show($("perch-help"), face);
  show($("ready-key"), !face);
  perchCoach = claimCoach();
  showScreen("ready");
  perch.enteredAt = performance.now();
  enterPerchStep(seenTutorials.has("perch") ? "go" : "strain");
}

/**
 * - strain / relax: a new player's guided practice poop.
 * - pushed: that poop pushed the bird up; the coach says so for a moment.
 * - fill: practice done; a full poop takes off.
 * - go: a returning player; a full poop takes off.
 * Smaller poops just hop on the lamp, so a stray strain never starts the run.
 */
type PerchStep = "strain" | "relax" | "pushed" | "fill" | "go";

const perch = {
  step: "go" as PerchStep,
  enteredAt: 0,
  stepSince: 0,
  /** The face crossed the 💩 line since this step began. */
  reached: false,
  /** When the current unbroken strain began (-1: not straining). */
  strainSince: -1,
  /** Why the tune button is nudging (empty: it isn't). Cleared by a poop: the bar evidently works. */
  nudge: "",
  /** A hint that replaces the step's own until hintUntil (performance.now() ms). */
  hint: "",
  hintUntil: 0,
};

/** Each step's coach line in face mode and in keyboard mode, and the face it asks for. */
interface PerchLine {
  face: string;
  faceHint: string;
  keys: string;
  keysHint: string;
  look: CoachFace;
}

const HOLD = isTouch ? "Hold the screen" : "Hold Space";

const PERCH_TEXT: Record<PerchStep, PerchLine> = {
  strain: {
    face: "Squeeze your face", faceHint: "Like you really need to go 💩",
    keys: HOLD, keysHint: "The bird fills up", look: "strained",
  },
  relax: { face: "Now relax", faceHint: "", keys: "Now let go", keysHint: "", look: "relaxed" },
  pushed: { face: "Pooping pushes you up!", faceHint: "", keys: "Pooping pushes you up!", keysHint: "", look: "relaxed" },
  fill: {
    face: "Squeeze longer to fly", faceHint: "Fill the bird up, then relax",
    keys: `${HOLD} longer to fly`, keysHint: "Fill the bird up, then let go", look: "strained",
  },
  go: {
    face: "Squeeze till the bird is full", faceHint: "",
    keys: `${HOLD} till the bird is full`, keysHint: "", look: "strained",
  },
};

/** While the bird is full: letting go now takes off. */
const PERCH_FULL: PerchLine = { face: "Relax to fly! 🚀", faceHint: "", keys: "Let go to fly! 🚀", keysHint: "", look: "relaxed" };

/** Charge at which a poop off the perch takes off: full. */
const TAKEOFF_CHARGE = 1;

/** The flight lesson's steps, for the coach's dots: three on the perch, one in the city. */
const LESSON_STEPS_TOTAL = 4;
const PERCH_DOT: Partial<Record<PerchStep, number>> = { strain: 0, relax: 1, pushed: 1, fill: 2 };

function enterPerchStep(step: PerchStep): void {
  perch.step = step;
  perch.stepSince = performance.now();
  perch.reached = false;
  perch.hintUntil = 0;
  updatePerchText(perch.stepSince);
}

/** Shows `hint` under the perch's line for `ms`. */
function perchHint(hint: string, ms: number): void {
  perch.hint = hint;
  perch.hintUntil = performance.now() + ms;
  updatePerchText(performance.now());
}

/** The step's line, or "relax to fly" while the bird is full, with a passing hint if there is one. */
function updatePerchText(now: number): void {
  const takeoff = perch.step === "fill" || perch.step === "go";
  const full = takeoff && game.charge.charge >= TAKEOFF_CHARGE && !game.stunned;
  const line = full ? PERCH_FULL : PERCH_TEXT[perch.step];
  const face = mode === "face";
  const dot = PERCH_DOT[perch.step];
  coachSay(perchCoach, {
    title: face ? line.face : line.keys,
    hint: !full && now < perch.hintUntil ? perch.hint : face ? line.faceHint : line.keysHint,
    face: face ? line.look : null,
    done: perch.step === "pushed",
    dots: dot === undefined ? null : [perch.step === "pushed" ? dot + 1 : dot, LESSON_STEPS_TOTAL],
  });
}

/** What charges the bird on the perch: the player, once armed and the relaxed read is done. */
function perchStraining(): boolean {
  if (!straining()) readyArmed = true;
  return readyArmed && straining();
}

/** How long "pooping pushes you up!" stays before the next step. */
const PUSHED_MS = 1800;

/** One frame on the perch: practice physics, the steps, the tune nudge and the layout. */
function updatePerch(dt: number): void {
  // Behind the rotate prompt everything holds, so a hold isn't mistaken for letting go.
  if (needsRotate()) {
    accumulator = 0;
    return;
  }
  accumulator += dt;
  while (accumulator >= STEP) {
    game.straining = perchStraining();
    game.stepPerch(STEP);
    accumulator -= STEP;
  }
  const now = performance.now();
  const release = game.events.find((e) => e.type === "release");
  const pooped = release !== undefined;
  const full = release?.type === "release" && release.charge >= TAKEOFF_CHARGE;
  const accident = game.events.some((e) => e.type === "accident");
  handleGameEvents();
  if (pooped) perch.nudge = "";
  switch (perch.step) {
    case "strain":
      if (pooped) enterPerchStep("pushed");
      else if (game.charge.charge >= 0.3) enterPerchStep("relax");
      break;
    case "relax":
      if (pooped) enterPerchStep("pushed");
      else if (accident) enterPerchStep("strain");
      break;
    case "pushed":
      if (now - perch.stepSince > PUSHED_MS) enterPerchStep("fill");
      break;
    case "fill":
    case "go":
      if (full) return takeOff();
      if (accident) perchHint(tooLongHint(), 3000);
      else if (pooped) perchHint(mode === "face" ? "Squeeze longer to take off" : "Hold longer to take off", 3000);
      break;
  }
  updatePerchText(now);
  updatePerchNudge(now);
  // The panel starts right of the bird and its lamp (canvas units → CSS px).
  const k = canvas.clientHeight / VIEW_H;
  screens.ready.style.setProperty("--perch-x", `${Math.round((game.bird.x + BIRD_RADIUS * 3.4) * k)}px`);
  const slow = mode === "face" && now - perch.enteredAt > 3000 && tracker.detectionRate < config.slowDetectionRate;
  show($("perch-slow"), slow);
}

/** After an accident: the bird stayed full too long. */
function tooLongHint(): string {
  return mode === "face" ? "Too long! Relax as soon as it's full" : "Too long! Let go as soon as it's full";
}

/**
 * Face mode: offers tuning when the bar doesn't follow the face, i.e. it
 * never reaches the 💩 line when asked to strain, or stays over it when asked
 * to relax (or for a long time anyway).
 */
function updatePerchNudge(now: number): void {
  if (mode !== "face") return;
  const active = straining();
  if (!active) perch.strainSince = -1;
  else if (perch.strainSince < 0) perch.strainSince = now;
  if (active) perch.reached = true;
  const inStep = now - perch.stepSince;
  const strainFor = perch.strainSince < 0 ? 0 : now - perch.strainSince;
  const asksStrain = perch.step === "strain" || perch.step === "fill" || perch.step === "go";
  if (perch.step !== "pushed" && faceVisible()) {
    if (strainFor > (perch.step === "relax" ? 3000 : 6000)) perch.nudge = "Bar stuck even when you relax?";
    else if (asksStrain && !perch.reached && inStep > (perch.step === "strain" ? 7000 : 10000)) {
      perch.nudge = "Bar not reacting to your face?";
    }
  }
  const help = $("perch-help");
  help.classList.toggle("nudge", perch.nudge !== "");
  $("perch-help-text").textContent = perch.nudge;
}

/** The first full poop off the perch: the run starts, the practice doesn't count. A new player's city lesson follows. */
function takeOff(): void {
  if (perch.step === "fill") markTutorialSeen("perch");
  perch.nudge = "";
  game.leavePerch();
  // A full push: the perch caps practice hops, not the takeoff.
  game.bird.vy = Math.min(game.bird.vy, -config.pushMax);
  state = "playing";
  showScreen(null);
  lessonCount.poops = lessonCount.accidents = 0;
  if (!seenTutorials.has("city")) void runCityLesson();
}

/**
 * A new player's first flight: the city stays calm (Game.calmCity: no
 * obstacles, the street bounces the bird back up) while the coach teaches
 * staying up, then the buildings come unannounced. Each step moves on once
 * it's done, or after a while anyway. Belongs to the run's flow token.
 */
async function runCityLesson(): Promise<void> {
  const token = flow;
  const owner = claimCoach();
  game.calmCity = true;
  const face = mode === "face";
  let line: CoachLine = { title: "" };
  const say = (dot: number, title: string, hint: string, look: CoachFace | null, done = false): void => {
    line = { title, hint, face: face ? look : null, dots: [dot, LESSON_STEPS_TOTAL], done };
    coachSay(owner, line);
  };
  /** Waits until `done()` (true) or `ms` of playing time (false); null = abandoned. Shows the too-long hint after an accident. */
  const until = async (done: () => boolean, ms: number): Promise<boolean | null> => {
    let left = ms;
    let last = performance.now();
    while (!done()) {
      if (token !== flow || state === "gameover") return null;
      const now = performance.now();
      if (state === "playing") left -= now - last;
      last = now;
      if (left <= 0) return false;
      const recent = now - lessonCount.lastAccident < 3000;
      coachSay(owner, recent ? { ...line, hint: tooLongHint() } : line);
      await wait(50);
    }
    return true;
  };
  const abandon = (): void => {
    releaseCoach(owner);
    if (token === flow) game.calmCity = false;
  };

  say(3, face ? "Squeeze & relax to stay up" : `${HOLD} & let go to stay up`, "Every poop is a flap", "strained");
  const poops = lessonCount.poops;
  const flew = await until(() => lessonCount.poops - poops >= 3, 20_000);
  if (flew === null) return abandon();
  if (flew) {
    say(4, "Nice flying!", "", null, true);
    if ((await until(() => false, 1200)) === null) return abandon();
  }

  // Seen from here on, so a player who crashes soon after doesn't get the whole lesson again.
  markTutorialSeen("city");
  // The street stops bouncing once the bird is clear of it (or after a while), so the handoff isn't a crash.
  // The last line stays up until then; the buildings that follow are for the player to discover.
  const clear = (): boolean => game.bird.y + BIRD_RADIUS < GROUND_Y - 120;
  if ((await until(clear, 8000)) === null) return abandon();
  game.calmCity = false;
  releaseCoach(owner);
}

/** Moves the webcam preview beside the bird on the perch, into the calibration card, or back to its corner. */
function dockCam(slot: "perch" | "calib" | null): void {
  const now = cam.classList.contains("perched") ? "perch" : cam.classList.contains("in-calib") ? "calib" : null;
  if (slot === now) return;
  cam.classList.toggle("perched", slot === "perch");
  cam.classList.toggle("in-calib", slot === "calib");
  if (slot === "perch") $("perch-cam-slot").append(cam);
  else if (slot === "calib") $("calib-cam-slot").append(cam);
  else camHome.parent.insertBefore(cam, camHome.next);
}

function toggleMute(): void {
  storageSet("poopybird.muted.v1", sound.toggleMute() ? "1" : "0");
  updateMuteButton();
  showToast(sound.muted ? "🔇 Muted" : "🔊 Sound on", 1200);
}

function updateMuteButton(): void {
  const btn = $("btn-hud-mute");
  btn.textContent = sound.muted ? "🔇" : "🔊";
  btn.setAttribute("aria-label", sound.muted ? "Unmute" : "Mute");
  decorate(btn);
}

function togglePause(): void {
  if (state === "playing") {
    state = "paused";
    showScreen("pause");
    sound.setGroan(-1, false);
    sound.setBurble(-1);
  } else if (state === "paused") {
    state = "playing";
    showScreen(null);
  }
}

function goToMenu(): void {
  flow++;
  calibSamples = null;
  calibFrames = null;
  tracker.stopCamera();
  state = "menu";
  sound.setGroan(-1, false);
  sound.setBurble(-1);
  hideToast();
  claimCoach();
  cam.classList.remove("large");
  show(cam, false);
  show(hud, false);
  game.startDemo();
  $<HTMLInputElement>("opt-tips").checked = isNewPlayer();
  showScreen("start");
}

function onGameOver(): void {
  state = "gameover";
  sound.setGroan(-1, false);
  sound.setBurble(-1);
  hideToast();
  claimCoach();
  sound.sadTrombone();
  const score = game.score;
  const newBest = score > best;
  if (newBest) {
    best = score;
    saveBest(best);
  }
  $("go-title").textContent = game.trophy !== null
    ? pick(["Hooked!", "Reeled in!", "Gone fishing.", "Fish and chips!"])
    : pick(["Splat!", "Plop.", "Flushed!", "Wiped out!", "Down the drain!"]);
  $("go-score").textContent = String(score);
  show($("go-newbest"), newBest);
  $("go-best").textContent = String(best);
  $("go-targets").textContent = String(game.targetsHit);
  $("go-combo").textContent = game.bestCombo > 1 ? `x${game.bestCombo}` : String(game.bestCombo);
  $("go-distance").textContent = `${Math.round(game.distance / 50)} m`;
  $("go-accidents").textContent = String(game.accidents);
  $("go-smashed").textContent = String(game.camerasSmashed);
  $("go-scandals").textContent = String(game.frontPages.length);
  $("go-kids").textContent = String(game.kidsDisarmed + game.pebblesShot);
  $("go-weddings").textContent = String(game.weddingsRuined);
  $("go-balloons").textContent = String(game.balloonsPopped);
  $("go-lines").textContent = String(game.anglersSnapped);
  $("go-sharks").textContent = String(game.sharksSpiked);

  currentSnapshotUrl = mode === "face" ? snapshot.toDataURL() : null;
  show($("go-snapshot"), currentSnapshotUrl !== null);
  show($("go-snapshot-actions"), currentSnapshotUrl !== null);
  if (currentSnapshotUrl) $<HTMLImageElement>("go-snapshot-img").src = currentSnapshotUrl;
  $("go-strain").textContent = String(strainPercent(snapshot.peakStrain));
  showRunPhotos();

  // Only runs played with the face count: keyboard and touch runs can't be submitted.
  lastRun = mode !== "face" ? null : {
    score,
    stats: { targets: game.targetsHit, distance: Math.round(game.distance / 50), bestCombo: game.bestCombo },
    face: currentSnapshotUrl ? { url: currentSnapshotUrl, strain: snapshot.peakStrain } : null,
  };
  show($("go-lb-form"), lastRun !== null && (score > 0 || lastRun.face !== null));
  show($("go-lb-face-opt"), lastRun?.face != null);
  // Sharing the face is a fresh choice every run (the next player at this machine may not want to).
  $<HTMLInputElement>("go-lb-face").checked = false;
  $<HTMLButtonElement>("btn-lb-submit").disabled = false;
  $<HTMLInputElement>("go-name").value = storageGet("poopybird.name.v1") ?? "";
  const status = $("go-lb-status");
  status.classList.remove("error");
  status.textContent = "Only runs played with your face count for the leaderboard. 😣";
  show(status, lastRun === null);
  void showBoards($("go-lb"));
  showScreen("gameover");
}

/** The game-over prints' canvases have this many pixels per logical unit, so they stay sharp. */
const PRINT_SCALE = 2;

/**
 * The run in pictures on the game-over screen, all on one level: the finest
 * strain (static in index.html, first), then every front page, wedding photo
 * and the trophy photo in the order they were taken (photo ids count up).
 */
function showRunPhotos(): void {
  const strip = $("go-photos");
  for (const el of strip.querySelectorAll(".go-print:not(#go-snapshot)")) el.remove();
  type Print = { photoId: number; title: string; kind: string; w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void };
  const prints: Print[] = [
    ...game.frontPages.map((t): Print => ({
      photoId: t.photoId, title: "Tomorrow's front page", kind: "frontpage", w: 200, h: 240,
      draw: (ctx) => drawFrontPage(ctx, 2, 2, 196, 236, t, renderer.photos),
    })),
    ...game.weddingPhotos.map((w): Print => ({
      photoId: w.photoId, title: "The official wedding photo", kind: "wedding", w: 250, h: 235,
      draw: (ctx) => drawWeddingPrint(ctx, 2, 2, 240, w, renderer.photos.get(w.photoId)),
    })),
  ];
  const trophy = game.trophy;
  if (trophy !== null) {
    prints.push({
      photoId: trophy, title: "Catch of the day", kind: "trophy", w: 250, h: 235,
      draw: (ctx) => drawTrophyPrint(ctx, 2, 2, 240, renderer.photos.get(trophy)),
    });
  }
  prints.sort((a, b) => a.photoId - b.photoId);
  for (const p of prints) {
    const figure = document.createElement("figure");
    figure.className = `go-print ${p.kind}`;
    figure.title = p.title;
    const c = document.createElement("canvas");
    c.width = p.w * PRINT_SCALE;
    c.height = p.h * PRINT_SCALE;
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", p.title);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(PRINT_SCALE, PRINT_SCALE);
      p.draw(ctx);
    }
    figure.append(c);
    strip.append(figure);
  }
  show(strip, prints.length > 0 || currentSnapshotUrl !== null);
  strip.scrollLeft = 0;
}

/** Sends the game-over screen's run to the online leaderboard (only when the player presses Submit). */
async function submitToLeaderboard(): Promise<void> {
  const run = lastRun;
  if (!run) return;
  const name = ($<HTMLInputElement>("go-name").value.trim() || "Anonymous Pooper").slice(0, 16);
  storageSet("poopybird.name.v1", name);
  const withFace = run.face !== null && $<HTMLInputElement>("go-lb-face").checked;
  const button = $<HTMLButtonElement>("btn-lb-submit");
  const status = $("go-lb-status");
  button.disabled = true;
  status.textContent = "Submitting…";
  status.classList.remove("error");
  show(status, true);
  try {
    const result = await submitRun({
      name,
      score: run.score,
      mode: "face",
      stats: run.stats,
      ...(withFace && run.face
        ? { face: { jpeg: run.face.url.slice(run.face.url.indexOf(",") + 1), strain: run.face.strain } }
        : {}),
    });
    if (lastRun !== run) return;
    lastRun = null;
    show($("go-lb-form"), false);
    const places = [
      result.rank.score !== null ? `#${result.rank.score} on scores` : "",
      result.rank.face !== null ? `#${result.rank.face} on faces` : "",
    ].filter(Boolean);
    status.textContent = places.length
      ? `You're ${places.join(" and ")}! 🎉`
      : `Not in the top ${BOARD_KEEP} this time. Strain harder! 💩`;
    void showBoards($("go-lb"), { highlight: result.id });
  } catch (err) {
    if (lastRun !== run) return;
    button.disabled = false;
    status.textContent = `Couldn't submit: ${err instanceof Error ? err.message : "no connection"}.`;
    status.classList.add("error");
  }
}

/** The start screen's 🏆: both boards over the demo. */
function openLeaderboard(): void {
  showScreen("leaderboard");
  void showBoards($("lb-full"), { limit: 20 });
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// --- HUD -----------------------------------------------------------------------------------

const hudCache = { score: -1, best: -1, combo: -1, message: "" };

function updateHud(): void {
  const score = game.score;
  if (score !== hudCache.score) {
    hudCache.score = score;
    $("hud-score").textContent = String(score);
  }
  const shownBest = Math.max(best, state === "playing" || state === "paused" ? score : 0);
  if (shownBest !== hudCache.best) {
    hudCache.best = shownBest;
    $("hud-best").textContent = String(shownBest);
  }
  if (game.combo !== hudCache.combo) {
    hudCache.combo = game.combo;
    const comboEl = $("hud-combo");
    show(comboEl, game.combo >= 2);
    $("hud-combo-n").textContent = `x${game.comboMultiplier.toFixed(1)} (${game.combo} hits)`;
    comboEl.style.animation = "none";
    void comboEl.offsetWidth;
    comboEl.style.animation = "";
  }
  const msg = game.message?.text ?? "";
  if (msg !== hudCache.message) {
    hudCache.message = msg;
    const el = $("hud-message");
    el.textContent = msg;
    show(el, msg !== "");
  }
  // Pausing only works mid-run; before the first flap the button would do nothing.
  show($("btn-hud-pause"), state === "playing" || state === "paused");
}

// --- Main loop ---------------------------------------------------------------------------

const STEP = 1 / 120;
let accumulator = 0;
let lastTime = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;

  updateRotatePrompt();
  if (state === "playing") {
    accumulator += dt;
    while (accumulator >= STEP) {
      game.straining = straining();
      if (game.swimming) {
        // A pop deflates the fish: key puff stays empty while stunned.
        keyPuff = game.stunned
          ? 0
          : stepKeyPuff(keyPuff, manualHeld(), STEP, config.oceanKeyInflateRate, config.oceanKeyDeflateRate);
      }
      game.puffInput = puffInput();
      game.step(STEP);
      accumulator -= STEP;
    }
    handleGameEvents();
  } else if (state === "ready") {
    updatePerch(dt);
  } else if (state === "gameover") {
    game.step(dt);
  } else if (game.demo) {
    // Start screen (and the loading and calibration cards over it): the bird plays itself.
    accumulator += dt;
    while (accumulator >= STEP) {
      game.stepDemo(STEP);
      accumulator -= STEP;
    }
  } else if (state !== "paused") {
    game.idle(dt);
    accumulator = 0;
  }

  renderer.mouthOpen = mode === "face" && faceFresh() && !game.demo ? mouthOpen : 0;
  renderer.draw(game, state === "playing" || game.demo ? dt : 0);

  const charging = (state === "playing" || state === "ready") && game.phase === "playing" && game.charge.charge > 0 && !game.stunned;
  if (state !== "calibrating") sound.setGroan(charging ? game.charge.charge : -1, game.overstrainProgress > 0);
  if (activePuffCalibration === null) {
    sound.setBurble(state === "playing" && game.swimming && !game.stunned ? game.fish.puff : -1);
  }

  // Only audible during active city gameplay, and only when part of a line
  // is actually visible. Distance is to the nearest point on any visible wire.
  let powerLineProximity = 0;
  if (state === "playing" && game.stage === "city" && game.phase === "playing") {
    const { x, y } = game.bird;
    const audibleRange = config.powerLineAudioRange;
    for (const line of game.powerLines) {
      const right = line.x + line.span * (line.poles - 1);
      if (right < 0 || line.x > game.width) continue;
      const nearestX = Math.max(0, Math.min(game.width, Math.max(line.x, Math.min(right, x))));
      for (let i = 0; i < line.wires.length; i++) {
        const wire = wireAt(line, i, nearestX);
        if (!wire) continue;
        const distance = Math.hypot(nearestX - x, wire.y - y);
        powerLineProximity = Math.max(powerLineProximity, 1 - distance / audibleRange);
      }
    }
  }
  sound.setPowerLineProximity(powerLineProximity);
  sound.setSharkTheme(state === "playing" && game.sharkTheme !== null ? config.sharkThemeOffset + game.sharkTheme : null);

  updateHud();
  updateStrainBars();
  debug?.update({
    fps,
    detectionRate: tracker.ready ? tracker.detectionRate : 0,
    delegate: tracker.delegate ?? "–",
    mode,
    faceVisible: faceVisible(),
    features: faceFresh() ? (lastFace?.features ?? null) : null,
    calibration,
    rawStrain: faceFresh() ? strain.raw : 0,
    strain: faceFresh() ? strain.smoothed : 0,
    strainActive: faceFresh() && strain.active,
    straining: straining(),
    charge: game.charge.charge,
    fullHold: game.charge.fullHold,
    stun: game.charge.stun,
    scrollSpeed: game.speed,
    difficulty: game.difficulty,
    cityStage: game.cityStage,
    birdVy: game.bird.vy,
    stage: game.transition
      ? `${game.transition.to === "ocean" ? "city" : "ocean"} → ${game.transition.to}`
      : game.stage,
    puffCalibration,
    puffSource: puffCalibration ? `calibrated (${topFeatureLabels(puffCalibration).join(", ")}) + pucker range` : "pucker range",
    rawPuff: mode === "face" && faceFresh() ? puffSignal.raw : 0,
    facePuff: facePuff(),
    keyPuff,
    puffInput: puffInput(),
    fishPuff: game.fish.puff,
    spiked: game.spike.spiked,
    spikeHold: game.spike.hold,
    puffStun: game.spike.stun,
  });
  requestAnimationFrame(frame);
}

/**
 * The paparazzo's shot: the player's real face in face mode (like the
 * finest-strain snapshot), otherwise the strained bird. Kept in memory for
 * this run only.
 */
function takePhoto(photoId: number): void {
  const face = mode === "face" && faceFresh() ? captureFace(video, lastFace?.box ?? null) : null;
  const photo = face ?? renderer.captureBird(game);
  if (photo) renderer.photos.set(photoId, photo);
}

/** The player's face at the wedding's kiss (face mode): it ends up on the bird in the wedding photo. */
let weddingFace: Photo | null = null;

/** Which poop sample a release at this charge plays. */
function poopSize(charge: number): PoopSize {
  if (charge >= config.poopSoundLarge) return "large";
  if (charge >= config.poopSoundMiddle) return "middle";
  return "weak";
}

function handleGameEvents(): void {
  for (const e of game.events) {
    switch (e.type) {
      case "release":
        lessonCount.poops++;
        sound.release(poopSize(e.charge), e.charge, e.sweet);
        buzz(e.sweet ? [15, 40, 25] : Math.round(8 + 20 * e.charge));
        break;
      case "accident":
        lessonCount.accidents++;
        lessonCount.lastAccident = performance.now();
        sound.accident();
        buzz([60, 40, 120]);
        break;
      case "splat":
        sound.splat(e.big);
        break;
      case "hit":
        sound.hit(e.combo);
        buzz(12);
        break;
      case "crash":
        sound.splat(true);
        buzz(200);
        break;
      case "chomp":
        sound.sharkBite();
        buzz([80, 40, 200]);
        break;
      case "zap":
        sound.zap();
        buzz([30, 20, 30, 20, 120]);
        break;
      case "droneDown":
        sound.powerDown();
        break;
      case "droneCrashed":
        sound.droneCrash();
        buzz([20, 30, 60]);
        break;
      case "gameover":
        onGameOver();
        break;
      case "gateEntered":
        if (e.to === "ocean") {
          sound.splash();
          // Keyboard players start at the hover point; in face mode the face decides.
          keyPuff = mode === "keyboard" ? config.oceanHoverPuff : 0;
        } else {
          keyPuff = 0;
        }
        break;
      case "submerged":
        void onSubmerged();
        break;
      case "breached":
        sound.splash();
        break;
      case "transformed":
      case "surfaced":
        sound.splash();
        break;
      case "spike":
        sound.spike();
        break;
      case "pop":
        sound.deflate();
        buzz(120);
        break;
      case "jellyPopped":
        sound.jellyPop(e.combo);
        break;
      case "paparazzoBeep":
        sound.cameraBeep(e.timer);
        break;
      case "photo":
        sound.shutter();
        takePhoto(e.photoId);
        break;
      case "cameraSmashed":
        sound.smash();
        break;
      case "slingshotDraw":
        sound.slingshotDraw(e.windup);
        break;
      case "slingshotFire":
        sound.slingshotFire();
        break;
      case "bonk":
        sound.bonk();
        buzz(80);
        break;
      case "pebbleShot":
        sound.pebbleShot(e.combo);
        break;
      case "ricochet":
        sound.ricochet();
        break;
      case "kidCried":
        sound.kidCry();
        break;
      case "curse":
        sound.curse();
        break;
      case "weddingArrived":
        sound.weddingArrived();
        break;
      case "weddingBeat":
        sound.weddingBeat(e.count);
        break;
      case "weddingKiss":
        sound.weddingKiss();
        // Grab the face now: a player who's on it is straining hardest right at "KISS!".
        weddingFace = mode === "face" && faceFresh() ? captureFace(video, lastFace?.box ?? null) : null;
        break;
      case "weddingRuined":
        sound.weddingRuined();
        break;
      case "weddingMarried":
        sound.weddingMarried();
        break;
      case "weddingPhoto": {
        sound.shutter();
        const photo = renderer.captureWedding(game, weddingFace);
        if (photo) renderer.photos.set(e.photoId, photo);
        weddingFace = null;
        break;
      }
      case "bouquetThrown":
        sound.bouquetThrown(e.angry);
        break;
      case "bouquetCaught":
        sound.bouquetCaught();
        break;
      case "bouquetHit":
        sound.bouquetHit();
        break;
      case "balloonPop":
        sound.balloonPop();
        sound.hit(e.combo);
        break;
      case "chuteOpen":
        sound.chuteOpen();
        break;
      case "basketLanded":
        sound.basketLanded();
        break;
      case "burner":
        sound.burner();
        break;
      case "threaded":
        sound.hit(4);
        break;
      case "anglerCast":
        sound.anglerCast();
        break;
      case "anglerHooked":
        sound.anglerHooked();
        buzz([40, 30, 40]);
        break;
      case "anglerReel":
        sound.reelClick();
        break;
      case "anglerLanded": {
        sound.splash();
        buzz(200);
        const photo = renderer.captureTrophy(game);
        if (photo) renderer.photos.set(e.photoId, photo);
        break;
      }
      case "anglerPhoto":
        sound.shutter();
        break;
      case "lineSnapped":
        sound.lineSnap();
        buzz(60);
        break;
      case "sharkNote":
        sound.sharkNote(e.high, e.volume);
        break;
      case "sharkWindup":
        break;
      case "sharkLunge":
        sound.sharkLunge();
        break;
      case "sharkSpiked":
        sound.sharkYelp();
        sound.hit(e.combo);
        buzz([40, 30, 80]);
        break;
      case "anchorWarn":
        // aaron removed this we dont want no fucking beep
        // sound.beep();
        break;
      case "anchorRattle":
        sound.anchorRattle();
        break;
      case "anchorSnapped":
        sound.lineSnap();
        break;
      case "anchorLanded":
        sound.anchorLanded();
        buzz(50);
        break;
    }
  }
  game.events.length = 0;
}

// --- Input ---------------------------------------------------------------------------------

function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
}

/** Something focused that handles Enter itself (a Tab-focused button, the options toggle…). */
function focusHandlesEnter(): boolean {
  const el = document.activeElement;
  return !!el && el !== document.body && el.matches("button, summary, a, select, input, textarea");
}

window.addEventListener("keydown", (e) => {
  if (isTyping(e)) return;
  // Each button takes the one key on its badge: Enter for a screen's yellow button, else its own (keyhints.ts).
  if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const name = keyName(e);
    const btn = name === "Enter" && focusHandlesEnter() ? null : buttonForKey(name);
    if (btn) {
      e.preventDefault();
      if (performance.now() >= buttonKeysArmedAt) pressFromKey(btn);
      return;
    }
    if (keyBlocked(name)) return;
  }
  const key = e.key.toLowerCase();
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) keyHeld = true;
    return;
  }
  if (e.repeat) return;
  switch (key) {
    case "p":
    case "escape":
      // Esc is a hidden alias for P: buttons that show Esc (e.g. the perch's Menu) take it first.
      togglePause();
      break;
    case "m":
      toggleMute();
      break;
    case "d":
      debug?.toggle();
      break;
    case "g":
      // Debug shortcut: the stage's waterfront comes next.
      if (debug?.visible && state === "playing") game.spawnShoreNow();
      break;
    case "l":
      // Debug shortcut: a power line right now.
      if (debug?.visible && state === "playing") game.spawnPowerLineNow();
      break;
    case "f":
      // Debug shortcut: a paparazzo walks on.
      if (debug?.visible && state === "playing") game.spawnPaparazzoNow();
      break;
    case "k":
      // Debug shortcut: a slingshot kid walks on.
      if (debug?.visible && state === "playing") game.spawnKidNow();
      break;
    case "w":
      // Debug shortcut: a wedding right now.
      if (debug?.visible && state === "playing") game.spawnWeddingNow();
      break;
    case "b":
      // Debug shortcut: a hot-air balloon floats in.
      if (debug?.visible && state === "playing") game.spawnBalloonNow();
      break;
    case "h":
      // Debug shortcut: a fisherman rows in (ocean only).
      if (debug?.visible && state === "playing") game.spawnAnglerNow();
      break;
    case "s":
      // Debug shortcut: a shark swims in (ocean only).
      if (debug?.visible && state === "playing") game.spawnSharkNow();
      break;
    case "a":
      // Debug shortcut: a boat that drops its anchor (ocean only).
      if (debug?.visible && state === "playing") game.spawnAnchorDropNow();
      break;
    case "o":
      // Debug shortcut: start a run as the pufferfish.
      if (debug?.visible) startOceanRun();
      break;
    case "n":
      void switchFace();
      break;
    case "c":
      void recalibrate();
      break;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") keyHeld = false;
});

/** The game button `target` presses, if it's an enabled one. */
function gameButton(target: EventTarget | null): HTMLButtonElement | null {
  const btn = target instanceof Element ? target.closest<HTMLButtonElement>("button.btn, button.hud-btn") : null;
  return btn && !btn.disabled ? btn : null;
}

function buttonClick(): void {
  sound.unlock();
  sound.buttonClick();
}

// Every button clicks when pressed: on pointer down (snappier than on click), or from the keyboard (a click with detail 0).
document.addEventListener("pointerdown", (e) => {
  if (e.button === 0 && gameButton(e.target)) buttonClick();
}, true);
document.addEventListener("click", (e) => {
  if (e.detail === 0 && gameButton(e.target)) buttonClick();
}, true);

canvas.addEventListener("pointerdown", (e) => {
  if (state !== "playing" && state !== "ready") return;
  e.preventDefault();
  sound.unlock();
  heldPointers.add(e.pointerId);
  canvas.setPointerCapture?.(e.pointerId);
});
for (const type of ["pointerup", "pointercancel"] as const) {
  window.addEventListener(type, (e) => heldPointers.delete(e.pointerId));
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  keyHeld = false;
  heldPointers.clear();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") togglePause();
});
window.addEventListener("resize", () => game.resize(renderer.resize()));

// --- Buttons -------------------------------------------------------------------------------

decorateAll();
const on = (id: string, fn: () => void) => $(id).addEventListener("click", fn);

// Settings (the gear, top right): the graphics style, the remembered faces, and from the menu,
// playing without the camera. Opening it mid-run pauses the game.
const settingsPanel = $("screen-settings");
const rtxSwitch = $<HTMLInputElement>("opt-rtx");
function openSettings(fromMenu: boolean): void {
  if (state === "playing") togglePause();
  rtxSwitch.checked = renderer.graphics === "rtx";
  show($("settings-nocam"), fromMenu);
  updateFacesSetting();
  show(settingsPanel, true);
  armButtonKeys(300);
}
on("btn-settings", () => openSettings(true));
on("btn-hud-settings", () => openSettings(false));
on("btn-settings-done", () => show(settingsPanel, false));
rtxSwitch.addEventListener("change", () => {
  renderer.graphics = rtxSwitch.checked ? "rtx" : "classic";
  saveGraphics(renderer.graphics);
});
on("btn-forget-faces", forgetFaces);
on("btn-face", () => {
  goLandscape();
  void startFaceMode();
});
on("btn-keyboard", () => {
  show(settingsPanel, false);
  goLandscape();
  startKeyboardMode();
});
on("btn-hud-mute", toggleMute);
on("btn-hud-pause", togglePause);
on("btn-loading-retry", () => void startFaceMode());
on("btn-loading-keyboard", startKeyboardMode);
on("btn-calib-go", () => {
  goLandscape();
  calib.pressed = true;
});
on("btn-calib-skip", () => {
  calib.skipped = true;
});
on("btn-calib-keyboard", () => {
  goLandscape();
  startKeyboardMode();
});
on("btn-calib-cancel", goToMenu);
on("btn-perch-menu", goToMenu);
on("btn-tune", () => void recalibrate());
on("btn-perch-keyboard", () => {
  goLandscape();
  startKeyboardMode();
});
on("btn-resume", togglePause);
on("btn-pause-menu", goToMenu);
on("btn-again", () => {
  goLandscape();
  // Someone new took over mid-run: they calibrate first.
  if (mode === "face" && faceId.status === "new") void runCalibration(false);
  else startReady();
});
on("btn-go-calibrate", () => void recalibrate());
on("btn-go-menu", goToMenu);
$<HTMLInputElement>("opt-tips").addEventListener("change", (e) => {
  setNewPlayer((e.target as HTMLInputElement).checked);
});
on("btn-download", () => {
  if (!currentSnapshotUrl) return;
  const a = document.createElement("a");
  a.href = currentSnapshotUrl;
  a.download = `poopy-bird-finest-strain-${game.score}.jpg`;
  a.click();
});
$<HTMLFormElement>("go-lb-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void submitToLeaderboard();
});
on("btn-leaderboard", openLeaderboard);
on("btn-lb-back", () => showScreen("start"));
// Buttons and option toggles shouldn't keep focus, or Space would "click" them while straining
// (and a focused checkbox counts as typing, which mutes the shortcuts).
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button, .opt")) (document.activeElement as HTMLElement | null)?.blur();
});

// --- Phones: landscape, haptics -------------------------------------------------------------

/**
 * Touch devices: go fullscreen and lock to landscape, where the browser allows
 * it (Android Chrome; iOS Safari can't, so the rotate prompt covers that).
 * Must run inside a tap.
 */
function goLandscape(): void {
  if (!isTouch || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement
    .requestFullscreen({ navigationUI: "hide" })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => { });
}

const portraitQuery = window.matchMedia("(orientation: portrait)");

/** A phone held upright during a run: the playfield would be too narrow to see what's coming. */
function needsRotate(): boolean {
  return isTouch && portraitQuery.matches && (state === "ready" || state === "playing" || state === "paused");
}

function updateRotatePrompt(): void {
  const rotate = needsRotate();
  if (rotate && state === "playing") togglePause();
  show(rotateScreen, rotate);
}

/** A short buzz on phones that support it (not iOS). Muting silences it too. */
function buzz(pattern: number | number[]): void {
  if (sound.muted || !isTouch) return;
  navigator.vibrate?.(pattern);
}

// --- Boot ----------------------------------------------------------------------------------

updateMuteButton();
goToMenu();
requestAnimationFrame(frame);

// Handy for tuning from the console.
if (DEBUG) {
  Object.assign(window, {
    poopyBird: {
      game, config, tracker, renderer,
      get calibration() { return calibration; },
      get puffCalibration() { return puffCalibration; },
      /** Face recognition: who the locked face is, and the faces this tab knows. */
      get faceId() { return { ...faceId, recognizer: recognizer.status, describeMs: recognizer.lastMs, knownFaces }; },
      openDatasetRecorder,
    },
  });
}
