// Sound and haptics for the simulation's events. main.ts drains game.events
// through playFeedback() each frame, then does whatever else an event means
// for the app (the game-over screen, photos, the lessons). Every event type
// has an entry, so a new GameEvent won't compile until it's given one.

import type { PoopSize, Sound } from "./audio";
import { config } from "./config";
import type { GameEvent } from "./game";
import { isTouch } from "./ui/dom";

type Pattern = number | number[];

interface Feedback<E> {
  sound?: (sound: Sound, e: E) => void;
  /** A vibration on phones: a pattern, or one picked for the event. */
  buzz?: Pattern | ((e: E) => Pattern);
}

const FEEDBACK: { [T in GameEvent["type"]]: Feedback<Extract<GameEvent, { type: T }>> } = {
  release: {
    sound: (s, e) => s.release(poopSize(e.charge), e.charge, e.sweet),
    buzz: (e) => (e.sweet ? [15, 40, 25] : Math.round(8 + 20 * e.charge)),
  },
  accident: { sound: (s) => s.accident(), buzz: [60, 40, 120] },
  splat: { sound: (s, e) => s.splat(e.big) },
  hit: { sound: (s, e) => s.hit(e.combo), buzz: 12 },
  crash: { sound: (s) => s.splat(true), buzz: 200 },
  chomp: { sound: (s) => s.sharkBite(), buzz: [80, 40, 200] },
  zap: { sound: (s) => s.zap(), buzz: [30, 20, 30, 20, 120] },
  droneDown: { sound: (s) => s.powerDown() },
  droneCrashed: { sound: (s) => s.droneCrash(), buzz: [20, 30, 60] },
  gameover: {},
  gateEntered: {
    sound: (s, e) => {
      if (e.to === "ocean") s.splash();
    },
  },
  submerged: {},
  breached: { sound: (s) => s.splash() },
  transformed: { sound: (s) => s.splash() },
  surfaced: { sound: (s) => s.splash() },
  spike: { sound: (s) => s.spike() },
  pop: { sound: (s) => s.deflate(), buzz: 120 },
  jellyPopped: { sound: (s, e) => s.jellyPop(e.combo) },
  paparazzoBeep: { sound: (s, e) => s.cameraBeep(e.timer) },
  photo: { sound: (s) => s.shutter() },
  cameraSmashed: { sound: (s) => s.smash() },
  slingshotDraw: { sound: (s, e) => s.slingshotDraw(e.windup) },
  slingshotFire: { sound: (s) => s.slingshotFire() },
  bonk: { sound: (s) => s.bonk(), buzz: 80 },
  pebbleShot: { sound: (s, e) => s.pebbleShot(e.combo) },
  ricochet: { sound: (s) => s.ricochet() },
  kidCried: { sound: (s) => s.kidCry() },
  curse: { sound: (s) => s.curse() },
  weddingArrived: { sound: (s) => s.weddingArrived() },
  weddingBeat: { sound: (s, e) => s.weddingBeat(e.count) },
  weddingKiss: { sound: (s) => s.weddingKiss() },
  weddingRuined: { sound: (s) => s.weddingRuined() },
  weddingMarried: { sound: (s) => s.weddingMarried() },
  weddingPhoto: { sound: (s) => s.shutter() },
  bouquetThrown: { sound: (s, e) => s.bouquetThrown(e.angry) },
  bouquetCaught: { sound: (s) => s.bouquetCaught() },
  bouquetHit: { sound: (s) => s.bouquetHit() },
  balloonPop: {
    sound: (s, e) => {
      s.balloonPop();
      s.hit(e.combo);
    },
  },
  chuteOpen: { sound: (s) => s.chuteOpen() },
  basketLanded: { sound: (s) => s.basketLanded() },
  burner: { sound: (s) => s.burner() },
  threaded: { sound: (s) => s.hit(4) },
  anglerCast: { sound: (s) => s.anglerCast() },
  anglerHooked: { sound: (s) => s.anglerHooked(), buzz: [40, 30, 40] },
  anglerReel: { sound: (s) => s.reelClick() },
  anglerLanded: { sound: (s) => s.splash(), buzz: 200 },
  anglerPhoto: { sound: (s) => s.shutter() },
  lineSnapped: { sound: (s) => s.lineSnap(), buzz: 60 },
  sharkNote: { sound: (s, e) => s.sharkNote(e.high, e.volume) },
  sharkWindup: {},
  sharkLunge: { sound: (s) => s.sharkLunge() },
  sharkSpiked: {
    sound: (s, e) => {
      s.sharkYelp();
      s.hit(e.combo);
    },
    buzz: [40, 30, 80],
  },
  // No sound: the beep got on everyone's nerves.
  anchorWarn: {},
  anchorRattle: { sound: (s) => s.anchorRattle() },
  anchorSnapped: { sound: (s) => s.lineSnap() },
  anchorLanded: { sound: (s) => s.anchorLanded(), buzz: 50 },
};

/** Plays an event's sound and vibration. */
export function playFeedback(sound: Sound, e: GameEvent): void {
  const f = FEEDBACK[e.type] as Feedback<GameEvent>;
  f.sound?.(sound, e);
  if (f.buzz !== undefined) buzz(sound, typeof f.buzz === "function" ? f.buzz(e) : f.buzz);
}

/** Which poop sample a release at this charge plays. */
function poopSize(charge: number): PoopSize {
  if (charge >= config.poopSoundLarge) return "large";
  if (charge >= config.poopSoundMiddle) return "middle";
  return "weak";
}

/** A short buzz on phones that support it (not iOS). Muting silences it too. */
function buzz(sound: Sound, pattern: Pattern): void {
  if (sound.muted || !isTouch) return;
  navigator.vibrate?.(pattern);
}
