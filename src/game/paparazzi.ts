// Paparazzi walk up with the camera raised while a timer fills; if it fills,
// the shot of the player's face makes the front page (on a billboard).
// Splatting them first smashes the camera.

import { config } from "../config";
import { pick } from "../random";
import { burst, UPWARD } from "./effects";
import type { Game } from "./game";
import { kidArmed } from "./kids";
import { makeTarget, type Target } from "./street";
import { weddingAhead } from "./wedding";
import { GROUND_Y } from "./world";

/** A paparazzo's photo that made it to print. `photoId` keys the image main.ts captured. */
export interface Tabloid {
  photoId: number;
  headline: string;
}

/**
 * The paparazzo's state. Watching: walking up with the camera raised while
 * his timer ring fills; it's full when he's just past the bird, and he takes
 * the shot. Snapped: he got it (the photo is published). Smashed: a poop got
 * him first.
 */
export type PaparazzoState = "watching" | "snapped" | "smashed";

export interface Paparazzo {
  state: PaparazzoState;
  /** 0..1 timer ring: how close he is to the shot. */
  timer: number;
  /** Where he spawned, so the timer runs from there to the bird. */
  startX: number;
  /** The run's first paparazzo walks slower. */
  tutorial: boolean;
  /** Camera angle toward the bird (radians, screen space). */
  aim: number;
  /** Seconds of the lens flash burst. */
  flash: number;
  /** Counts down to the next tick of the camera beep, which speeds up as the timer fills. */
  beep: number;
}

const SNAP_MESSAGES = ["SNAP!", "SAY CHEESE!", "CAUGHT ON CAMERA!", "*CLICK*", "GOT YOU!"];

const HEADLINES = [
  "LOCAL BIRD STRAINS IN PUBLIC",
  "SHOCK PICS: THE FACE OF EFFORT",
  "\u201CI WAS JUST FLYING\u201D CLAIMS BIRD",
  "CONSTIPATION CRISIS GRIPS CITY",
  "BIRD'S PRIVATE MOMENT EXPOSED",
  "PUSHING IT TOO HARD?",
  "IS THIS THE WORST FACE EVER?",
  "FIBRE SHORTAGE: THE HUMAN COST",
  "EXPERTS: \u201CJUST RELAX\u201D",
];

export function paparazzoDue(g: Game): boolean {
  return (
    !g.gateSpawned &&
    g.distance >= config.paparazziMinDistance &&
    g.distance - g.lastPaparazzoAt >= config.paparazziMinGap &&
    !g.targets.some((t) => t.pap?.state === "watching") &&
    !g.targets.some(kidArmed) &&
    !weddingAhead(g)
  );
}

export function spawnPaparazzo(g: Game): void {
  g.lastPaparazzoAt = g.distance;
  const tutorial = g.paparazziSeen++ === 0;
  const x = g.width + 60;
  g.targets.push(makeTarget({
    x, y: GROUND_Y + 20, w: 56, h: 66, kind: "paparazzo",
    // The first one walks along with the bird, so there's time to figure him out.
    speed: tutorial ? config.paparazziTutorialWalk : 0,
    color: "#6d6875", seed: Math.random() * 1000, facing: -1,
    pap: { state: "watching", timer: 0, startX: x, tutorial, aim: -2.4, flash: 0, beep: 0 },
  }));
}

export function updatePaparazzo(g: Game, t: Target, dt: number): void {
  const p = t.pap!;
  p.flash = Math.max(0, p.flash - dt);
  if (p.state !== "watching") return;
  // Camera position (see drawPaparazzo): at shoulder height, aiming at the bird.
  const camY = t.y - t.h * 0.72;
  p.aim += (Math.atan2(g.bird.y - camY, g.bird.x - t.x) - p.aim) * Math.min(1, dt * 8);
  if (g.phase !== "playing") return;

  // The timer fills from where he walked on to just past the bird.
  const shotX = g.bird.x - config.paparazziShotOffset;
  p.timer = Math.min(1, Math.max(0, (p.startX - t.x) / Math.max(1, p.startX - shotX)));
  if (p.timer >= 1) {
    snap(g, t);
    return;
  }
  // Camera beep, faster as the timer fills (only once he's on screen).
  if (t.x < g.width) {
    p.beep -= dt;
    if (p.beep <= 0) {
      p.beep = 0.6 - p.timer * 0.48;
      g.events.push({ type: "paparazzoBeep", timer: p.timer });
    }
  }
}

/** He got the shot: flash, polaroid, and it's on the next obstacle as a tabloid front page. */
function snap(g: Game, t: Target): void {
  const p = t.pap!;
  p.state = "snapped";
  p.timer = 1;
  p.flash = 0.25;
  t.speed = 0;
  const photoId = g.newPhotoId();
  g.flash = 1;
  g.shakeAtLeast(6);
  g.polaroid = { photoId, life: 2.2, maxLife: 2.2 };
  g.say(SNAP_MESSAGES, 1.4);
  const tabloid: Tabloid = { photoId, headline: pick(HEADLINES) };
  g.frontPages.push(tabloid);
  g.pendingTabloids.push(tabloid);
  g.events.push({ type: "photo", photoId });
}

/** A poop got him before the shot: the camera's done for. */
export function smashCamera(g: Game, t: Target): void {
  const p = t.pap!;
  p.state = "smashed";
  t.speed = 0;
  g.camerasSmashed++;
  // Lens shards, from the camera at his shoulder.
  burst(g, t.x, t.y - t.h * 0.72, 16, {
    angle: UPWARD, speed: [80, 280], life: [0.5, 0.9], maxLife: 0.9, size: [1.5, 4], color: ["#caf0f8", "#adb5bd"], gravity: 800,
  });
  g.floater(t.x, t.y - t.h - 44, "NO PHOTOS!", "#7ae582", 24, 1.3);
  g.events.push({ type: "cameraSmashed" });
}
