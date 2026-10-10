// App glue: screens, input, the fixed-timestep game loop, face tracking,
// calibration (strain, and puff at the first dive), sound and the debug panel.

import "./style.css";
import { config } from "./config";
import { Sound } from "./audio";
import { DebugPanel } from "./debug";
import { DEBUG } from "./env";
import { FaceTracker, describeCameraError, type FaceFrame } from "./face";
import { Game } from "./game";
import { FaceRecorder, type RecorderKind } from "./recorder";
import { Renderer, drawFrontPage } from "./render";
import { StrainSnapshot, captureFace } from "./snapshot";
import {
  assessPuffCalibration,
  buildPuffCalibration,
  initialPuffState,
  stepKeyPuff,
  stepPuff,
} from "./puff";
import {
  addToHallOfFame,
  loadBest,
  loadHallOfFame,
  qualifiesForHallOfFame,
  saveBest,
  storageGet,
  storageRemove,
  storageSet,
  type HallOfFameEntry,
} from "./storage";
import {
  FEATURE_NAMES,
  PUFF_FEATURES,
  STRAIN_FEATURES,
  assessCalibration,
  buildCalibration,
  defaultCalibration,
  featureStats,
  initialStrainState,
  neutralFaceStats,
  restoreCalibration,
  stepStrain,
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
};
const hud = $("hud");
const cam = $("cam");

function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle("hidden", !visible);
}

function showScreen(name: keyof typeof screens | null): void {
  for (const [k, el] of Object.entries(screens)) show(el, k === name);
}

// --- State ------------------------------------------------------------------------

type AppState =
  | "menu" | "loading" | "calibrating" | "calibrated" | "ready" | "playing" | "paused" | "gameover";
type Mode = "face" | "keyboard";

let state: AppState = "menu";
let mode: Mode = "keyboard";

const renderer = new Renderer(canvas);
const game = new Game(renderer.resize());
const sound = new Sound();
const tracker = new FaceTracker(video);
const snapshot = new StrainSnapshot();
const debug = DEBUG
  ? new DebugPanel($("debug"), () => void recalibrate(), () => startOceanRun(), recordFace, forgetCalibration)
  : null;
if (!DEBUG) document.querySelectorAll("[data-debug-only]").forEach((el) => el.remove());

const CALIBRATION_KEY = "poopbird.calibration.v1";
// v2: puff features changed (eyeMouth replaced cheekBulge; robust puff stats).
const PUFF_CALIBRATION_KEY = "poopbird.puffCalibration.v2";

let calibration: Calibration | null = loadCalibration(CALIBRATION_KEY, STRAIN_FEATURES);
/** `calibration` is the default one, fitted to a quick relaxed-face read and never saved. */
let calibrationIsDefault = false;
/** Puff calibration (neutral vs. full puff). null = use the fixed cheekPuff fallback range. */
let puffCalibration: Calibration | null = loadCalibration(PUFF_CALIBRATION_KEY, PUFF_FEATURES);
/** The puff calibration ran (and passed or failed) this session; later dives skip it. Reset by C. */
let puffCalibrationTried = false;
/** The last puff calibration attempt, passed or not (console: poopBird.lastPuffAttempt). */
let lastPuffAttempt: { cal: Calibration; quality: ReturnType<typeof assessPuffCalibration> } | null = null;
/** Flow token of the puff calibration in progress, if any. */
let activePuffCalibration: number | null = null;
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
let lastFace: FaceFrame | null = null;
let lastFaceTime = 0;
let lastFaceSeen = 0;
let keyHeld = false;
let pointerHeld = false;
let best = loadBest();
let lastGameOverEntryDate: string | null = null;
let currentSnapshotUrl: string | null = null;

sound.setMuted(storageGet("poopbird.muted.v1") === "1");

/** The single "is the player straining?" signal: face OR keyboard OR pointer. */
function straining(): boolean {
  return keyHeld || pointerHeld || (mode === "face" && faceFresh() && strain.active);
}

/** Face puff 0..1 (0 in keyboard mode, or if the detector stalled). */
function facePuff(): number {
  return mode === "face" && faceFresh() ? puffSignal.smoothed : 0;
}

/** The single puff signal for the fish: max of face and key, the same "face OR key" spirit as straining(). */
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
  const dt = lastFaceTime ? Math.min(0.25, (frame.time - lastFaceTime) / 1000) : 1 / 30;
  lastFaceTime = frame.time;
  lastFace = frame;
  if (frame.features) lastFaceSeen = frame.time;
  calibFrames?.push(frame.time);
  if (calibSamples && frame.features) calibSamples.push({ t: frame.time, f: frame.features });
  strain = stepStrain(strain, frame.features, calibration, dt, config);
  puffSignal = stepPuff(puffSignal, frame.features, puffCalibration, dt, config);
  if (faceRecorder && !faceRecorder.push(frame)) finishFaceRecording();
  if (state === "playing" && game.phase === "playing" && game.stage === "city") {
    snapshot.offer(video, frame.box, strain.smoothed);
  }
});

// --- Debug face recorder -------------------------------------------------------------

let faceRecorder: FaceRecorder | null = null;

/** Records a scripted puff or strain clip (raw features + landmarks) and downloads it for offline tuning. */
function recordFace(kind: RecorderKind = "puff"): void {
  if (faceRecorder) return;
  if (mode !== "face" || !tracker.ready) {
    debug?.setRecordPrompt("Start a face-mode game first");
    window.setTimeout(() => !faceRecorder && debug?.setRecordPrompt(null), 2500);
    return;
  }
  // Freeze the game so the clip doesn't cost a life.
  if (state === "playing") togglePause();
  faceRecorder = new FaceRecorder(kind, (step) => {
    debug?.setRecordPrompt(`${step.prompt} (${step.seconds} s)`);
    if (step.cue) sound.beep(step.cue === "strain");
  });
}

function finishFaceRecording(): void {
  const rec = faceRecorder;
  if (!rec) return;
  faceRecorder = null;
  rec.download({
    video: { width: tracker.video.videoWidth, height: tracker.video.videoHeight },
    calibration,
    puffCalibration,
    lastPuffAttempt,
    config,
  });
  debug?.setRecordPrompt("Saved: send me the downloaded JSON");
  window.setTimeout(() => !faceRecorder && debug?.setRecordPrompt(null), 4000);
}

function updateStrainBars(): void {
  const value = faceFresh() ? strain.smoothed : 0;
  const active = straining();
  for (const prefix of ["cam", "calib"]) {
    const fill = $(`${prefix}-strain-fill`);
    fill.style.width = `${value * 100}%`;
    fill.classList.toggle("active", active);
    $(`${prefix}-strain-on`).style.left = `${config.strainOn * 100}%`;
    $(`${prefix}-strain-off`).style.left = `${config.strainOff * 100}%`;
  }
  // Short grace period so a single dropped frame doesn't flash the warning.
  const lost = mode === "face" && tracker.ready && performance.now() - lastFaceSeen > 300;
  show($("cam-noface"), lost);
  if (state === "calibrated") updateStrainCheck(value, active);
}

/** The "try it" checklist on the calibration result: strain once, then relax once. */
const strainCheck = { strained: false, relaxed: false };

function updateStrainCheck(value: number, active: boolean): void {
  if (active) strainCheck.strained = true;
  else if (strainCheck.strained && value < config.strainOff) strainCheck.relaxed = true;
  $("check-strain").classList.toggle("done", strainCheck.strained);
  $("check-relax").classList.toggle("done", strainCheck.relaxed);
  $("meter-strained").classList.toggle("lit", active);
  $("meter-relaxed").classList.toggle("lit", !active && value < config.strainOff);
  $("btn-calib-play").classList.toggle("pulse", strainCheck.strained && strainCheck.relaxed);
}

async function startFaceMode(forceCalibrate = false): Promise<void> {
  const token = ++flow;
  sound.unlock();
  mode = "face";
  updateModeLabel();
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
      updateModeLabel();
      return;
    }
  }
  tracker.start();
  show(cam, true);
  if (forceCalibrate) await runCalibration();
  else if (calibration && !calibrationIsDefault) showCalibrationResult("saved");
  else await runDefaultCalibration();
}

function startKeyboardMode(): void {
  sound.unlock();
  mode = "keyboard";
  updateModeLabel();
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
  } else {
    rejectedCalibration = quality.totalChange > 0 ? cal : null;
  }
  strain = initialStrainState();
  showCalibrationResult(quality);
}

/**
 * The start without calibration: the strain check opens right away and the
 * default calibration is fitted to a short read of the player's relaxed face.
 * It's never saved, so the next player on this browser gets their own read.
 * Calibrating from the strain check replaces it.
 */
async function runDefaultCalibration(): Promise<void> {
  const token = ++flow;
  // A new player: the next dive samples their puff again.
  clearPuffCalibration();
  calibration = null;
  calibrationIsDefault = true;
  rejectedCalibration = null;
  strain = initialStrainState();
  showCalibrationResult("reading");
  const neutral = await readRelaxedFace(token);
  if (token !== flow || !neutral) return;
  calibration = defaultCalibration(neutralFaceStats(neutral), config.defaultStrainScale);
  console.info("[default calibration]", { cal: calibration, neutral });
  strain = initialStrainState();
  showCalibrationResult("default");
}

/** Fewest face samples the relaxed-face read takes, so a slow detector just reads for longer. */
const MIN_RELAXED_SAMPLES = 8;

/**
 * Samples the relaxed face for at least `defaultNeutralSeconds` and
 * MIN_RELAXED_SAMPLES face frames. Starts over if too few frames had a face
 * (no one in view yet). null = abandoned.
 */
async function readRelaxedFace(token: number): Promise<FeatureVector[] | null> {
  const total = config.defaultNeutralSeconds * 1000;
  let start = performance.now();
  calibSamples = [];
  calibFrames = [];
  for (;;) {
    await wait(50);
    if (token !== flow || !calibSamples || !calibFrames) {
      calibSamples = null;
      calibFrames = null;
      return null;
    }
    if (performance.now() - start < total) continue;
    if (calibSamples.length < calibFrames.length * config.minFaceCoverage) {
      start = performance.now();
      calibSamples = [];
      calibFrames = [];
    } else if (calibSamples.length >= MIN_RELAXED_SAMPLES) {
      break;
    }
  }
  const samples = calibSamples.map((s) => s.f);
  calibSamples = null;
  calibFrames = null;
  return samples;
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
    sound.beep();
    await wait(600);
    if (token !== flow) return { samples: [], coverage: 0 };
  }

  $("calib-prompt").textContent = prompt;
  card.classList.toggle("strain", strainPhase);
  sound.beep(true);
  const total = config.calibrationSeconds * 1000;
  const settle = config.calibrationSettle * 1000;
  const start = performance.now();
  calibSamples = [];
  calibFrames = [];
  while (performance.now() - start < total) {
    if (token !== flow) {
      calibSamples = null;
      calibFrames = null;
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
  const samples = calibSamples.filter((s) => s.t - start >= settle).map((s) => s.f);
  const frames = calibFrames.filter((t) => t - start >= settle).length;
  calibSamples = null;
  calibFrames = null;
  card.classList.remove("strain");
  return { samples, coverage: frames > 0 ? samples.length / frames : 0 };
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

/**
 * What the strain check shows: a saved calibration, the default one (while
 * reading the relaxed face, then ready), or the result of a fresh calibration.
 */
type CalibrationResult = "saved" | "reading" | "default" | ReturnType<typeof assessCalibration>;

function showCalibrationResult(result: CalibrationResult): void {
  state = "calibrated";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  cam.classList.add("large");
  show($("calib-run"), false);
  show($("calib-result"), true);
  show($("btn-calib-keyboard"), true);
  strainCheck.strained = false;
  strainCheck.relaxed = false;
  const text = $("calib-result-text");
  const playBtn = $<HTMLButtonElement>("btn-calib-play");
  const retryBtn = $<HTMLButtonElement>("btn-calib-retry");
  const card = screens.calibrate.querySelector(".calib")!;
  card.classList.remove("strain");
  $("calib-step").textContent = "Strain check";

  retryBtn.textContent = calibrationIsDefault ? "Calibrate" : "Recalibrate";
  if (result === "saved") {
    $("calib-prompt").textContent = "Welcome back!";
    text.textContent = "New player? Recalibrate.";
    setPrimary(playBtn, retryBtn);
  } else if (result === "reading") {
    $("calib-prompt").textContent = "Relax your face…";
    text.textContent = "Just look at the screen for a moment.";
    setPrimary(playBtn, retryBtn);
  } else if (result === "default") {
    $("calib-prompt").textContent = "Try your strain 💩";
    text.textContent = "Bar acting up? Calibrate it to your face.";
    setPrimary(playBtn, retryBtn);
  } else if (result.ok) {
    $("calib-prompt").textContent = "Nice strain! 💪";
    text.textContent = "";
    setPrimary(playBtn, retryBtn);
  } else {
    $("calib-prompt").textContent = "Hmm, that didn't work well";
    text.textContent = result.reason ?? "Try again.";
    setPrimary(retryBtn, playBtn);
  }
  const anyway = typeof result === "object" && !result.ok;
  calibrationFailed = anyway;
  playBtn.innerHTML = anyway ? "Play anyway" : "Play! <small>(Enter)</small>";
  playBtn.disabled = !(anyway ? (rejectedCalibration ?? calibration) : calibration);
}

function setPrimary(primary: HTMLElement, secondary: HTMLElement): void {
  primary.classList.add("primary");
  secondary.classList.remove("primary");
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

/** Debug: delete both saved calibrations and reload, to test the first-time flow. */
function forgetCalibration(): void {
  storageRemove(CALIBRATION_KEY);
  storageRemove(PUFF_CALIBRATION_KEY);
  location.reload();
}

// --- Puff calibration (first dive, in game) ---------------------------------------------

function clearPuffCalibration(): void {
  puffCalibration = null;
  puffCalibrationTried = false;
  puffSignal = initialPuffState();
  storageRemove(PUFF_CALIBRATION_KEY);
}

/** The next dive samples the player's puff: face mode, nothing saved, not tried yet this session. */
function needsPuffCalibration(): boolean {
  return mode === "face" && tracker.ready && puffCalibration === null && !puffCalibrationTried;
}

/**
 * Runs while the dive transition is held: the world is frozen and an overlay
 * asks for a full puff. Belongs to the current run's flow token, so going to
 * the menu or recalibrating mid-dive abandons it (the next run resets the
 * game). Never blocks the game: a failed check falls back to the fixed range.
 */
async function runPuffCalibration(): Promise<void> {
  const token = flow;
  const main = calibration;
  if (!main?.neutralStd) {
    // Calibrated before the ocean existed: no relaxed-face stats to compare against.
    puffCalibrationTried = true;
    showToast("Using default puff. Recalibrate (C) to tune it.");
    return;
  }
  activePuffCalibration = token;
  game.holdTransition = true;
  show($("puff-calib"), true);
  const phase = await puffCalibrationPhase(token);
  if (activePuffCalibration === token) {
    activePuffCalibration = null;
    show($("puff-calib"), false);
    sound.setBurble(-1);
  }
  if (token !== flow || !phase) return;

  puffCalibrationTried = true;
  const cal = buildPuffCalibration(main, phase.samples, config);
  const quality = cal ? assessPuffCalibration(cal, phase.samples, { strain: phase.coverage }, config) : null;
  console.info("[puff calibration]", { cal, quality, phase });
  lastPuffAttempt = cal && quality ? { cal, quality } : null;
  if (cal && quality?.ok) {
    puffCalibration = cal;
    saveCalibration(PUFF_CALIBRATION_KEY, cal);
    showToast(`Puff calibrated! 🐡 Watching your ${topFeatureLabels(cal).join(", ")}`, 3500);
  } else {
    showToast(`Couldn't calibrate puff (${quality?.reason ?? "no data"}), using defaults`, 3500);
  }
  puffSignal = initialPuffState();
  game.holdTransition = false;
}

/** Collects puff samples, dropping the settle time. Pausing restarts it after resume. null = abandoned. */
async function puffCalibrationPhase(token: number): Promise<PhaseResult | null> {
  const progress = $("puff-calib-progress");
  const total = config.oceanCalibrationSeconds * 1000;
  const settle = config.calibrationSettle * 1000;
  let start = -1;
  for (;;) {
    if (token !== flow) {
      calibSamples = null;
      calibFrames = null;
      return null;
    }
    if (state !== "playing") {
      // Paused: start over after resuming, so the samples are one continuous puff.
      start = -1;
      calibSamples = null;
      calibFrames = null;
      progress.style.width = "0%";
      await wait(50);
      continue;
    }
    const now = performance.now();
    if (start < 0) {
      start = now;
      calibSamples = [];
      calibFrames = [];
    }
    const elapsed = now - start;
    if (elapsed >= total) break;
    progress.style.width = `${(elapsed / total) * 100}%`;
    sound.setBurble(elapsed / total);
    await wait(50);
  }
  progress.style.width = "100%";
  const samples = (calibSamples ?? []).filter((s) => s.t - start >= settle).map((s) => s.f);
  const frames = (calibFrames ?? []).filter((t) => t - start >= settle).length;
  calibSamples = null;
  calibFrames = null;
  return { samples, coverage: frames > 0 ? samples.length / frames : 0 };
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
    updateModeLabel();
    tracker.stopCamera();
  } else if (state === "calibrated") {
    if (calibrationFailed && rejectedCalibration) calibration = rejectedCalibration;
    if (!calibration) return;
  }
  startReady(true);
}

/**
 * Set once the player stops straining on the ready screen, so a strain held
 * over from the previous screen doesn't start the run by itself.
 */
let readyArmed = false;

/**
 * The bird hovers until the player strains for the first time; that starts
 * the run. `ocean` (debug) skips the wait and dives straight in.
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
  pointerHeld = false;
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
  const face = mode === "face";
  $("ready-text").textContent = face ? "Strain to take off!" : "Hold to take off!";
  $("ready-sub").textContent = face ? "then relax to poop 💩" : "then let go to poop 💩";
  show($("ready-face"), face);
  show($("ready-key"), !face);
  showScreen("ready");
}

function updateReady(): void {
  if (!straining()) readyArmed = true;
  else if (readyArmed) {
    state = "playing";
    showScreen(null);
    sound.beep(true);
  }
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
  faceRecorder = null;
  debug?.setRecordPrompt(null);
  tracker.stopCamera();
  state = "menu";
  sound.setGroan(-1, false);
  sound.setBurble(-1);
  hideToast();
  cam.classList.remove("large");
  show(cam, false);
  show(hud, false);
  game.reset();
  showScreen("start");
}

function onGameOver(): void {
  state = "gameover";
  sound.setGroan(-1, false);
  sound.setBurble(-1);
  hideToast();
  sound.sadTrombone();
  const score = game.score;
  const newBest = score > best;
  if (newBest) {
    best = score;
    saveBest(best);
  }
  $("go-title").textContent = pick(["Splat!", "Plop.", "Flushed!", "Wiped out!", "Down the drain!"]);
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

  // The last photo that got away makes tomorrow's paper.
  const front = game.frontPages.at(-1) ?? null;
  show($("go-frontpage"), front !== null);
  if (front) {
    const fp = $<HTMLCanvasElement>("go-frontpage-canvas");
    const fctx = fp.getContext("2d");
    if (fctx) {
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, fp.width, fp.height);
      fctx.scale(fp.width / 200, fp.height / 240);
      drawFrontPage(fctx, 2, 2, 196, 236, front, renderer.photos);
    }
  }

  currentSnapshotUrl = mode === "face" ? snapshot.toDataURL() : null;
  show($("go-snapshot"), currentSnapshotUrl !== null);
  if (currentSnapshotUrl) $<HTMLImageElement>("go-snapshot-img").src = currentSnapshotUrl;

  const list = loadHallOfFame();
  lastGameOverEntryDate = null;
  const form = $<HTMLFormElement>("go-hof-form");
  show(form, qualifiesForHallOfFame(score, list));
  $<HTMLInputElement>("go-name").value = storageGet("poopbird.name.v1") ?? "";
  renderHallOfFame($("go-hof"), list, null);
  showScreen("gameover");
}

function saveHallOfFameEntry(): void {
  const name = ($<HTMLInputElement>("go-name").value.trim() || "Anonymous Pooper").slice(0, 16);
  storageSet("poopbird.name.v1", name);
  const entry: HallOfFameEntry = {
    name,
    score: game.score,
    date: new Date().toISOString(),
    targets: game.targetsHit,
    ...(currentSnapshotUrl ? { snapshot: currentSnapshotUrl } : {}),
  };
  lastGameOverEntryDate = entry.date;
  const { list, saved } = addToHallOfFame(entry);
  show($("go-hof-form"), false);
  renderHallOfFame($("go-hof"), list, lastGameOverEntryDate);
  if (!saved) {
    const warn = document.createElement("p");
    warn.className = "error";
    warn.textContent = "Couldn't save: this browser's storage is blocked or full. Your score is shown but won't be kept.";
    $("go-hof").append(warn);
  }
}

function renderHallOfFame(container: HTMLElement, list: HallOfFameEntry[], highlightDate: string | null): void {
  container.innerHTML = "";
  const title = document.createElement("h3");
  title.textContent = "🏆 Hall of Fame (this device)";
  container.append(title);
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hof-empty";
    p.textContent = "No legends yet. Be the first!";
    container.append(p);
    return;
  }
  const ol = document.createElement("ol");
  list.forEach((e, i) => {
    const li = document.createElement("li");
    if (highlightDate && e.date === highlightDate) li.className = "me";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${i + 1}.`;
    let thumb: HTMLElement;
    if (e.snapshot) {
      const img = document.createElement("img");
      img.src = e.snapshot;
      img.alt = `${e.name}'s strain face`;
      thumb = img;
    } else {
      thumb = document.createElement("span");
      thumb.textContent = "💩";
    }
    thumb.classList.add("thumb");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = e.name;
    const date = document.createElement("span");
    date.className = "date";
    const d = new Date(e.date);
    date.textContent = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = String(e.score);
    li.append(rank, thumb, name, date, score);
    ol.append(li);
  });
  container.append(ol);
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
  const shownBest = Math.max(best, state === "playing" ? score : 0);
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
}

function updateModeLabel(): void {
  $("hud-mode").textContent = mode === "face" ? "😣 face (Space works too)" : "⌨️ keyboard";
  $("hud-mute").textContent = sound.muted ? "🔇 M" : "🔊 M";
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

  if (state === "ready") updateReady();
  if (state === "playing") {
    accumulator += dt;
    while (accumulator >= STEP) {
      game.straining = straining();
      if (game.swimming) {
        // A pop deflates the fish: key puff stays empty while stunned.
        keyPuff = game.stunned
          ? 0
          : stepKeyPuff(keyPuff, keyHeld || pointerHeld, STEP, config.oceanKeyInflateRate, config.oceanKeyDeflateRate);
      }
      game.puffInput = puffInput();
      game.step(STEP);
      accumulator -= STEP;
    }
    handleGameEvents();
  } else if (state === "gameover") {
    game.step(dt);
  } else if (state !== "paused") {
    game.idle(dt);
    accumulator = 0;
  }

  renderer.draw(game, state === "playing" ? dt : 0);

  const charging = state === "playing" && game.phase === "playing" && game.charge.charge > 0 && !game.stunned;
  if (state !== "calibrating") sound.setGroan(charging ? game.charge.charge : -1, game.overstrainProgress > 0);
  if (activePuffCalibration === null) {
    sound.setBurble(state === "playing" && game.swimming && !game.stunned ? game.fish.puff : -1);
  }

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
    birdVy: game.bird.vy,
    stage: game.transition ? `${game.stage} → ${game.transition.to}${game.holdTransition ? " (held)" : ""}` : game.stage,
    puffCalibration,
    puffSource: puffCalibration ? `calibrated (${topFeatureLabels(puffCalibration).join(", ")})` : "fallback range",
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

function handleGameEvents(): void {
  for (const e of game.events) {
    switch (e.type) {
      case "release":
        sound.release(e.charge, e.sweet);
        break;
      case "accident":
        sound.accident();
        break;
      case "splat":
        sound.splat(e.big);
        break;
      case "hit":
        sound.hit(e.combo);
        break;
      case "crash":
        sound.splat(true);
        break;
      case "zap":
        sound.zap();
        break;
      case "gameover":
        onGameOver();
        break;
      case "gateEntered":
        sound.splash();
        if (e.to === "ocean") {
          // Keyboard players start at the hover point; in face mode the face decides.
          keyPuff = mode === "keyboard" ? config.oceanHoverPuff : 0;
          if (needsPuffCalibration()) void runPuffCalibration();
          else if (mode === "keyboard") showToast("Hold SPACE to puff up 🐡");
        } else {
          keyPuff = 0;
        }
        break;
      case "transformed":
      case "surfaced":
        sound.beep(true);
        break;
      case "spike":
        sound.spike();
        break;
      case "pop":
        sound.deflate();
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
    }
  }
  game.events.length = 0;
}

// --- Input ---------------------------------------------------------------------------------

function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
}

window.addEventListener("keydown", (e) => {
  if (isTyping(e)) return;
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
      togglePause();
      break;
    case "m":
      storageSet("poopbird.muted.v1", sound.toggleMute() ? "1" : "0");
      updateModeLabel();
      break;
    case "r":
      if (state === "gameover") startReady();
      break;
    case "d":
      debug?.toggle();
      break;
    case "g":
      // Debug shortcut: the next obstacle is the stage's gate.
      if (debug?.visible && state === "playing") game.spawnGateNow();
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
    case "o":
      // Debug shortcut: start a run as the pufferfish.
      if (debug?.visible) startOceanRun();
      break;
    case "c":
      void recalibrate();
      break;
    case "enter":
      if (state === "calibrated") playAfterCalibration();
      break;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") keyHeld = false;
});

canvas.addEventListener("pointerdown", (e) => {
  if (state !== "playing" && state !== "ready") return;
  e.preventDefault();
  sound.unlock();
  pointerHeld = true;
  canvas.setPointerCapture?.(e.pointerId);
});
for (const type of ["pointerup", "pointercancel"] as const) {
  window.addEventListener(type, () => (pointerHeld = false));
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  keyHeld = false;
  pointerHeld = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") togglePause();
});
window.addEventListener("resize", () => game.resize(renderer.resize()));

// --- Buttons -------------------------------------------------------------------------------

const on = (id: string, fn: () => void) => $(id).addEventListener("click", fn);
on("btn-face", () => void startFaceMode());
on("btn-keyboard", startKeyboardMode);
on("btn-loading-retry", () => void startFaceMode());
on("btn-loading-keyboard", startKeyboardMode);
on("btn-calib-play", playAfterCalibration);
on("btn-calib-retry", () => void runCalibration());
on("btn-calib-keyboard", startKeyboardMode);
on("btn-calib-cancel", goToMenu);
on("btn-resume", togglePause);
on("btn-pause-menu", goToMenu);
on("btn-again", () => startReady());
on("btn-go-calibrate", () => void recalibrate());
on("btn-go-menu", goToMenu);
on("btn-download", () => {
  if (!currentSnapshotUrl) return;
  const a = document.createElement("a");
  a.href = currentSnapshotUrl;
  a.download = `poop-bird-finest-strain-${game.score}.jpg`;
  a.click();
});
$<HTMLFormElement>("go-hof-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveHallOfFameEntry();
});
// Buttons shouldn't keep focus, or Space would "click" them while straining.
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) (document.activeElement as HTMLElement | null)?.blur();
});

// --- Boot ----------------------------------------------------------------------------------

updateModeLabel();
goToMenu();
requestAnimationFrame(frame);

// Handy for tuning from the console.
if (DEBUG) {
  Object.assign(window, {
    poopBird: {
      game, config, tracker,
      get calibration() { return calibration; },
      get puffCalibration() { return puffCalibration; },
      get lastPuffAttempt() { return lastPuffAttempt; },
      recordFace,
    },
  });
}
