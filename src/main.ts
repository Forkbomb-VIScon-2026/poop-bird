// App glue: screens, input, the fixed-timestep game loop, face tracking and
// recognition, the calibration screen, the lessons, and the debug panel.
// Self-contained UI pieces live in ui/, event sounds in feedback.ts.

import "./style.css";
import calibPuffedUrl from "./assets/calib-puffed.jpg";
import calibStrainedUrl from "./assets/calib-strained.jpg";
import { config } from "./config";
import { Sound } from "./audio";
import { DebugPanel } from "./debug";
import { DEBUG } from "./env";
import { FaceTracker, describeCameraError, videoImage, type FaceBox, type FaceFrame } from "./face";
import { FaceRecognizer, alignedFaceCrop } from "./faceid";
import { BIRD_RADIUS, GROUND_Y, Game, SURFACE_Y, VIEW_H, wireAt } from "./game";
import { buttonForKey, decorate, decorateAll, keyBlocked, keyName, pressFromKey } from "./keyhints";
import { playFeedback } from "./feedback";
import { Renderer, type Photo } from "./render";
import { StrainSnapshot, captureFace } from "./snapshot";
import { TAGLINES, pickTagline } from "./taglines";
import { RollingTiming } from "./timing";
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
  type Tutorial,
} from "./known-faces";
import { strainPercent } from "./leaderboard";
import { showBoards } from "./leaderboard-view";
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
  loadCalibration,
  loadGraphics,
  loadKnownFacesJson,
  loadMuted,
  loadMusic,
  saveBest,
  saveCalibration,
  saveGraphics,
  saveKnownFacesJson,
  saveMusic,
  saveMuted,
  storageRemove,
} from "./storage";
import {
  PUFF_FEATURES,
  MAX_NEUTRAL_FALSE_RATE,
  STRAIN_FEATURES,
  assessCalibration,
  buildCalibration,
  defaultCalibration,
  featureStats,
  initialStrainState,
  robustFeatureStats,
  smoothStrain,
  stepStrain,
  strainedness,
  topFeatureLabels,
  type Calibration,
  type FeatureVector,
} from "./strain";
import { claimCoach, coachSay, dockCoach, releaseCoach, type CoachFace, type CoachLine } from "./ui/coach";
import { $, homeOf, isTouch, replayAnimation, show, stopwatch, wait } from "./ui/dom";
import { offerRun, showRunPhotos, showRunStats, submitToLeaderboard } from "./ui/gameover";
import { hideToast, showToast } from "./ui/toast";

// --- DOM ----------------------------------------------------------------------

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
/** Where #cam lives in the DOM when it isn't docked on the calibration screen. */
const camHome = homeOf(cam);
const rotateScreen = $("screen-rotate");

document.body.classList.toggle("touch", isTouch);

function showScreen(name: keyof typeof screens | null): void {
  for (const [k, el] of Object.entries(screens)) show(el, k === name);
  dockCam(mode === "face" && name === "calibrate");
  dockCoach(name === "ready", perchCoach);
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
const sound = new Sound(true);
const tracker = new FaceTracker(video);
const snapshot = new StrainSnapshot();
const debug = DEBUG
  ? new DebugPanel($("debug"), () => void recalibrate(), () => startOceanRun(), openDatasetRecorder, forgetCalibration)
  : null;
if (!DEBUG) document.querySelectorAll("[data-debug-only]").forEach((el) => el.remove());
if (debug) $("btn-debug").addEventListener("click", () => debug.toggle());

let calibration: Calibration | null = loadCalibration(CALIBRATION_KEY, STRAIN_FEATURES);
/** `calibration` is a guess from the relaxed face ("Play anyway" after failed strains), not a fitted one. */
let calibrationIsDefault = false;
/** Puff calibration (neutral vs. full puff), on top of the fixed pucker range. null = the pucker range alone. */
let puffCalibration: Calibration | null = loadCalibration(PUFF_CALIBRATION_KEY, PUFF_FEATURES);
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
/** Smoothed `strainedness` of the face (the finest-strain snapshot's and the leaderboard's measure). */
let faceStrain = 0;
/** The player pressed "Skip tutorial": the lesson running ends (lessons reset it when they start). */
let tutorialSkipped = false;
/** The lesson that started last, and the face lock it started under: what "Skip tutorial" skips. */
let activeLesson: { tutorial: Tutorial; lock: number } | null = null;
/** Tutorials shown without a face to remember them with (keyboard mode, or no face recognition here); Forget all clears them. */
const seenWithoutFace = new Set<Tutorial>();

sound.setMuted(loadMuted());
sound.setMusicOn(loadMusic());

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

/** The run is on (not paused, not over): lessons time themselves in playing time. */
function playing(): boolean {
  return state === "playing";
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
  // From the frame these landmarks are from (frame.image is only valid here).
  if (wantFaceCrop && frame.landmarks && frame.box) {
    faceCrop = alignedFaceCrop(frame.image, frame.landmarks, frame.box, config.faceIdMinFacePx);
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
    snapshot.offer(frame.image, frame.box, faceStrain);
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
  /** Tutorials seen since the lock, remembered with the face (rememberFace). */
  tutorials: new Set<Tutorial>(),
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
  faceId.tutorials = new Set();
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
    const blank: KnownFace = { id: nextFaceId(knownFaces), descriptors: [], strain: null, strainIsDefault: false, puff: null, tutorials: [], lastSeen: 0 };
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
    tutorials: [...new Set([...f.tutorials, ...faceId.tutorials])],
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
  seenWithoutFace.clear();
  resetFaceId();
  updateFacesSetting();
  console.info(`[faceid] forgot ${n} face${n === 1 ? "" : "s"}`);
}

/** The settings' face line: how many faces this tab remembers. */
function updateFacesSetting(): void {
  const n = knownFaces.length;
  $("faces-count").textContent = n ? `${n} face${n === 1 ? "" : "s"} remembered in this tab.` : "No faces remembered.";
  $<HTMLButtonElement>("btn-forget-faces").disabled = n === 0 && seenWithoutFace.size === 0;
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
  $("calib-prompt").textContent = "Hi! 👋 Just look at the camera for a moment";
  screens.calibrate.classList.add("welcome");
  show($("calib-buttons"), false);
  show($("calib-run"), true);
  $("calib-count").textContent = "";
  const progress = $("calib-progress");
  progress.style.width = "0%";
  calibStatus("", "");
  calib.relaxing = true;
  const faceFor = stopwatch(faceVisible);
  let doneAt = -1;
  try {
    for (; ;) {
      await wait(50);
      if (token !== flow) return false;
      const now = performance.now();
      const seen = faceFor();
      if (!calib.forced && faceCalibrated()) {
        calib.relaxing = false;
        startReady();
        showToast("👋 Welcome back! You're still calibrated", 2500);
        return false;
      }
      const read = Math.min(seen / WELCOME_MS, calib.relaxed.length / MIN_RELAXED_SAMPLES, 1);
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

/** The puff phase: a hold, against the relaxed face from the welcome. Like calibrateStrain. */
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
    const relaxed = [...calib.relaxed];
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
    case "your face didn't relax between puffs": return "Your puff looked too much like your normal face. Fill your cheeks right up!";
    case "puff wasn't held steadily": return "Keep the cheeks puffed for the whole bar, then try again.";
    case "couldn't see your face": return "I couldn't see your face well. Face the camera, in good light.";
    default: return "That didn't work. Try again!";
  }
}

const CALIB_TEXT = {
  strain: {
    prompt: "Strain like you really need to go 💩",
  },
  puff: {
    prompt: "Puff your cheeks like a pufferfish 🐡",
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
  $("calib-prompt").textContent = text.prompt;
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

/** Debug: delete both saved calibrations and the known faces, and reload, to test the first-time flow. */
function forgetCalibration(): void {
  storageRemove(CALIBRATION_KEY);
  storageRemove(PUFF_CALIBRATION_KEY);
  saveKnownFacesJson(null);
  location.reload();
}

// --- Tutorials (new-player tips) ---------------------------------------------------------

/** Tutorials are per face: a face playing gets them once; without one (keyboard mode, no face recognition), once per tab. */
function playsAsFace(): boolean {
  return mode === "face" && faceId.status !== "off";
}

function tutorialSeen(t: Tutorial): boolean {
  if (!playsAsFace()) return seenWithoutFace.has(t);
  return faceId.tutorials.has(t) || !!faceId.known?.tutorials.includes(t);
}

/** `lock`: the face lock the lesson started under; if someone else has taken over since, it isn't theirs. */
function markTutorialSeen(t: Tutorial, lock: number): void {
  if (lock !== faceId.lock) return;
  if (!playsAsFace()) {
    seenWithoutFace.add(t);
    updateFacesSetting();
    return;
  }
  faceId.tutorials.add(t);
  rememberFace();
}

/**
 * The bird just turned into a deflated fish. A new player gets the swim
 * lesson over calm water; everyone else swims right into the level. (The
 * puff was calibrated before the run, on the calibration screen.)
 */
function onSubmerged(): void {
  if (!tutorialSeen("ocean")) void runSwimLesson();
  else showToast(mode === "face" ? "Puff your cheeks to float 🐡" : isTouch ? "Hold the screen to puff up 🐡" : "Hold SPACE to puff up 🐡");
}

/**
 * A new player's first dive: the fish swims on in calm water (see
 * Game.calmWater) while the coach has them rise to the surface, then sink
 * back down, then warns about spikes; then the level starts. Belongs to the
 * run's flow token.
 */
async function runSwimLesson(): Promise<void> {
  const token = flow;
  const lock = faceId.lock;
  const owner = claimCoach();
  game.calmWater = true;
  tutorialSkipped = false;
  activeLesson = { tutorial: "ocean", lock };
  const face = mode === "face";
  const say = (line: CoachLine): void => coachSay(owner, { ...line, face: face ? line.face : null, skip: true });
  /** Waits until `done()` (true) or `ms` of playing time (false); null = abandoned. */
  const until = async (done: () => boolean, ms: number): Promise<boolean | null> => {
    const played = stopwatch(playing);
    while (!done()) {
      if (token !== flow || state === "gameover" || tutorialSkipped) return null;
      if (played() >= ms) return false;
      await wait(50);
    }
    return true;
  };
  const abandon = (): void => {
    releaseCoach(owner);
    if (token === flow) game.calmWater = false;
  };

  if ((await until(() => !game.transition, 10_000)) === null) return abandon();
  say({
    title: face ? "Puff your cheeks to rise ⬆️" : `${HOLD} to rise ⬆️`,
    hint: "Swim up to the surface",
    face: "puffed",
    dots: [0, 2],
  });
  if ((await until(() => game.bird.y < SURFACE_Y + 110, 15_000)) === null) return abandon();
  say({
    title: face ? "Let the air out to sink ⬇️" : "Let go to sink ⬇️",
    hint: "Dive down towards the sea floor",
    face: "relaxed",
    dots: [1, 2],
  });
  if ((await until(() => game.bird.y > GROUND_Y - 150, 15_000)) === null) return abandon();
  say({ title: "Nice swimming! 🐡", hint: "", face: null, dots: [2, 2], done: true });
  if ((await until(() => false, 1200)) === null) return abandon();

  // Seen from here on, so a player who crashes soon after doesn't get the lesson again.
  markTutorialSeen("ocean", lock);
  say({ title: "Spikes! 🐡", hint: "Puff past the red line to spike out. Hold it too long and you pop", tips: true });
  if ((await until(() => false, 4000)) === null) return abandon();
  game.calmWater = false;
  releaseCoach(owner);
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
 * The perch: before a run the bird sits on a street lamp until the player
 * strains and lets go; that first poop, however small, takes off and starts
 * the run. (Calibration already taught the strain.) `ocean` (debug) skips it
 * and dives straight in.
 */
function startReady(ocean = false): void {
  endFlows();
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
  show($("perch-help"), face);
  show($("ready-key"), !face);
  perchCoach = claimCoach();
  showScreen("ready");
  Object.assign(perch, { enteredAt: performance.now(), reached: false, strainSince: -1, nudge: "", hintUntil: 0 });
  updatePerchText(perch.enteredAt);
}

const perch = {
  enteredAt: 0,
  /** The face crossed the strain threshold since the bird sat down. */
  reached: false,
  /** When the current unbroken strain began (-1: not straining). */
  strainSince: -1,
  /** Why the tune button is nudging (empty: it isn't). */
  nudge: "",
  /** A hint that replaces the line's own until hintUntil (performance.now() ms). */
  hint: "",
  hintUntil: 0,
};

const HOLD = isTouch ? "Hold the screen" : "Hold Space";

/** Shows `hint` under the perch's line for `ms`. */
function perchHint(hint: string, ms: number): void {
  perch.hint = hint;
  perch.hintUntil = performance.now() + ms;
  updatePerchText(performance.now());
}

/** The perch's one line, with a passing hint if there is one. */
function updatePerchText(now: number): void {
  const face = mode === "face";
  coachSay(perchCoach, {
    title: face ? "Strain & let go to start" : `${HOLD} & let go to start`,
    hint: now < perch.hintUntil ? perch.hint : "",
    face: face ? (straining() ? "relaxed" : "strained") : null,
  });
}

/** What charges the bird on the perch: the player, once armed (not still straining from the screen before). */
function perchStraining(): boolean {
  if (!straining()) readyArmed = true;
  return readyArmed && straining();
}

/** One frame on the perch: the bird waits for a poop, plus the tune nudge and the layout. */
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
  const pooped = game.events.some((e) => e.type === "release");
  const accident = game.events.some((e) => e.type === "accident");
  handleGameEvents();
  if (pooped) return takeOff();
  if (accident) perchHint(tooLongHint(), 3000);
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
 * Face mode: offers tuning when straining doesn't register, i.e. the face
 * never crosses the threshold, or stays over it for a long time.
 */
function updatePerchNudge(now: number): void {
  if (mode !== "face") return;
  const active = straining();
  if (!active) perch.strainSince = -1;
  else if (perch.strainSince < 0) perch.strainSince = now;
  if (active) perch.reached = true;
  const strainFor = perch.strainSince < 0 ? 0 : now - perch.strainSince;
  if (faceVisible()) {
    if (strainFor > 6000) perch.nudge = "Stuck even when you relax?";
    else if (!perch.reached && now - perch.enteredAt > 8000) perch.nudge = "Not taking off?";
  }
  const help = $("perch-help");
  help.classList.toggle("nudge", perch.nudge !== "");
  $("perch-help-text").textContent = perch.nudge;
}

/** The first poop off the perch: the run starts. A new player's city lesson follows. */
function takeOff(): void {
  perch.nudge = "";
  game.leavePerch();
  // A full push whatever the poop: the perch caps its climb, not the takeoff.
  game.bird.vy = Math.min(game.bird.vy, -config.pushMax);
  state = "playing";
  showScreen(null);
  lessonCount.poops = lessonCount.accidents = 0;
  if (!tutorialSeen("city")) void runCityLesson();
}

/**
 * A new player's first flight: the city stays calm (Game.calmCity: no
 * obstacles, the street bounces the bird back up) while the coach teaches
 * staying up, then the buildings come unannounced. Each step moves on once
 * it's done, or after a while anyway. Belongs to the run's flow token.
 */
async function runCityLesson(): Promise<void> {
  const token = flow;
  const lock = faceId.lock;
  const owner = claimCoach();
  game.calmCity = true;
  tutorialSkipped = false;
  activeLesson = { tutorial: "city", lock };
  const face = mode === "face";
  let line: CoachLine = { title: "" };
  const say = (title: string, hint: string, look: CoachFace | null, done = false): void => {
    line = { title, hint, face: face ? look : null, done, skip: true };
    coachSay(owner, line);
  };
  /**
   * Waits until `done()` (true) or `ms` of playing time (false); null = abandoned. Shows the too-long hint after an accident.
   * Skipping the tutorial ends a `skippable` wait (as done) and hides the coach.
   */
  const until = async (done: () => boolean, ms: number, skippable = true): Promise<boolean | null> => {
    const played = stopwatch(playing);
    while (!done()) {
      if (token !== flow || state === "gameover") return null;
      if (tutorialSkipped) {
        releaseCoach(owner);
        if (skippable) return true;
      }
      if (played() >= ms) return false;
      const recent = performance.now() - lessonCount.lastAccident < 3000;
      if (!tutorialSkipped) coachSay(owner, recent ? { ...line, hint: tooLongHint() } : line);
      await wait(50);
    }
    return true;
  };
  const abandon = (): void => {
    releaseCoach(owner);
    if (token === flow) game.calmCity = false;
  };

  say(face ? "Squeeze & relax to stay up" : `${HOLD} & let go to stay up`, "Every poop is a flap", "strained");
  const poops = lessonCount.poops;
  const flew = await until(() => lessonCount.poops - poops >= 3, 20_000);
  if (flew === null) return abandon();
  if (flew && !tutorialSkipped) {
    say("Nice flying!", "", null, true);
    if ((await until(() => false, 1200)) === null) return abandon();
  }

  // Seen from here on, so a player who crashes soon after doesn't get the whole lesson again.
  markTutorialSeen("city", lock);
  // The street stops bouncing once the bird is clear of it (or after a while), so the handoff isn't a crash.
  // The last line stays up until then; the buildings that follow are for the player to discover.
  const clear = (): boolean => game.bird.y + BIRD_RADIUS < GROUND_Y - 120;
  // Not skippable: a skipped lesson still waits (without the coach) for the bird to be clear of the street.
  if ((await until(clear, 8000, false)) === null) return abandon();
  game.calmCity = false;
  releaseCoach(owner);
}

/** Moves the webcam preview into the calibration card, or back to its corner. */
function dockCam(inCalib: boolean): void {
  if (inCalib === cam.classList.contains("in-calib")) return;
  cam.classList.toggle("in-calib", inCalib);
  if (inCalib) $("calib-cam-slot").append(cam);
  else camHome.before(cam);
}

function toggleMute(): void {
  saveMuted(sound.toggleMute());
  updateMuteButton();
  showToast(sound.muted ? "🔇 Muted" : "🔊 Sound on", 1200);
}

function updateMuteButton(): void {
  const btn = $("btn-hud-mute");
  btn.textContent = sound.muted ? "🔇" : "🔊";
  btn.setAttribute("aria-label", sound.muted ? "Unmute" : "Mute");
  decorate(btn);
}

/** Stops the looping sounds (the strain groan and the puff burble). */
function silenceLoops(): void {
  sound.setGroan(-1, false);
  sound.setBurble(-1);
}

/** Abandons every async flow (camera startup, calibration, lessons) and any face sampling. */
function endFlows(): void {
  flow++;
  calibSamples = null;
  calibFrames = null;
}

function togglePause(): void {
  if (state === "playing") {
    state = "paused";
    showScreen("pause");
    silenceLoops();
  } else if (state === "paused") {
    state = "playing";
    showScreen(null);
  }
}

let tagline = -1;

/** Shows a new tagline on the start screen. */
function newTagline(): void {
  tagline = pickTagline(tagline);
  const { text, code } = TAGLINES[tagline];
  const el = $("tagline");
  if (code) {
    const c = document.createElement("code");
    c.textContent = text;
    el.replaceChildren(c);
  } else {
    el.textContent = text;
  }
}
newTagline();

function goToMenu(): void {
  endFlows();
  tracker.stopCamera();
  state = "menu";
  silenceLoops();
  hideToast();
  claimCoach();
  cam.classList.remove("large");
  show(cam, false);
  show(hud, false);
  game.startDemo();
  newTagline();
  showScreen("start");
}

function onGameOver(): void {
  state = "gameover";
  silenceLoops();
  hideToast();
  claimCoach();
  sound.sadTrombone();
  const score = game.score;
  const newBest = score > best;
  if (newBest) {
    best = score;
    saveBest(best);
  }
  showRunStats(game, best, newBest);

  currentSnapshotUrl = mode === "face" ? snapshot.toDataURL() : null;
  show($("go-snapshot"), currentSnapshotUrl !== null);
  show($("go-snapshot-actions"), currentSnapshotUrl !== null);
  if (currentSnapshotUrl) $<HTMLImageElement>("go-snapshot-img").src = currentSnapshotUrl;
  $("go-strain").textContent = String(strainPercent(snapshot.peakStrain));
  showRunPhotos(game, renderer.photos, currentSnapshotUrl !== null);
  // Only runs played with the face count: keyboard and touch runs can't be submitted.
  offerRun(mode !== "face" ? null : {
    score,
    stats: { targets: game.targetsHit, distance: Math.round(game.distance / 50), bestCombo: game.bestCombo },
    face: currentSnapshotUrl ? { url: currentSnapshotUrl, strain: snapshot.peakStrain } : null,
  });
  showScreen("gameover");
}

/** The start screen's 🏆: both boards over the demo. */
function openLeaderboard(): void {
  showScreen("leaderboard");
  void showBoards($("lb-full"), { limit: 20 });
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
    replayAnimation(comboEl);
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
/** Main-thread timings for the debug panel: frame-to-frame gap, simulation, drawing, and the whole frame. */
const frameTiming = { gap: new RollingTiming(), step: new RollingTiming(), draw: new RollingTiming(), frame: new RollingTiming() };

function frame(now: number): void {
  const frameStart = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
  frameTiming.gap.add(now, now - lastTime);
  lastTime = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;

  updateRotatePrompt();
  const stepStart = performance.now();
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

  const drawStart = performance.now();
  frameTiming.step.add(drawStart, drawStart - stepStart);
  renderer.mouthOpen = mode === "face" && faceFresh() && !game.demo ? mouthOpen : 0;
  renderer.draw(game, state === "playing" || game.demo ? dt : 0);
  const drawEnd = performance.now();
  frameTiming.draw.add(drawEnd, drawEnd - drawStart);

  const charging = (state === "playing" || state === "ready") && game.phase === "playing" && game.charge.charge > 0 && !game.stunned;
  if (state !== "calibrating") sound.setGroan(charging ? game.charge.charge : -1, game.overstrainProgress > 0);
  sound.setBurble(state === "playing" && game.swimming && !game.stunned ? game.fish.puff : -1);

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
  // Stage music, from take-off until the crash: none on the perch, and it stops as the bird
  // goes down rather than at the game-over screen. The shark brings its own.
  const musicPlays = (state === "playing" || state === "paused") && game.phase === "playing";
  sound.setMusic(
    musicPlays && game.sharkTheme === null ? game.stage : null,
    config.musicVolume * (state === "paused" ? config.musicPausedVolume : 1),
  );

  updateHud();
  updateStrainBars();
  // The panel's own DOM work is left out of the frame time.
  const frameEnd = performance.now();
  frameTiming.frame.add(frameEnd, frameEnd - frameStart);
  debug?.update({
    fps,
    detectionRate: tracker.ready ? tracker.detectionRate : 0,
    delegate: tracker.delegate ? `${tracker.delegate}${tracker.inWorker ? " worker" : ""}` : "–",
    appState: state,
    graphics: renderer.graphics,
    perf: {
      gap: frameTiming.gap.stats(frameEnd),
      step: frameTiming.step.stats(frameEnd),
      draw: frameTiming.draw.stats(frameEnd),
      frame: frameTiming.frame.stats(frameEnd),
      detect: tracker.detectTiming.stats(frameEnd),
      mediapipe: tracker.mediapipeTiming.stats(frameEnd),
      latency: tracker.latencyTiming.stats(frameEnd),
      faceIdMs: recognizer.lastMs,
      canvas: `${canvas.width}×${canvas.height} px, device dpr ${(window.devicePixelRatio || 1).toFixed(2)}`,
    },
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

/** The player's face right now, cropped from the webcam (null in keyboard mode or without a fresh face). */
function playerFace(): Photo | null {
  return mode === "face" && faceFresh() ? captureFace(videoImage(video), lastFace?.box ?? null) : null;
}

/** The player's face at the wedding's kiss (face mode): it ends up on the bird in the wedding photo. */
let weddingFace: Photo | null = null;

/** Sound and haptics for each event (feedback.ts), and what it means for the app. */
function handleGameEvents(): void {
  for (const e of game.events) {
    playFeedback(sound, e);
    switch (e.type) {
      case "release":
        lessonCount.poops++;
        break;
      case "accident":
        lessonCount.accidents++;
        lessonCount.lastAccident = performance.now();
        break;
      case "gameover":
        onGameOver();
        break;
      case "gateEntered":
        // Keyboard players start the ocean at the hover point; in face mode the face decides.
        keyPuff = e.to === "ocean" && mode === "keyboard" ? config.oceanHoverPuff : 0;
        break;
      case "submerged":
        onSubmerged();
        break;
      case "photo": {
        // The paparazzo's shot: the player's real face in face mode (like the
        // finest-strain snapshot), otherwise the strained bird. Kept for this run only.
        const photo = playerFace() ?? renderer.captureBird(game);
        if (photo) renderer.photos.set(e.photoId, photo);
        break;
      }
      case "weddingKiss":
        // Grab the face now: a player who's on it is straining hardest right at "KISS!".
        weddingFace = playerFace();
        break;
      case "weddingPhoto": {
        const photo = renderer.captureWedding(game, weddingFace);
        if (photo) renderer.photos.set(e.photoId, photo);
        weddingFace = null;
        break;
      }
      case "anglerLanded": {
        const photo = renderer.captureTrophy(game);
        if (photo) renderer.photos.set(e.photoId, photo);
        break;
      }
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
  // Esc closes the settings too. Done takes Enter, and a screen's yellow button takes no other key (keyhints.ts).
  if (e.key === "Escape" && !settingsPanel.classList.contains("hidden")) {
    e.preventDefault();
    if (!e.repeat && performance.now() >= buttonKeysArmedAt) pressFromKey($<HTMLButtonElement>("btn-settings-done"));
    return;
  }
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
    default:
      // With the debug panel open, mid-run: spawn something right now.
      if (debug?.visible && state === "playing") DEBUG_SPAWNS[key]?.();
  }
});

/** Debug shortcuts (the debug panel open, mid-run): what comes on next, right now. */
const DEBUG_SPAWNS: Partial<Record<string, () => void>> = {
  g: () => game.spawnShoreNow(), // the stage's waterfront
  l: () => game.spawnPowerLineNow(),
  f: () => game.spawnPaparazzoNow(),
  k: () => game.spawnKidNow(), // a slingshot kid
  w: () => game.spawnWeddingNow(),
  b: () => game.spawnBalloonNow(),
  h: () => game.spawnAnglerNow(), // a fisherman (ocean)
  j: () => game.spawnSharkNow(), // J for Jaws (ocean): S opens the settings
  a: () => game.spawnAnchorDropNow(), // a boat that drops its anchor (ocean)
};

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
  // The render loop stops in a hidden tab, so it can't fade the music out itself.
  if (document.hidden) sound.setMusic(null, 0);
});
window.addEventListener("resize", () => game.resize(renderer.resize()));

// --- Buttons -------------------------------------------------------------------------------

decorateAll();
const on = (id: string, fn: () => void) => $(id).addEventListener("click", fn);
/** A button that starts playing: on phones it goes fullscreen in landscape first (it must, inside the tap). */
const onPlay = (id: string, fn: () => void) => on(id, () => {
  goLandscape();
  fn();
});

// Settings (the gear, top right): the graphics style, the music, the remembered faces, and from the menu,
// playing without the camera. Opening it mid-run pauses the game.
const settingsPanel = $("screen-settings");
const rtxSwitch = $<HTMLInputElement>("opt-rtx");
const musicSwitch = $<HTMLInputElement>("opt-music");
function openSettings(fromMenu: boolean): void {
  if (state === "playing") togglePause();
  rtxSwitch.checked = renderer.graphics === "rtx";
  musicSwitch.checked = sound.musicEnabled;
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
musicSwitch.addEventListener("change", () => {
  sound.setMusicOn(musicSwitch.checked);
  saveMusic(musicSwitch.checked);
});
on("btn-forget-faces", forgetFaces);
onPlay("btn-face", () => void startFaceMode());
onPlay("btn-keyboard", () => {
  show(settingsPanel, false);
  startKeyboardMode();
});
on("btn-hud-mute", toggleMute);
on("btn-hud-pause", togglePause);
on("btn-loading-retry", () => void startFaceMode());
on("btn-loading-keyboard", startKeyboardMode);
onPlay("btn-calib-go", () => {
  calib.pressed = true;
});
on("btn-calib-skip", () => {
  calib.skipped = true;
});
on("btn-calib-cancel", goToMenu);
on("btn-perch-menu", goToMenu);
on("btn-tune", () => void recalibrate());
onPlay("btn-perch-keyboard", startKeyboardMode);
on("btn-resume", togglePause);
on("btn-pause-menu", goToMenu);
onPlay("btn-again", () => {
  // Someone new took over mid-run: they calibrate first.
  if (mode === "face" && faceId.status === "new") void runCalibration(false);
  else startReady();
});
on("btn-go-calibrate", () => void recalibrate());
on("btn-go-menu", goToMenu);
on("coach-skip", () => {
  // Not while paused: Enter there mustn't skip the lesson underneath.
  if (state !== "playing") return;
  if (activeLesson) markTutorialSeen(activeLesson.tutorial, activeLesson.lock);
  tutorialSkipped = true;
  // Space puffs and flaps: it mustn't press this button again.
  $("coach-skip").blur();
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

// --- Phones: landscape ---------------------------------------------------------------------

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
