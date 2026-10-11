// The Doo-el's controller: the two-player mode's screens, loop, input, sound
// and results. main.ts hands over with startDuel() (its state goes inert, its
// tracker stops) and gets control back through onExit.
//
// Seat check → countdown → match (pauses: P/Esc, hidden tab, a face out of
// view, or any identity doubt) → results → rematch or menu.
//
// Nothing here is uploaded or stored: two-player calibrations, face
// descriptors and the finest-strain photos live in memory for this session
// and are dropped on leaving the mode. Nothing reaches the leaderboard, the
// best score, the saved calibrations or the tutorial set.

import { config } from "./config";
import { DEBUG } from "./env";
import type { PoopSize, Sound } from "./audio";
import { describeCameraError, type FaceBox, type FaceTracker } from "./face";
import { buttonForKey, decorateAll, keyName, pressFromKey } from "./keyhints";
import { StrainSnapshot } from "./snapshot";
import { strainPercent } from "./leaderboard";
import {
  MAX_NEUTRAL_FALSE_RATE,
  defaultCalibration,
  initialStrainState,
  neutralFaceStats,
  neutralFalseRate,
  smoothStrain,
  stepStrain,
  strainedness,
  type Calibration,
  type FeatureVector,
  type StrainState,
} from "./strain";
import { DUEL_COUNTDOWN, DUEL_STEP, Duel, type DuelEvent, type DuelInput } from "./duel";
import { BankSteer, KeySteer, averageSignature, identitySettled, median, missingFor, type PlayerId, type Signature, type SteerSource } from "./duo";
import { DuoFaceTracker, GALLERY_MAX, type PlayerFrame } from "./duo-face";
import { DuelRenderer, type DebugOverlay, type HudPlayer, type SeatInfo } from "./duel-render";

export interface DuelDeps {
  video: HTMLVideoElement;
  /** The main game's tracker: it owns the camera stream (its detection loop is stopped). */
  tracker: FaceTracker;
  sound: Sound;
  /** main.ts's mute toggle (it persists the setting). */
  toggleMute: () => void;
  /** Called after the mode is torn down: main.ts goes back to its menu. */
  onExit: () => void;
}

type Screen = "seats" | "match" | "paused" | "results";
type SeatPhase = SeatInfo["phase"];

/** Relaxed-face reads before the default calibration takes the last one (as main.ts). */
const MAX_RELAXED_READS = 3;
const MIN_RELAXED_SAMPLES = 8;
/** Descriptors enrolled per phase: relaxed (seat check), strained (Squeeze!), early match. */
const ENROLL_RELAXED = 3;
const ENROLL_STRAINED = 3;
const ENROLL_MATCH = 2;
/** Face data counts only if the detector produced it this recently (ms). */
const FRESH_MS = 500;
const RESUME_COUNTDOWN = 3;

interface Player {
  id: PlayerId;
  /** null: not joined yet. */
  mode: "face" | "keys" | null;
  phase: SeatPhase;
  calibration: Calibration | null;
  homeRoll: number;
  strain: StrainState;
  lastFrame: number;
  box: FaceBox | null;
  bank: BankSteer;
  keys: KeySteer;
  keyStrain: boolean;
  read: { samples: FeatureVector[]; rolls: number[]; sigs: Signature[]; frames: number; start: number; attempt: number; lastSig: number } | null;
  hint: string;
  snapshot: StrainSnapshot;
  faceStrain: number;
  enrolled: { relaxed: number; strained: number; match: number };
  lastEnroll: number;
}

let active: DuelController | null = null;

/** Starts the two-player mode (no-op if it's already running). */
export function startDuel(deps: DuelDeps): void {
  if (active) return;
  active = new DuelController(deps);
}

/** Debug: the running duel and its identity numbers (window.poopBird.duel). */
export function duelDebugInfo(): unknown {
  return active?.debugInfo() ?? null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle("hidden", !visible);
}

class DuelController {
  private deps: DuelDeps;
  private root = $("duel");
  private renderer: DuelRenderer;
  private duo: DuoFaceTracker;
  private players: [Player, Player];
  private screen: Screen = "seats";
  private duel: Duel | null = null;
  private backdrop: Duel;
  private accumulator = 0;
  private lastTime = performance.now();
  private raf = 0;
  private cameraMessage: string | null = "Allow camera access when your browser asks…";
  private cameraOk = false;
  private videoHome: { parent: HTMLElement; next: Node | null };
  private pauseReason: "manual" | "identity" = "manual";
  /** Seconds left of the 3-2-1 before a paused match resumes (null = not resuming). */
  private resuming: number | null = null;
  private resultsAt: number | null = null;
  private bothReadyAt: number | null = null;
  private lastBeep = 0;
  private toast: { text: string; until: number } | null = null;
  private keysArmedAt = 0;
  private disposed = false;
  private cleanup: (() => void)[] = [];

  constructor(deps: DuelDeps) {
    this.deps = deps;
    this.duo = new DuoFaceTracker(deps.video);
    this.players = [this.makePlayer(0), this.makePlayer(1)];
    this.backdrop = new Duel(config, 1);
    const canvas = $<HTMLCanvasElement>("duel-canvas");
    this.renderer = new DuelRenderer(canvas);
    // The video joins the duel's DOM (tiny, nearly transparent): it must stay
    // rendered, or some browsers stop delivering its frames.
    this.videoHome = { parent: deps.video.parentElement!, next: deps.video.nextSibling };
    $("duel-video-slot").append(deps.video);
    show(this.root, true);
    this.renderer.resize();
    decorateAll(this.root);
    this.showScreen("seats");
    this.bindInput();
    this.duo.onFrame((f) => this.onFace(f));
    void this.startCamera();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private makePlayer(id: PlayerId): Player {
    return {
      id, mode: null, phase: "empty", calibration: null, homeRoll: 0, strain: initialStrainState(), lastFrame: 0, box: null,
      bank: new BankSteer(() => ({ deadZone: config.duelBankDeadZone, full: config.duelBankFull, smoothing: config.duelBankSmoothing })),
      keys: new KeySteer(), keyStrain: false, read: null, hint: "", snapshot: new StrainSnapshot(), faceStrain: 0,
      enrolled: { relaxed: 0, strained: 0, match: 0 }, lastEnroll: 0,
    };
  }

  // --- camera and model ----------------------------------------------------------

  private async startCamera(): Promise<void> {
    this.cameraMessage = "Allow camera access when your browser asks…";
    show($("btn-duel-retry"), false);
    try {
      await this.deps.tracker.startCamera();
      if (this.disposed) return;
      this.cameraMessage = "Camera on! Loading the face trackers…";
      await this.duo.load();
      if (this.disposed) return;
      this.duo.start();
      this.cameraOk = true;
      this.cameraMessage = null;
    } catch (err) {
      console.error("[duel] camera / face tracker failed", err);
      if (this.disposed) return;
      this.cameraOk = false;
      this.cameraMessage = `${describeCameraError(err)} You can both play with keys: press W and ↑.`;
      show($("btn-duel-retry"), true);
    }
  }

  // --- face frames ------------------------------------------------------------------

  private onFace(f: PlayerFrame): void {
    const pl = this.players[f.player];
    if (pl.mode === "keys") return;
    const dt = pl.lastFrame ? Math.min(0.25, (f.time - pl.lastFrame) / 1000) : 1 / 30;
    pl.lastFrame = f.time;
    pl.box = f.box;
    pl.strain = stepStrain(pl.strain, f.features, pl.calibration, dt, config);
    pl.faceStrain = f.features ? smoothStrain(pl.faceStrain, strainedness(f.features), config.emaAlpha, dt) : 0;
    pl.bank.update(f.roll, dt);
    if (pl.read) {
      pl.read.frames++;
      if (f.features) {
        pl.read.samples.push(f.features);
        if (f.roll !== null) pl.read.rolls.push(f.roll);
      }
    }
    // The finest strain: only while the bird counts it as straining.
    if (this.screen === "match" && this.duel?.phase === "playing" && pl.strain.active) {
      pl.snapshot.offer(this.deps.video, f.box, pl.faceStrain);
    }
  }

  private fresh(pl: Player): boolean {
    return performance.now() - pl.lastFrame < FRESH_MS;
  }

  private faceStraining(pl: Player): boolean {
    return pl.calibration !== null && this.fresh(pl) && pl.strain.active;
  }

  private steerSource(pl: Player): SteerSource {
    return pl.mode === "keys" ? pl.keys : pl.bank;
  }

  private input(pl: Player): DuelInput {
    const straining = pl.mode === "keys" ? pl.keyStrain : this.faceStraining(pl);
    const steer = pl.mode === "keys" || this.fresh(pl) ? this.steerSource(pl).command() : 0;
    return { straining, steer };
  }

  // --- the seat check -------------------------------------------------------------------

  private joinKeys(p: PlayerId): void {
    const pl = this.players[p];
    if (pl.mode === "keys") return;
    pl.mode = "keys";
    pl.phase = "keys";
    pl.read = null;
    pl.calibration = null;
    this.duo.setActive(p, false);
    this.duo.resetPlayer(p);
    this.deps.sound.unlock();
    this.deps.sound.hit(1);
  }

  private resetSeat(pl: Player): void {
    pl.mode = null;
    pl.phase = "empty";
    pl.calibration = null;
    pl.read = null;
    pl.strain = initialStrainState();
    pl.bank.reset();
    pl.enrolled = { relaxed: 0, strained: 0, match: 0 };
    this.duo.resetPlayer(pl.id);
  }

  private updateSeats(now: number): void {
    for (const pl of this.players) {
      if (pl.mode === "keys") continue;
      const track = this.duo.identity.players[pl.id];
      const locked = track.status === "locked";
      if (pl.phase === "empty") {
        if (locked) {
          pl.mode = "face";
          this.startRead(pl, now, 1);
        }
        continue;
      }
      // At the seat check a lost face simply frees the seat.
      if (track.status === "lost") {
        this.resetSeat(pl);
        continue;
      }
      if (pl.phase === "reading") this.updateRead(pl, now);
      else if (pl.phase === "squeeze" && this.faceStraining(pl)) {
        pl.phase = "ready";
        this.deps.sound.hit(2);
      }
      // Enrol descriptors: relaxed during the read, strained once they squeeze.
      if (now - pl.lastEnroll > 350 && this.duo.galleries[pl.id].length < GALLERY_MAX) {
        if (pl.phase === "reading" && pl.enrolled.relaxed < ENROLL_RELAXED) this.enroll(pl, "relaxed", now);
        else if ((pl.phase === "squeeze" || pl.phase === "ready") && pl.strain.active && pl.enrolled.strained < ENROLL_STRAINED) this.enroll(pl, "strained", now);
      }
    }
    const ready = this.players.every((pl) => pl.phase === "ready" || pl.phase === "keys");
    if (!ready) this.bothReadyAt = null;
    else if (this.bothReadyAt === null) this.bothReadyAt = now;
    else if (now - this.bothReadyAt > 900) this.startMatch();
  }

  private enroll(pl: Player, kind: "relaxed" | "strained" | "match", now: number): void {
    pl.lastEnroll = now;
    void this.duo.enroll(pl.id).then((ok) => {
      if (ok) pl.enrolled[kind]++;
    });
  }

  private startRead(pl: Player, now: number, attempt: number): void {
    pl.phase = "reading";
    pl.read = { samples: [], rolls: [], sigs: [], frames: 0, start: now, attempt, lastSig: 0 };
    pl.hint = attempt > 1 ? "Hold still…" : "Relax and look here";
  }

  /** The quick relaxed read, as main.ts's default calibration: retried if the face was fidgety. */
  private updateRead(pl: Player, now: number): void {
    const read = pl.read!;
    if (now - read.lastSig > 300) {
      read.lastSig = now;
      const sig = this.duo.signatureOf(pl.id);
      if (sig) read.sigs.push(sig);
    }
    if (now - read.start < config.defaultNeutralSeconds * 1000) return;
    if (read.samples.length < read.frames * config.minFaceCoverage) {
      this.startRead(pl, now, read.attempt);
      return;
    }
    if (read.samples.length < MIN_RELAXED_SAMPLES) return;
    const cal = defaultCalibration(neutralFaceStats(read.samples), config.defaultStrainScale);
    const falseRate = neutralFalseRate(cal, read.samples, config);
    if (falseRate > MAX_NEUTRAL_FALSE_RATE && read.attempt < MAX_RELAXED_READS) {
      this.startRead(pl, now, read.attempt + 1);
      return;
    }
    pl.calibration = cal;
    pl.homeRoll = median(read.rolls);
    pl.bank.home = pl.homeRoll;
    pl.bank.reset();
    pl.strain = initialStrainState();
    this.duo.refs[pl.id] = averageSignature(read.sigs);
    pl.read = null;
    pl.phase = "squeeze";
    console.info(`[duel] P${pl.id + 1} calibrated`, { falseRate, homeRoll: pl.homeRoll, signature: this.duo.refs[pl.id] !== null });
  }

  private seatInfo(pl: Player, now: number): SeatInfo {
    const keyName = pl.id === 0 ? "W" : "↑";
    const info: SeatInfo = {
      phase: pl.phase, box: this.fresh(pl) ? pl.box : null, strain: this.fresh(pl) ? pl.strain.smoothed : 0,
      strainActive: this.faceStraining(pl), progress: 0, title: "", hint: "", steer: this.steerSource(pl).command(),
    };
    switch (pl.phase) {
      case "empty":
        info.title = this.cameraOk ? `Sit on the ${pl.id === 0 ? "left" : "right"}` : "Press a key to join";
        info.hint = this.cameraOk ? `…or press ${keyName} to play with keys` : `${keyName} to join with keys`;
        break;
      case "reading":
        info.title = pl.hint;
        info.hint = "A quick read of your relaxed face";
        info.progress = pl.read ? (now - pl.read.start) / (config.defaultNeutralSeconds * 1000) : 0;
        break;
      case "squeeze":
        info.title = "Squeeze! 😣";
        info.hint = "Strain your face until the gauge passes the 💩 line";
        break;
      case "ready":
        info.title = "Ready! ✓";
        info.hint = "Squeeze to fly, relax to poop. Spread your wings 🪽 and tilt your head to steer!";
        break;
      case "keys":
        info.title = "Ready on keys ⌨";
        info.hint = pl.id === 0 ? "W squeeze · A / D steer" : "↑ squeeze · ← / → steer";
        break;
    }
    return info;
  }

  // --- the match --------------------------------------------------------------------------

  private startMatch(): void {
    this.bothReadyAt = null;
    this.duel = new Duel(config, (Math.random() * 2 ** 31) >>> 0);
    this.renderer.reset();
    this.accumulator = 0;
    this.resultsAt = null;
    this.resuming = null;
    this.lastBeep = DUEL_COUNTDOWN + 1;
    for (const pl of this.players) {
      pl.snapshot.reset();
      pl.strain = initialStrainState();
      pl.bank.reset();
      pl.keyStrain = false;
      pl.keys.reset();
      pl.enrolled.match = 0;
      this.duo.setAcquire(pl.id, false);
    }
    this.toast = { text: "Squeeze to fly · relax to poop · tilt to steer 🪽", until: performance.now() + DUEL_COUNTDOWN * 1000 };
    this.showScreen("match");
    this.deps.sound.unlock();
  }

  private stepMatch(dt: number, now: number): void {
    const duel = this.duel!;
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= DUEL_STEP) {
      duel.step(DUEL_STEP, [this.input(this.players[0]), this.input(this.players[1])]);
      this.accumulator -= DUEL_STEP;
    }
    for (const e of duel.events) this.onDuelEvent(e, duel);
    duel.events.length = 0;
    // 3-2-1 beeps.
    if (duel.phase === "countdown") {
      const n = Math.ceil(duel.countdown);
      if (n < this.lastBeep) {
        this.lastBeep = n;
        this.deps.sound.cameraBeep(n);
      }
    }
    // A few more descriptors early in the match (only from verified locks).
    if (duel.phase === "playing" && duel.playTime < 5) {
      for (const pl of this.players) {
        const t = this.duo.identity.players[pl.id];
        if (pl.mode === "face" && t.verified && t.status === "locked" && pl.enrolled.match < ENROLL_MATCH && now - pl.lastEnroll > 1200) {
          this.enroll(pl, "match", now);
        }
      }
    }
    if (duel.phase === "over") {
      this.resultsAt ??= now + 1600;
      if (now >= this.resultsAt) this.showResults();
    }
    // Faces out of view, or any doubt about who is who: freeze and ask.
    if (duel.phase === "playing" || duel.phase === "countdown") {
      const why = this.identityProblem(now);
      if (why) this.pause("identity");
    }
  }

  /** Why the match can't run right now (a face player missing or unconfirmed), or null. */
  private identityProblem(now: number): string | null {
    for (const pl of this.players) {
      if (pl.mode !== "face") continue;
      const t = this.duo.identity.players[pl.id];
      const n = pl.id + 1;
      if (t.status === "lost") {
        switch (t.reason) {
          case "swap":
            return "Player 1 sits on the left, Player 2 on the right!";
          case "stranger":
            return `Who's that? Player ${n}, back to your seat!`;
          case "converge":
          case "midline":
          case "jump":
            return `Player ${n}, back to your own seat!`;
          default:
            return `Player ${n}, come back into view!`;
        }
      }
      if (missingFor(this.duo.identity, pl.id, now) > config.duelLostPause) return `Player ${n}, come back into view!`;
    }
    return null;
  }

  private settled(): boolean {
    return identitySettled(this.duo.identity, [this.players[0].mode === "face", this.players[1].mode === "face"], performance.now());
  }

  private onDuelEvent(e: DuelEvent, duel: Duel): void {
    const s = this.deps.sound;
    this.renderer.onEvent(e, duel);
    switch (e.type) {
      case "release":
        s.release(this.poopSize(e.charge), e.charge, e.sweet);
        break;
      case "accident":
        s.accident();
        break;
      case "bomb":
        s.splat(true);
        s.hit(3);
        break;
      case "bump":
        s.bonk();
        break;
      case "crash":
        s.splat(true);
        break;
      case "targetHit":
        s.splat(e.big);
        s.hit(e.combo);
        break;
      case "splat":
        s.splat(e.big);
        break;
      case "go":
        s.cameraBeep(0);
        break;
      case "finish":
        if (e.winner === null) s.sadTrombone();
        else s.weddingMarried();
        break;
      default:
        break;
    }
  }

  private poopSize(charge: number): PoopSize {
    if (charge >= config.poopSoundLarge) return "large";
    if (charge >= config.poopSoundMiddle) return "middle";
    return "weak";
  }

  // --- pause ---------------------------------------------------------------------------

  private pause(reason: "manual" | "identity"): void {
    if (this.screen !== "match" || !this.duel || this.duel.phase === "over" || this.duel.phase === "finishing") return;
    this.pauseReason = reason;
    this.resuming = null;
    this.showScreen("paused");
    for (const pl of this.players) if (pl.mode === "face") this.duo.setAcquire(pl.id, true);
    this.deps.sound.setGroan(-1, false);
    this.updatePauseCard(performance.now());
  }

  private updatePauseCard(now: number): void {
    const problem = this.identityProblem(now) ?? (this.settled() ? null : "Checking who's who… look at the camera.");
    $("duel-pause-title").textContent = problem ? "Hold on!" : "Paused";
    $("duel-pause-text").textContent = problem ?? (this.pauseReason === "identity" ? "Both back! Starting again…" : "");
    for (const pl of this.players) {
      const t = this.duo.identity.players[pl.id];
      show($(`btn-duel-p${pl.id + 1}-keys`), pl.mode === "face" && t.status !== "locked");
    }
  }

  /** Resume (after a 3-2-1) once every face player is back and confirmed. */
  private tryResume(): void {
    if (this.screen !== "paused") return;
    if (this.identityProblem(performance.now()) || !this.settled()) {
      this.updatePauseCard(performance.now());
      return;
    }
    this.resuming = RESUME_COUNTDOWN;
    this.lastBeep = RESUME_COUNTDOWN + 1;
    show($("duel-pause"), false);
  }

  private updatePaused(dt: number, now: number): void {
    if (this.resuming !== null) {
      // Someone left again during the 3-2-1: back to waiting.
      if (this.identityProblem(now) || !this.settled()) {
        this.resuming = null;
        show($("duel-pause"), true);
      } else {
        this.resuming -= dt;
        const n = Math.ceil(this.resuming);
        if (n < this.lastBeep && n > 0) {
          this.lastBeep = n;
          this.deps.sound.cameraBeep(n);
        }
        if (this.resuming <= 0) {
          this.resuming = null;
          for (const pl of this.players) this.duo.setAcquire(pl.id, false);
          this.showScreen("match");
          return;
        }
      }
    } else {
      this.updatePauseCard(now);
      if (this.pauseReason === "identity" && !this.identityProblem(now) && this.settled()) this.tryResume();
    }
  }

  // --- results ---------------------------------------------------------------------------

  private showResults(): void {
    const duel = this.duel!;
    this.showScreen("results");
    const winner = duel.winner;
    $("duel-winner").textContent = winner === null ? "It's a tie! 🤝" : `👑 Player ${winner + 1} wins!`;
    let best: { p: PlayerId; strain: number } | null = null;
    for (const pl of this.players) {
      const b = duel.birds[pl.id];
      const el = $(`duel-res-${pl.id}`);
      el.classList.toggle("winner", winner === pl.id);
      $(`duel-res-${pl.id}-score`).textContent = String(b.score);
      $(`duel-res-${pl.id}-targets`).textContent = `${b.stats.targets} · +${b.stats.targetPoints}`;
      $(`duel-res-${pl.id}-bombs`).textContent = `${b.stats.bombs} · +${b.stats.bombPoints}`;
      $(`duel-res-${pl.id}-crashes`).textContent = `${b.stats.crashes} · −${b.stats.penalty}`;
      $(`duel-res-${pl.id}-combo`).textContent = `x${duel.comboMultiplier(b.stats.bestCombo).toFixed(1)}`;
      const img = $<HTMLImageElement>(`duel-res-${pl.id}-photo`);
      const url = pl.mode === "face" ? pl.snapshot.toDataURL() : null;
      img.src = url ?? "";
      show(img, url !== null);
      show($(`duel-res-${pl.id}-nophoto`), url === null);
      $(`duel-res-${pl.id}-nophoto`).textContent = pl.mode === "keys" ? "⌨️" : "🙈";
      const peak = pl.snapshot.peakStrain;
      if (url && peak > 0 && (!best || peak > best.strain)) best = { p: pl.id, strain: peak };
    }
    $("duel-award").textContent = best ? `😣 Most strained face: Player ${best.p + 1} (${strainPercent(best.strain)})` : "";
    show($("duel-award"), best !== null);
  }

  private rematch(): void {
    if (this.screen !== "results") return;
    this.clearPhotos();
    this.startMatch();
  }

  private clearPhotos(): void {
    for (const p of [0, 1]) {
      const img = $<HTMLImageElement>(`duel-res-${p}-photo`);
      img.removeAttribute("src");
    }
  }

  // --- screens and loop ---------------------------------------------------------------------

  private showScreen(screen: Screen): void {
    this.screen = screen;
    show($("duel-seats"), screen === "seats");
    show($("duel-pause"), screen === "paused");
    show($("duel-results"), screen === "results");
    this.keysArmedAt = performance.now() + (screen === "results" ? 700 : 250);
    if (screen !== "match") this.deps.sound.setGroan(-1, false);
  }

  private frame(t: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, (t - this.lastTime) / 1000));
    this.lastTime = t;
    const now = performance.now();
    try {
      this.tick(dt, now);
    } catch (err) {
      console.error("[duel] frame error", err);
    }
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private tick(dt: number, now: number): void {
    for (const e of this.duo.drainEvents()) {
      if (e.type === "remap") this.onRemap();
    }
    if (this.screen === "seats") {
      this.updateSeats(now);
      this.backdrop.step(dt, [{ straining: false, steer: 0 }, { straining: false, steer: 0 }]);
      this.backdrop.countdown = DUEL_COUNTDOWN;
      this.renderer.drawSeats(
        {
          video: this.cameraOk ? this.deps.video : null,
          message: this.cameraMessage,
          seats: [this.seatInfo(this.players[0], now), this.seatInfo(this.players[1], now)],
          strainOn: config.strainOn,
          debug: this.debugOverlay(),
        },
        this.backdrop,
        dt,
      );
      return;
    }
    const duel = this.duel!;
    if (this.screen === "match") this.stepMatch(dt, now);
    else if (this.screen === "paused") this.updatePaused(dt, now);
    const charging = this.screen === "match" ? Math.max(...duel.birds.map((b) => (b.charge.stun > 0 ? 0 : b.charge.charge))) : 0;
    this.deps.sound.setGroan(charging > 0 ? charging : -1, duel.overstrain(0) > 0 || duel.overstrain(1) > 0);
    const banner = this.screen === "paused" && this.resuming !== null ? String(Math.max(1, Math.ceil(this.resuming))) : null;
    if (this.toast && now > this.toast.until) this.toast = null;
    this.renderer.draw(
      {
        duel,
        video: this.cameraOk ? this.deps.video : null,
        players: [this.hud(this.players[0]), this.hud(this.players[1])],
        strainOn: config.strainOn,
        banner,
        toast: this.toast?.text ?? null,
        debug: this.debugOverlay(),
      },
      this.screen === "match" ? dt : 0,
    );
  }

  /** The locks changed owners: each player's data stays theirs; only their smoothed face signals start over. */
  private onRemap(): void {
    for (const pl of this.players) {
      pl.strain = initialStrainState();
      pl.bank.reset();
      pl.faceStrain = 0;
    }
    this.toast = { text: "🔄 Players swapped seats", until: performance.now() + 2200 };
  }

  private hud(pl: Player): HudPlayer {
    const fresh = this.fresh(pl);
    return {
      mode: pl.mode === "keys" ? "keys" : "face",
      faceBox: fresh ? pl.box : null,
      strain: fresh ? pl.strain.smoothed : 0,
      strainActive: pl.mode === "keys" ? pl.keyStrain : this.faceStraining(pl),
      steer: this.input(pl).steer,
    };
  }

  // --- input -------------------------------------------------------------------------------

  private bindInput(): void {
    const on = (target: Window | Document, type: string, fn: (e: Event) => void) => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    on(window, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    on(window, "keyup", (e) => this.onKeyUp(e as KeyboardEvent));
    on(window, "blur", () => this.releaseKeys());
    on(window, "resize", () => this.renderer.resize());
    on(document, "visibilitychange", () => {
      if (!document.hidden) return;
      this.releaseKeys();
      this.pause("manual");
    });
    const click = (id: string, fn: () => void) => {
      const el = $(id);
      const handler = () => {
        fn();
        el.blur();
      };
      el.addEventListener("click", handler);
      this.cleanup.push(() => el.removeEventListener("click", handler));
    };
    click("btn-duel-back", () => this.exit());
    click("btn-duel-keys", () => {
      this.joinKeys(0);
      this.joinKeys(1);
    });
    click("btn-duel-retry", () => void this.startCamera());
    click("btn-duel-resume", () => this.tryResume());
    click("btn-duel-menu", () => this.exit());
    click("btn-duel-p1-keys", () => this.switchToKeys(0));
    click("btn-duel-p2-keys", () => this.switchToKeys(1));
    click("btn-duel-rematch", () => this.rematch());
    click("btn-duel-results-menu", () => this.exit());
  }

  /** Mid-match escape hatch: a face player who can't be found again plays on with keys. */
  private switchToKeys(p: PlayerId): void {
    const pl = this.players[p];
    pl.mode = "keys";
    pl.phase = "keys";
    this.duo.setActive(p, false);
    this.duo.resetPlayer(p);
    this.updatePauseCard(performance.now());
  }

  private releaseKeys(): void {
    for (const pl of this.players) {
      pl.keyStrain = false;
      pl.keys.reset();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const playerKey = this.playerKey(e.code);
    if (!playerKey && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const btn = buttonForKey(keyName(e));
      if (btn && this.root.contains(btn)) {
        e.preventDefault();
        if (performance.now() >= this.keysArmedAt) pressFromKey(btn);
        return;
      }
    }
    if (playerKey) {
      e.preventDefault();
      const [p, what] = playerKey;
      const pl = this.players[p];
      if (what === "strain") {
        if (this.screen === "seats" && !e.repeat) this.joinKeys(p);
        if (pl.mode === "keys") pl.keyStrain = true;
      } else if (what === "left") pl.keys.left = true;
      else pl.keys.right = true;
      this.deps.sound.unlock();
      return;
    }
    if (e.repeat) return;
    switch (e.key.toLowerCase()) {
      case "p":
      case "escape":
        if (this.screen === "match") this.pause("manual");
        else if (this.screen === "paused" && this.resuming !== null) {
          // Stop the 3-2-1: back to the pause card.
          this.resuming = null;
          this.pauseReason = "manual";
          show($("duel-pause"), true);
          this.updatePauseCard(performance.now());
        } else if (this.screen === "paused") this.tryResume();
        break;
      case "m":
        this.deps.toggleMute();
        break;
      case "g":
        // Debug: a gate right now.
        if (DEBUG && this.screen === "match" && this.duel?.phase === "playing") this.duel.spawnGateNow();
        break;
      case "j":
        // Debug: skip the Squeeze step for seated faces (testing with recorded or photo faces).
        if (DEBUG && this.screen === "seats") for (const pl of this.players) if (pl.phase === "squeeze") pl.phase = "ready";
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const playerKey = this.playerKey(e.code);
    if (!playerKey) return;
    const [p, what] = playerKey;
    const pl = this.players[p];
    if (what === "strain") pl.keyStrain = false;
    else if (what === "left") pl.keys.left = false;
    else pl.keys.right = false;
  }

  private playerKey(code: string): [PlayerId, "strain" | "left" | "right"] | null {
    switch (code) {
      case "KeyW":
        return [0, "strain"];
      case "KeyA":
        return [0, "left"];
      case "KeyD":
        return [0, "right"];
      case "ArrowUp":
        return [1, "strain"];
      case "ArrowLeft":
        return [1, "left"];
      case "ArrowRight":
        return [1, "right"];
      default:
        return null;
    }
  }

  // --- leaving -----------------------------------------------------------------------------

  private exit(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    // Drops the locks, references and face descriptors with the landmarkers.
    this.duo.dispose();
    this.clearPhotos();
    for (const pl of this.players) pl.snapshot.reset();
    this.deps.sound.setGroan(-1, false);
    this.videoHome.parent.insertBefore(this.deps.video, this.videoHome.next);
    show(this.root, false);
    for (const id of ["duel-seats", "duel-pause", "duel-results"]) show($(id), false);
    active = null;
    this.deps.onExit();
  }

  // --- debug ---------------------------------------------------------------------------------

  private debugOverlay(): DebugOverlay | null {
    if (!DEBUG || !this.cameraOk) return null;
    const id = this.duo.identity;
    const r = this.duo.recognizer;
    const fmt = (d: [number, number] | null) => (d ? `${d[0].toFixed(2)}/${d[1].toFixed(2)}` : "–");
    const lines = [
      `id: ${this.duo.recognizing ? `face ID (${r.backend}, ${r.lastMs.toFixed(0)}ms)` : `fallback (face ID ${r.status})`}${this.duo.alternating ? " · seats alternate" : ""}`,
      ...([0, 1] as const).map((p) => {
        const t = id.players[p];
        return `P${p + 1} ${t.status}${t.verified ? "✓" : ""}${t.suspicious ? "?" : ""} d(G1/G2)=${fmt(t.dist)} sim=${fmt(t.sim)} gal=${this.duo.galleries[p].length} ${this.duo.detectionRate(p)}/s ${this.duo.detectionMs(p).toFixed(0)}ms`;
      }),
      `events: remap ${id.counts.remap} stranger ${id.counts.stranger} swap ${id.counts.swap} jump ${id.counts.jump} conv ${id.counts.converge} lost ${id.counts.lost}`,
    ];
    return {
      lines,
      seats: ([0, 1] as const).map((p) => ({
        region: this.duo.seatDebug[p].region,
        masks: this.duo.seatDebug[p].masks,
        lock: id.players[p].box,
        status: id.players[p].status,
      })),
    };
  }

  debugInfo(): unknown {
    const r = this.duo.recognizer;
    return {
      screen: this.screen,
      duel: this.duel,
      players: this.players.map((pl) => ({ mode: pl.mode, phase: pl.phase, calibrated: pl.calibration !== null, homeRoll: pl.homeRoll, steer: this.input(pl).steer, gallery: this.duo.galleries[pl.id].length })),
      identity: { mode: this.duo.recognizing ? "recognition" : "fallback", counts: { ...this.duo.identity.counts }, players: this.duo.identity.players },
      recognizer: { status: r.status, backend: r.backend, lastMs: r.lastMs },
      /** The recognizer itself, for timing it from the console. */
      recognizerRef: r,
      detection: ([0, 1] as const).map((p) => ({ rate: this.duo.detectionRate(p), ms: this.duo.detectionMs(p), ...this.duo.stats[p] })),
      delegate: this.duo.delegate,
      alternating: this.duo.alternating,
    };
  }
}
