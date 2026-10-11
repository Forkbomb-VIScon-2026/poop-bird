// App glue: screens, input, the fixed-timestep game loop, face tracking,
// calibration (strain, and puff at the first dive), sound and the debug panel.

import "./style.css";
import { config } from "./config";
import { Sound } from "./audio";
import { DebugPanel } from "./debug";
import { DEBUG } from "./env";
import { FaceTracker, describeCameraError, type FaceBox, type FaceFrame } from "./face";
import { FaceRecognizer, alignedFaceCrop } from "./faceid";
import { BIRD_RADIUS, GROUND_Y, Game, OCEAN_MID_Y, VIEW_H, wireAt } from "./game";
import { buttonForKey, decorate, decorateAll, keyBlocked, keyName, pressFromKey } from "./keyhints";
import { playFeedback } from "./feedback";
import { Renderer, type Photo } from "./render";
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
  loadMuted,
  loadKnownFacesJson,
  loadSeenTutorials,
  saveBest,
  saveCalibration,
  saveGraphics,
  saveMuted,
  saveKnownFacesJson,
  saveSeenTutorials,
  storageRemove,
  TUTORIALS,
  type Tutorial,
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
  neutralFaceStats,
  neutralFalseRate,
  smoothStrain,
  stepStrain,
  strainedness,
  topFeatureLabels,
  type Calibration,
  type FeatureVector,
} from "./strain";
import { claimCoach, coachProgress, coachSay, dockCoach, markTimeline, releaseCoach, showTimeline, type CoachFace, type CoachLine } from "./ui/coach";
import { $, isTouch, replayAnimation, show, wait } from "./ui/dom";
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
/** Where #cam lives in the DOM when it isn't docked beside the bird on the perch. */
const camHome = { parent: cam.parentElement!, next: cam.nextElementSibling };
const rotateScreen = $("screen-rotate");

document.body.classList.toggle("touch", isTouch);

function showScreen(name: keyof typeof screens | null): void {
  for (const [k, el] of Object.entries(screens)) show(el, k === name);
  dockCam(name === "ready" && mode === "face");
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
  | "menu" | "loading" | "calibrating" | "calibrated" | "ready" | "playing" | "paused" | "gameover";
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
/** `calibration` is the default one, fitted to a quick relaxed-face read and never saved. */
let calibrationIsDefault = false;
/** Puff calibration (neutral vs. full puff), on top of the fixed pucker range. null = the pucker range alone. */
let puffCalibration: Calibration | null = loadCalibration(PUFF_CALIBRATION_KEY, PUFF_FEATURES);
/** The puff calibration ran (and passed or failed) this session; later dives skip it. Reset by C. */
let puffCalibrationTried = false;
/** The last puff calibration attempt, passed or not (console: poopyBird.lastPuffAttempt). */
let lastPuffAttempt: { cal: Calibration; quality: ReturnType<typeof assessPuffCalibration> } | null = null;
/** Flow token of the puff calibration in progress, if any. */
let activePuffCalibration: number | null = null;
/** Set when a different face got locked mid puff calibration: there's no relaxed read of them to compare with, so it's abandoned. */
let abortPuffCalibration = false;
/** The coach claim of the puff calibration in progress. */
let puffCoach = 0;
/** The coach claim of the perch. */
let perchCoach = 0;
/** Poops and accidents this run, for the city lesson. */
const lessonCount = { poops: 0, accidents: 0, lastAccident: -Infinity };
/** A calibration that failed the quality check; used only if the player picks "Play anyway". */
let rejectedCalibration: Calibration | null = null;
/** Whether the calibration result screen is showing a failed calibration. */
let calibrationFailed = false;
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
/** While the swim lesson shows a step: the puff the fish is driven to, whatever the face does. null = the player's puff. */
let scriptTarget: number | null = null;
/** The scripted puff, easing toward scriptTarget at SCRIPT_RATE per second. */
let scriptedPuff = 0;
const SCRIPT_RATE = 1.2;
/** Scripted puff on puff steps (it floats) and on relax steps (it sinks). */
const SCRIPT_PUFF = 0.75;
const SCRIPT_RELAX = 0.05;
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
/** Tutorials already shown (kept in memory too, so they show once per session even without storage). */
const seenTutorials = loadSeenTutorials();

sound.setMuted(loadMuted());

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
  if (scriptTarget !== null) return scriptedPuff;
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
  if (state === "calibrating") void runCalibration();
  // The default calibration was fitted to the previous face's relaxed read. With face
  // recognition any calibration may be the previous face's: the perch reads the new
  // one, and recognition gives them theirs back if they're known.
  else if (state === "ready" && (calibrationIsDefault || faceIdWorks())) void runDefaultCalibration();
  if (activePuffCalibration !== null) abortPuffCalibration = true;
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
    // Someone new took over mid-run: the puff calibration is someone else's, so the next dive samples theirs.
    if (!faceId.puff && puffCalibration && activePuffCalibration === null) {
      puffCalibration = null;
      puffCalibrationTried = false;
      puffSignal = initialPuffState();
    }
  }
  rememberFace();
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
  if (forceCalibrate) await runCalibration();
  // Without face recognition a saved full calibration is used, whoever plays. With it, the
  // face decides: the perch reads the face, and recognition gives a known face its own back.
  else if (calibration && !calibrationIsDefault && !faceIdWorks()) startReady();
  else await runDefaultCalibration();
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

async function runCalibration(): Promise<void> {
  const token = ++flow;
  // A new player (or a fresh start): the next dive samples their puff again.
  clearPuffCalibration();
  state = "calibrating";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  cam.classList.add("large");
  show($("calib-result"), false);
  show($("btn-calib-keyboard"), false);
  show($("calib-run"), true);

  const neutral = await calibrationPhase(token, 1, "Relax your face", "Neutral face. Look at the screen and relax completely.", false);
  if (token !== flow) return;
  const strained = await calibrationPhase(
    token, 2, "STRAIN! Like you're really constipated 💩",
    "Brows down, eyes squeezed, nose wrinkled, lips pressed. Hold it!", true,
  );
  if (token !== flow) return;

  const cal = buildCalibration(featureStats(neutral.samples), featureStats(strained.samples), config);
  const quality = assessCalibration(cal, neutral.samples, strained.samples, config, {
    neutral: neutral.coverage,
    strain: strained.coverage,
  });
  console.info("[calibration]", { cal, quality, neutral, strained });
  // Only a calibration that passed the check replaces the saved one.
  if (quality.ok) {
    calibration = cal;
    calibrationIsDefault = false;
    rejectedCalibration = null;
    saveCalibration(CALIBRATION_KEY, cal);
    rememberStrain(cal, false);
  } else {
    rejectedCalibration = quality.totalChange > 0 ? cal : null;
  }
  strain = initialStrainState();
  if (!quality.ok) {
    showCalibrationResult(quality);
    return;
  }
  // Straight back onto the perch to try it out.
  startReady();
  showToast(`Tuned to your face 💪 Watching your ${topFeatureLabels(cal).join(", ")}`, 3500);
}

/**
 * The start without calibration: the bird's perch opens right away and the
 * default calibration is fitted to a short read of the player's relaxed face.
 * It's never saved for the browser, so the next player gets their own read;
 * face recognition remembers it for this face, for this tab. Tuning from the
 * perch replaces it. A face recognized as known (now, or during the read)
 * gets its own calibrations back instead.
 */
async function runDefaultCalibration(): Promise<void> {
  // A new player: the next dive samples their puff again.
  clearPuffCalibration();
  calibration = null;
  calibrationIsDefault = true;
  rejectedCalibration = null;
  faceId.strain = null;
  strain = initialStrainState();
  startReady();
  const token = flow;
  if (faceId.known) adoptKnownFace(faceId.known);
  if (!calibration) enterPerchStep("reading");
  // A read whose own samples would trip the meter (fidgeting, blinking,
  // jittery tracking) is read again. The last try is kept regardless, since
  // the player can always calibrate.
  for (let attempt = 1; !calibration; attempt++) {
    // A calibration turning up meanwhile came from recognition: no need to read on.
    const neutral = await readRelaxedFace(token, () => calibration !== null);
    if (token !== flow) return;
    if (!neutral) {
      if (calibration) break;
      return;
    }
    const cal = defaultCalibration(neutralFaceStats(neutral), config.defaultStrainScale);
    const falseRate = neutralFalseRate(cal, neutral, config);
    console.info("[default calibration]", { cal, falseRate, attempt, neutral });
    if (falseRate <= MAX_NEUTRAL_FALSE_RATE || attempt >= MAX_RELAXED_READS) {
      calibration = cal;
      rememberStrain(cal, true);
      break;
    }
    perchHint("Hold still…", 10_000);
  }
  strain = initialStrainState();
  enterPerchStep(seenTutorials.has("perch") ? "go" : "strain");
}

/** Relaxed-face reads before the default calibration takes the last one, steady or not. */
const MAX_RELAXED_READS = 3;

/** Fewest face samples the relaxed-face read takes, so a slow detector just reads for longer. */
const MIN_RELAXED_SAMPLES = 8;

/**
 * Samples the relaxed face for at least `defaultNeutralSeconds` and
 * MIN_RELAXED_SAMPLES face frames. Starts over if too few frames had a face
 * (no one in view yet). null = abandoned, or `done` turned true.
 */
async function readRelaxedFace(token: number, done?: () => boolean): Promise<FeatureVector[] | null> {
  const total = config.defaultNeutralSeconds * 1000;
  let start = performance.now();
  let mine = startSampling();
  for (; ;) {
    await wait(50);
    if (token !== flow || calibSamples !== mine.samples || !calibFrames || done?.()) {
      stopSampling(mine.samples);
      return null;
    }
    if (performance.now() - start < total) continue;
    if (mine.samples.length < mine.frames.length * config.minFaceCoverage) {
      start = performance.now();
      mine = startSampling();
    } else if (mine.samples.length >= MIN_RELAXED_SAMPLES) {
      break;
    }
  }
  stopSampling(mine.samples);
  return mine.samples.map((s) => s.f);
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

interface PhaseResult {
  samples: FeatureVector[];
  /** Fraction of detection frames after the settle time that had a face. */
  coverage: number;
}

async function calibrationPhase(
  token: number, step: number, prompt: string, hint: string, strainPhase: boolean,
): Promise<PhaseResult> {
  const card = screens.calibrate.querySelector(".calib")!;
  const count = $("calib-count");
  const progress = $("calib-progress");
  $("calib-step").textContent = `Calibration ${step}/2`;
  $("calib-prompt").textContent = step === 1 ? "Get ready to relax…" : "Get ready to STRAIN…";
  $("calib-hint").textContent = hint;
  $("calib-face-use").setAttribute("href", strainPhase ? "#face-strained" : "#face-relaxed");
  card.classList.remove("strain");
  progress.style.width = "0%";
  for (let i = 2; i > 0; i--) {
    count.textContent = String(i);
    await wait(600);
    if (token !== flow) return { samples: [], coverage: 0 };
  }

  $("calib-prompt").textContent = prompt;
  card.classList.toggle("strain", strainPhase);
  const total = config.calibrationSeconds * 1000;
  const settle = config.calibrationSettle * 1000;
  const start = performance.now();
  const mine = startSampling();
  while (performance.now() - start < total) {
    if (token !== flow) {
      stopSampling(mine.samples);
      sound.setGroan(-1, false);
      return { samples: [], coverage: 0 };
    }
    const elapsed = performance.now() - start;
    count.textContent = String(Math.ceil((total - elapsed) / 1000));
    progress.style.width = `${(elapsed / total) * 100}%`;
    if (strainPhase) sound.setGroan(Math.min(1, elapsed / total), false);
    await wait(50);
  }
  if (strainPhase) sound.setGroan(-1, false);
  progress.style.width = "100%";
  const samples = mine.samples.filter((s) => s.t - start >= settle).map((s) => s.f);
  const frames = mine.frames.filter((t) => t - start >= settle).length;
  stopSampling(mine.samples);
  card.classList.remove("strain");
  return { samples, coverage: frames > 0 ? samples.length / frames : 0 };
}

/** A calibration that failed the quality check: try again, or play with it anyway. */
function showCalibrationResult(result: ReturnType<typeof assessCalibration>): void {
  state = "calibrated";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  cam.classList.add("large");
  show($("calib-run"), false);
  show($("calib-result"), true);
  show($("btn-calib-keyboard"), true);
  const playBtn = $<HTMLButtonElement>("btn-calib-play");
  const retryBtn = $<HTMLButtonElement>("btn-calib-retry");
  screens.calibrate.querySelector(".calib")!.classList.remove("strain");
  $("calib-step").textContent = "Calibration";
  armButtonKeys(300);
  $("calib-prompt").textContent = "Hmm, that didn't work well";
  $("calib-result-text").textContent = result.reason ?? "Try again.";
  setPrimary(retryBtn, playBtn);
  calibrationFailed = true;
  retryBtn.textContent = "Try again";
  playBtn.textContent = "Play anyway";
  decorate(playBtn);
  decorate(retryBtn);
  playBtn.disabled = !(rejectedCalibration ?? calibration);
}

function setPrimary(primary: HTMLElement, secondary: HTMLElement): void {
  primary.classList.add("primary");
  secondary.classList.remove("primary");
}

/** Debug: delete both saved calibrations and the known faces, and reload, to test the first-time flow. */
function forgetCalibration(): void {
  storageRemove(CALIBRATION_KEY);
  storageRemove(PUFF_CALIBRATION_KEY);
  saveKnownFacesJson(null);
  location.reload();
}

// --- Puff calibration (first dive, in game) ---------------------------------------------

function clearPuffCalibration(): void {
  puffCalibration = null;
  puffCalibrationTried = false;
  // A known face's remembered one may still come back (adoptKnownFace).
  faceId.puff = null;
  puffSignal = initialPuffState();
  storageRemove(PUFF_CALIBRATION_KEY);
}

/** The next dive samples the player's puff: face mode, nothing saved, not tried yet this session. */
function needsPuffCalibration(): boolean {
  return mode === "face" && tracker.ready && puffCalibration === null && !puffCalibrationTried;
}

/**
 * One step of the swim lesson or the puff calibration: the fish shows it (a
 * puff step blows it up so it floats, the others shrink it so it sinks), and
 * the face is sampled as a puff or as relaxed. Puff steps last
 * oceanCalibrationSeconds, the others oceanRelaxSeconds, unless the step has
 * its own `seconds`.
 */
interface PuffStep {
  kind: "relax" | "look" | "puff";
  /** Short name, for the heads-up and the timeline. */
  label: string;
  title: string;
  hint: string;
  /** The step's length in s, read when it starts (default: by kind, see above). */
  seconds?: () => number;
}

/**
 * The swim lesson, right after the dive: one puff/relax cycle after a relaxed
 * moment, while the world swims on in calm water. The relax step right after
 * the puff matters most: a face just after a puff doesn't go back to the
 * relaxed face from before it, and the calibration has to know what that looks
 * like, or the fish won't sink (see buildInteractivePuffCalibration). So it
 * lasts oceanLessonLetOutSeconds, longer than the other steps: in the face
 * dataset a second cycle sent more players into the calibration than it
 * saved, but one player's fish wouldn't sink after a single short one.
 */
const LESSON_STEPS: readonly PuffStep[] = [
  { kind: "relax", label: "Relax", title: "Swim, little pufferfish! 🐡", hint: "Keep your face relaxed for a moment…" },
  { kind: "puff", label: "Pucker & puff", title: "Pucker & puff!", hint: "Purse your lips and puff your cheeks: the fish blows up and floats." },
  {
    kind: "relax",
    label: "Let it out",
    title: "Let it out",
    hint: "Relax your cheeks and lips: the fish shrinks and sinks.",
    seconds: () => config.oceanLessonLetOutSeconds,
  },
];

/**
 * The calibration, when the lesson's reading wasn't clear: with a look-around
 * (so features that move with the head don't count as a puff) and a timeline
 * of the steps, and the fish shows each step.
 */
const CALIBRATION_STEPS: readonly PuffStep[] = [
  { kind: "relax", label: "Relax", title: "Relax", hint: "Relaxed face, lips loose." },
  { kind: "look", label: "Look around", title: "Look around 👀", hint: "Keep your face relaxed and look around the screen." },
  { kind: "puff", label: "Pucker & puff", title: "Pucker & puff!", hint: "Purse your lips and puff your cheeks. Hold it." },
  { kind: "relax", label: "Let it out", title: "Let it out", hint: "Let the air out and relax your lips completely." },
  { kind: "puff", label: "Pucker & puff", title: "Again: pucker & puff!", hint: "The same pufferfish face. Hold it." },
  { kind: "relax", label: "Let it out", title: "And let it out", hint: "Air out, lips loose." },
];

/**
 * The first dive in face mode. The fish swims on right away in calm water (no
 * obstacles; see Game.calmWater) while banners, each with a pictogram of the
 * face to make, walk the player through LESSON_STEPS. The fish follows the
 * measured puff meanwhile (the pucker range, as there's no puff calibration
 * yet), and the face is sampled. With a clear reading (assessPuffCalibration)
 * the calibration is used right away and the level starts; if not,
 * CALIBRATION_STEPS run (oceanPuffCalibrationAttempts times at most, then the
 * pucker range alone), and there the fish shows each step whatever the face
 * does. New players then get the ocean tips as banners. Belongs to the current
 * run's flow token, so going to the menu or recalibrating abandons it (the
 * next run resets the game).
 */
async function runSwimLesson(): Promise<void> {
  const token = flow;
  activePuffCalibration = token;
  puffCoach = claimCoach();
  // Cleared once per lesson, not per step: a new face between steps still aborts.
  abortPuffCalibration = false;
  game.calmWater = true;
  scriptTarget = null;
  puffSignal = initialPuffState();
  // Let the dive finish: the fish lands and swims, then the lesson starts.
  while (game.transition && token === flow) await wait(50);

  const attempts = Math.max(1, Math.round(config.oceanPuffCalibrationAttempts));
  let steps = LESSON_STEPS;
  let calibrationRuns = 0;
  let why = "";
  for (; ;) {
    const lesson = steps === LESSON_STEPS;
    if (!lesson) {
      calibrationRuns++;
      scriptedPuff = game.fish.puff;
      scriptTarget = SCRIPT_RELAX;
      setPuffOverlay("Let's calibrate 🐡", `${why} Follow the steps above.`, null);
      showTimeline(steps);
      if (!(await waitPlaying(token, 3500))) return abandonPuffCalibration(token);
    }
    const headsUp = lesson ? config.oceanLessonHeadsUp : config.oceanCalibrationHeadsUp;
    const result = await runPuffSteps(token, steps, headsUp, !lesson);
    if (!result) return abandonPuffCalibration(token);
    scriptTarget = null;
    showTimeline(null);

    const { relaxed, puffs, coverage } = result;
    const cal = buildInteractivePuffCalibration(relaxed, puffs, config);
    const quality = cal
      ? assessPuffCalibration(cal, puffs, { strain: coverage }, { ...config, minSinkRate: config.oceanPuffMinSinkRate }, relaxed)
      : null;
    console.info("[puff calibration]", { steps: lesson ? "lesson" : "calibration", cal, quality });
    lastPuffAttempt = cal && quality ? { cal, quality } : null;

    if (cal && quality?.ok) {
      puffCalibration = cal;
      puffCalibrationTried = true;
      puffSignal = initialPuffState();
      saveCalibration(PUFF_CALIBRATION_KEY, cal);
      rememberPuff(cal);
      showToast(`Puff calibrated! 🐡 Watching your ${topFeatureLabels(cal).join(", ")}`, 3500);
      break;
    }
    const reason = quality?.reason ?? "couldn't see your face";
    if (calibrationRuns >= attempts) {
      puffCalibrationTried = true;
      const fallback = puffCalibration ? "keeping your saved puff" : "pursed lips only";
      showToast(`Couldn't read your puff (${reason}): ${fallback}. Recalibrate with C.`, 4000);
      break;
    }
    why = `Couldn't read your pufferfish face yet (${reason}).`;
    steps = CALIBRATION_STEPS;
  }
  if (!seenTutorials.has("ocean")) {
    if (!(await oceanTipBanners(token))) return abandonPuffCalibration(token);
    markTutorialSeen("ocean");
  } else if (!(await swimToMiddle(token))) return abandonPuffCalibration(token);
  // The level starts. A relaxed player's fish may lie on the sand: the sea floor spares it until it swims off (Game).
  endPuffCalibrationOverlay(token);
  game.calmWater = false;
}

/**
 * Without the tips, the level would start wherever the lesson left the fish
 * (often on the sea floor or at the surface). So it swims to the middle on its
 * own first (Game.guideY), under a heads-up banner. false = abandoned.
 */
async function swimToMiddle(token: number): Promise<boolean> {
  // A heads-up, not a step: no progress bar.
  coachSay(puffCoach, { title: "GET READY! 🐡", hint: "Here come the rocks.", face: null, bar: false });
  game.guideY = OCEAN_MID_Y;
  try {
    // At least a moment to read the banner; at most long enough to cross the whole sea.
    for (let t = 0; t < 4000; t += 50) {
      if (!(await waitPlaying(token, 50))) return false;
      const there = Math.abs(game.bird.y - OCEAN_MID_Y) < 15 && Math.abs(game.bird.vy) < 25;
      if (t >= 1500 && there) break;
    }
  } finally {
    game.guideY = null;
  }
  return true;
}

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

/** The lesson or calibration was abandoned (new face, or the run ended). */
function abandonPuffCalibration(token: number): void {
  scriptTarget = null;
  if (token !== flow) return endPuffCalibrationOverlay(token);
  // A different face got locked: this run uses the default puff.
  endPuffCalibrationOverlay(token);
  puffCalibration = null;
  puffCalibrationTried = true;
  puffSignal = initialPuffState();
  game.calmWater = false;
  showToast("New face: using default puff. Recalibrate (C) to tune it.", 3500);
}

/**
 * Runs `steps` once, with a heads-up countdown of `headsUp` s whenever the
 * player has to switch between puffing and not. `scripted`: the fish shows
 * each step instead of following the face. null = abandoned.
 */
async function runPuffSteps(
  token: number,
  steps: readonly PuffStep[],
  headsUp: number,
  scripted: boolean,
): Promise<{ relaxed: FeatureVector[]; puffs: FeatureVector[]; coverage: number } | null> {
  const relaxed: FeatureVector[] = [];
  const puffs: FeatureVector[] = [];
  let coverage = 1;
  for (const [i, step] of steps.entries()) {
    const prev = steps[i - 1];
    if (prev && headsUp > 0 && (prev.kind === "puff") !== (step.kind === "puff")) {
      if (!(await headsUpCountdown(token, step, headsUp))) return null;
    }
    markTimeline(i);
    const puff = step.kind === "puff";
    setPuffOverlay(step.title, step.hint, puff ? "puffed" : "relaxed");
    if (scripted) scriptTarget = puff ? SCRIPT_PUFF : SCRIPT_RELAX;
    const seconds = step.seconds?.() ?? (puff ? config.oceanCalibrationSeconds : config.oceanRelaxSeconds);
    const phase = await puffCalibrationPhase(token, seconds, puff);
    if (!phase || token !== flow) return null;
    (puff ? puffs : relaxed).push(...phase.samples);
    coverage = Math.min(coverage, phase.coverage);
  }
  markTimeline(steps.length);
  return { relaxed, puffs, coverage };
}

/** "PUCKER & PUFF IN 3… 2… 1…", with the next step's face. false = abandoned. */
async function headsUpCountdown(token: number, next: PuffStep, seconds: number): Promise<boolean> {
  const puff = next.kind === "puff";
  const hint = puff ? "Get ready to purse your lips and puff your cheeks." : "Get ready to let the air out and relax your lips.";
  const total = seconds * 1000;
  const clock = playingClock();
  coachProgress(0);
  for (let left = total; left > 0; ) {
    if (puffLessonAbandoned(token)) return false;
    left = total - clock();
    setPuffOverlay(`${next.label} in ${Math.max(1, Math.ceil(left / 1000))}…`, hint, puff ? "puffed" : "relaxed");
    coachProgress(1 - Math.max(0, left) / total);
    await wait(50);
  }
  return true;
}

/** Waits `ms` of playing time (pauses don't count). false = abandoned. */
async function waitPlaying(token: number, ms: number): Promise<boolean> {
  const clock = playingClock();
  while (clock() < ms) {
    if (puffLessonAbandoned(token)) return false;
    await wait(50);
  }
  return true;
}

/** A stopwatch of playing time in ms: it stands still while the game is paused. */
function playingClock(): () => number {
  let elapsed = 0;
  let last = performance.now();
  return () => {
    const now = performance.now();
    if (state === "playing") elapsed += now - last;
    last = now;
    return elapsed;
  };
}

/** The swim lesson (or the keyboard tips) of `token` was left, or a new face aborted it (which this acknowledges). */
function puffLessonAbandoned(token: number): boolean {
  if (token === flow && !abortPuffCalibration) return false;
  abortPuffCalibration = false;
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

/**
 * Collects one step's samples for `seconds`, dropping the settle time. Pausing
 * restarts the step after resume. `burble` plays the puffing sound. null = abandoned.
 */
async function puffCalibrationPhase(token: number, seconds: number, burble: boolean): Promise<PhaseResult | null> {
  const total = seconds * 1000;
  const settle = config.calibrationSettle * 1000;
  let start = -1;
  let mine: ReturnType<typeof startSampling> | null = null;
  for (; ;) {
    if (puffLessonAbandoned(token)) {
      stopSampling(mine?.samples ?? null);
      return null;
    }
    if (state !== "playing") {
      // Paused: start over after resuming, so the samples are one continuous step.
      start = -1;
      stopSampling(mine?.samples ?? null);
      mine = null;
      coachProgress(0);
      await wait(50);
      continue;
    }
    const now = performance.now();
    if (start < 0) {
      start = now;
      mine = startSampling();
    }
    const elapsed = now - start;
    if (elapsed >= total) break;
    coachProgress(elapsed / total);
    sound.setBurble(burble ? elapsed / total : -1);
    await wait(50);
  }
  coachProgress(1);
  sound.setBurble(-1);
  const samples = (mine?.samples ?? []).filter((s) => s.t - start >= settle).map((s) => s.f);
  const frames = (mine?.frames ?? []).filter((t) => t - start >= settle).length;
  stopSampling(mine?.samples ?? null);
  return { samples, coverage: frames > 0 ? samples.length / frames : 0 };
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
 * The bird just turned into a deflated fish. In face mode, the swim lesson
 * when there's no puff calibration yet or the player is new (it ends with the
 * ocean tips); a new keyboard player gets the tips as banners over calm
 * water. Everyone else swims right into the level.
 */
function onSubmerged(): void {
  const tutorial = !seenTutorials.has("ocean");
  if (needsPuffCalibration() || (tutorial && mode === "face" && tracker.ready)) void runSwimLesson();
  else if (tutorial && mode === "keyboard") void runKeyboardOceanTips();
  else if (mode === "keyboard") showToast(isTouch ? "Hold the screen to puff up 🐡" : "Hold SPACE to puff up 🐡");
}

/**
 * A new keyboard player's first dive: the fish swims on in calm water (see
 * Game.calmWater) under banners on how to puff and the ocean tips, then the
 * level starts. Belongs to the run's flow token, like the swim lesson.
 */
async function runKeyboardOceanTips(): Promise<void> {
  const token = flow;
  activePuffCalibration = token;
  puffCoach = claimCoach();
  abortPuffCalibration = false;
  game.calmWater = true;
  while (game.transition && token === flow) await wait(50);
  const hold = isTouch ? "Hold the screen" : "Hold SPACE";
  const done = await oceanTipBanners(token, [
    "Swim, little pufferfish! 🐡",
    `${hold} to puff up and float, let go to sink`,
  ]);
  endPuffCalibrationOverlay(token);
  if (token !== flow) return;
  if (done) markTutorialSeen("ocean");
  game.calmWater = false;
}

// --- Ready & run -----------------------------------------------------------------

/** "Play anyway" after a failed calibration uses the rejected one for this session only. */
function playAfterCalibration(): void {
  if (calibrationFailed && rejectedCalibration) calibration = rejectedCalibration;
  if (calibration) startReady();
}

/**
 * Debug: a fresh run that dives straight into the ocean (no city). In face
 * mode the dive runs the puff calibration if one is due. From the menu it
 * starts in keyboard mode; mid-calibration it does nothing.
 */
function startOceanRun(): void {
  if (state === "loading" || state === "calibrating") return;
  if (state === "menu") {
    sound.unlock();
    mode = "keyboard";
    tracker.stopCamera();
  } else if (state === "calibrated") {
    if (calibrationFailed && rejectedCalibration) calibration = rejectedCalibration;
    if (!calibration) return;
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
  show($("perch-you"), face);
  show($("perch-help"), face);
  show($("ready-key"), !face);
  perchCoach = claimCoach();
  showScreen("ready");
  perch.enteredAt = performance.now();
  enterPerchStep(seenTutorials.has("perch") ? "go" : "strain");
}

/**
 * - reading: the default calibration reads the relaxed face (no strain yet).
 *   Only the bird and the webcam show; the gauge slides in after.
 * - strain / relax: a new player's guided practice poop.
 * - pushed: that poop pushed the bird up; the coach says so for a moment.
 * - fill: practice done; a full poop takes off.
 * - go: a returning player; a full poop takes off.
 * Smaller poops just hop on the lamp, so a stray strain never starts the run.
 */
type PerchStep = "reading" | "strain" | "relax" | "pushed" | "fill" | "go";

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
  reading: { face: "Relax and look here", faceHint: "", keys: "", keysHint: "", look: "relaxed" },
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
  $("perch").classList.toggle("intro", step === "reading");
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
  if (perch.step === "reading") return false;
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
  if (perch.step !== "reading" && perch.step !== "pushed" && faceVisible()) {
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
    const clock = playingClock();
    while (!done()) {
      if (token !== flow || state === "gameover") return null;
      if (clock() >= ms) return false;
      const recent = performance.now() - lessonCount.lastAccident < 3000;
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

/** Moves the webcam preview beside the bird on the perch, or back to its corner. */
function dockCam(perched: boolean): void {
  if (perched === cam.classList.contains("perched")) return;
  cam.classList.toggle("perched", perched);
  if (perched) $("perch-cam-slot").append(cam);
  else camHome.parent.insertBefore(cam, camHome.next);
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
  $<HTMLInputElement>("opt-tips").checked = isNewPlayer();
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
      // The swim lesson shows each step with the fish, whatever the face does.
      if (scriptTarget !== null) {
        const d = scriptTarget - scriptedPuff;
        scriptedPuff += Math.sign(d) * Math.min(Math.abs(d), SCRIPT_RATE * STEP);
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

/** The player's face right now, cropped from the webcam (null in keyboard mode or without a fresh face). */
function playerFace(): Photo | null {
  return mode === "face" && faceFresh() ? captureFace(video, lastFace?.box ?? null) : null;
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
  s: () => game.spawnSharkNow(), // ocean
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
onPlay("btn-face", () => void startFaceMode());
onPlay("btn-keyboard", () => {
  show(settingsPanel, false);
  startKeyboardMode();
});
on("btn-hud-mute", toggleMute);
on("btn-hud-pause", togglePause);
on("btn-loading-retry", () => void startFaceMode());
on("btn-loading-keyboard", startKeyboardMode);
onPlay("btn-calib-play", playAfterCalibration);
on("btn-calib-retry", () => void runCalibration());
onPlay("btn-calib-keyboard", startKeyboardMode);
on("btn-calib-cancel", goToMenu);
on("btn-perch-menu", goToMenu);
on("btn-tune", () => void recalibrate());
onPlay("btn-perch-keyboard", startKeyboardMode);
on("btn-resume", togglePause);
on("btn-pause-menu", goToMenu);
onPlay("btn-again", () => startReady());
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
      get lastPuffAttempt() { return lastPuffAttempt; },
      openDatasetRecorder,
    },
  });
}
