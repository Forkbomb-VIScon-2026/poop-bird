// App glue: screens, input, the fixed-timestep game loop, face tracking,
// calibration, sound and the debug panel.

import "./style.css";
import { config } from "./config";
import { Sound } from "./audio";
import { DebugPanel } from "./debug";
import { DEBUG } from "./env";
import { FaceTracker, describeCameraError, type FaceFrame } from "./face";
import { Game } from "./game";
import { Renderer } from "./render";
import { StrainSnapshot } from "./snapshot";
import {
  addToHallOfFame,
  loadBest,
  loadHallOfFame,
  qualifiesForHallOfFame,
  saveBest,
  storageGet,
  storageSet,
  type HallOfFameEntry,
} from "./storage";
import {
  FEATURE_NAMES,
  assessCalibration,
  buildCalibration,
  featureStats,
  initialStrainState,
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
  countdown: $("screen-countdown"),
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

type AppState = "menu" | "loading" | "calibrating" | "calibrated" | "countdown" | "playing" | "paused" | "gameover";
type Mode = "face" | "keyboard";

let state: AppState = "menu";
let mode: Mode = "keyboard";

const renderer = new Renderer(canvas);
const game = new Game(renderer.resize());
const sound = new Sound();
const tracker = new FaceTracker(video);
const snapshot = new StrainSnapshot();
const debug = DEBUG ? new DebugPanel($("debug"), () => void recalibrate()) : null;
if (!DEBUG) document.querySelectorAll("[data-debug-only]").forEach((el) => el.remove());

let calibration: Calibration | null = loadCalibration();
/** A calibration that failed the quality check; used only if the player picks "Play anyway". */
let rejectedCalibration: Calibration | null = null;
/** Whether the calibration result screen is showing a failed calibration. */
let calibrationFailed = false;
/**
 * Bumped on every screen-flow transition. Async flows (camera startup,
 * calibration, countdown) capture it and bail out if it changed, so a stale
 * flow can never take over the screen.
 */
let flow = 0;
let strain = initialStrainState();
let lastFace: FaceFrame | null = null;
let lastFaceTime = 0;
let lastFaceSeen = 0;
let keyHeld = false;
let pointerHeld = false;
let best = loadBest();
let lastGameOverEntryDate: string | null = null;
let currentSnapshotUrl: string | null = null;

const snapshotCheckbox = $<HTMLInputElement>("opt-snapshot");
snapshotCheckbox.checked = storageGet("poopbird.snapshot.v1") === "1";
snapshotCheckbox.addEventListener("change", () => storageSet("poopbird.snapshot.v1", snapshotCheckbox.checked ? "1" : "0"));
sound.setMuted(storageGet("poopbird.muted.v1") === "1");

/** The single "is the player straining?" signal: face OR keyboard OR pointer. */
function straining(): boolean {
  return keyHeld || pointerHeld || (mode === "face" && faceFresh() && strain.active);
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
  if (state === "playing" && game.phase === "playing" && snapshotCheckbox.checked) {
    snapshot.offer(video, frame.box, strain.smoothed);
  }
});

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
  if (calibration && !forceCalibrate) showCalibrationResult(null);
  else await runCalibration();
}

function startKeyboardMode(): void {
  sound.unlock();
  mode = "keyboard";
  updateModeLabel();
  tracker.stopCamera();
  show(cam, false);
  void startCountdown();
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
  state = "calibrating";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  cam.classList.add("large");
  show($("calib-result"), false);
  for (const id of ["calib-count", "calib-hint"]) show($(id), true);
  show($("calib-progress").parentElement!, true);

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
    rejectedCalibration = null;
    saveCalibration(cal);
  } else {
    rejectedCalibration = quality.totalChange > 0 ? cal : null;
  }
  strain = initialStrainState();
  showCalibrationResult(quality);
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
};

/** quality === null means "reusing a saved calibration". */
function showCalibrationResult(quality: ReturnType<typeof assessCalibration> | null): void {
  state = "calibrated";
  showScreen("calibrate");
  show(hud, false);
  show(cam, true);
  cam.classList.add("large");
  for (const id of ["calib-count", "calib-hint"]) show($(id), false);
  show($("calib-progress").parentElement!, false);
  show($("calib-result"), true);
  const text = $("calib-result-text");
  const playBtn = $<HTMLButtonElement>("btn-calib-play");
  const retryBtn = $<HTMLButtonElement>("btn-calib-retry");
  const card = screens.calibrate.querySelector(".calib")!;
  card.classList.remove("strain");
  $("calib-step").textContent = "Calibration";

  const top = (cal: Calibration) =>
    FEATURE_NAMES.filter((f) => cal.weights[f] > 0)
      .sort((a, b) => cal.weights[b] - cal.weights[a])
      .slice(0, 3)
      .map((f) => FEATURE_LABELS[f]);

  if (quality === null) {
    $("calib-prompt").textContent = "Welcome back!";
    text.textContent = `Using your last calibration (watching your ${calibration ? top(calibration).join(", ") : "face"}). New player? Recalibrate.`;
    setPrimary(playBtn, retryBtn);
  } else if (quality.ok) {
    $("calib-prompt").textContent = "Nice strain! 💪";
    text.textContent = `I'll mostly watch your ${quality.topFeatures.map((f) => FEATURE_LABELS[f]).join(", ")}.`;
    setPrimary(playBtn, retryBtn);
  } else {
    $("calib-prompt").textContent = "Hmm, that didn't work well";
    text.textContent = quality.reason ?? "Try again.";
    setPrimary(retryBtn, playBtn);
  }
  const anyway = quality !== null && !quality.ok;
  calibrationFailed = anyway;
  playBtn.innerHTML = anyway ? "Play anyway" : "Play! <small>(Enter)</small>";
  playBtn.disabled = !(anyway ? (rejectedCalibration ?? calibration) : calibration);
}

function setPrimary(primary: HTMLElement, secondary: HTMLElement): void {
  primary.classList.add("primary");
  secondary.classList.remove("primary");
}

function saveCalibration(cal: Calibration): void {
  storageSet("poopbird.calibration.v1", JSON.stringify(cal));
}

function loadCalibration(): Calibration | null {
  const raw = storageGet("poopbird.calibration.v1");
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Calibration;
    const valid = (v: unknown) =>
      typeof v === "object" && v !== null && FEATURE_NAMES.every((f) => typeof (v as FeatureVector)[f] === "number");
    return valid(c.neutral) && valid(c.strain) && valid(c.weights) ? c : null;
  } catch {
    return null;
  }
}

// --- Countdown & run -----------------------------------------------------------------

/** "Play anyway" after a failed calibration uses the rejected one for this session only. */
function playAfterCalibration(): void {
  if (calibrationFailed && rejectedCalibration) calibration = rejectedCalibration;
  if (calibration) void startCountdown();
}

async function startCountdown(): Promise<void> {
  const token = ++flow;
  calibSamples = null;
  calibFrames = null;
  cam.classList.remove("large");
  show(cam, mode === "face");
  game.reset();
  snapshot.reset();
  keyHeld = false;
  pointerHeld = false;
  state = "countdown";
  showScreen("countdown");
  show(hud, true);
  const n = $("countdown-n");
  for (const label of ["3", "2", "1"]) {
    n.textContent = label;
    // Restart the pop animation.
    n.style.animation = "none";
    void n.offsetWidth;
    n.style.animation = "";
    sound.beep();
    await wait(650);
    if (token !== flow) return;
  }
  if (state !== "countdown") return;
  sound.beep(true);
  showScreen(null);
  state = "playing";
}

function togglePause(): void {
  if (state === "playing") {
    state = "paused";
    showScreen("pause");
    sound.setGroan(-1, false);
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
  cam.classList.remove("large");
  show(cam, false);
  show(hud, false);
  game.reset();
  renderHallOfFame($("start-hof"), loadHallOfFame(), null);
  showScreen("start");
}

function onGameOver(): void {
  state = "gameover";
  sound.setGroan(-1, false);
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

  currentSnapshotUrl = mode === "face" && snapshotCheckbox.checked ? snapshot.toDataURL() : null;
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

  if (state === "playing") {
    accumulator += dt;
    while (accumulator >= STEP) {
      game.straining = straining();
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
    scrollSpeed: game.scrollSpeed,
    difficulty: game.difficulty,
    birdVy: game.bird.vy,
  });
  requestAnimationFrame(frame);
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
      case "gameover":
        onGameOver();
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
      if (state === "gameover") void startCountdown();
      break;
    case "d":
      debug?.toggle();
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
  if (state !== "playing") return;
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
on("btn-again", () => void startCountdown());
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
if (DEBUG) Object.assign(window, { poopBird: { game, config, tracker, get calibration() { return calibration; } } });
