// What the simulation tells main.ts (sound, haptics, UI, photos), drained every frame.

import type { TargetKind } from "./street";
import type { Stage } from "./world";

export type GameEvent =
  | { type: "sharkNote"; high: boolean; volume: number }
  | { type: "sharkWindup" }
  | { type: "sharkLunge" }
  | { type: "sharkSpiked"; points: number; combo: number }
  | { type: "chomp" }
  | { type: "release"; charge: number; sweet: boolean }
  | { type: "accident"; message: string }
  | { type: "splat"; big: boolean }
  | { type: "hit"; points: number; combo: number; kind: TargetKind | "pigeon" }
  | { type: "crash" }
  | { type: "zap" }
  | { type: "droneDown" }
  | { type: "droneCrashed" }
  | { type: "gameover" }
  | { type: "gateEntered"; to: Stage }
  | { type: "submerged" }
  | { type: "breached" }
  | { type: "transformed" }
  | { type: "surfaced" }
  | { type: "spike" }
  | { type: "pop"; message: string }
  | { type: "jellyPopped"; points: number; combo: number }
  | { type: "paparazzoBeep"; timer: number }
  | { type: "photo"; photoId: number }
  | { type: "cameraSmashed" }
  | { type: "slingshotDraw"; windup: number }
  | { type: "slingshotFire" }
  | { type: "bonk" }
  | { type: "pebbleShot"; points: number; combo: number }
  | { type: "ricochet" }
  | { type: "kidCried" }
  | { type: "curse" }
  | { type: "weddingArrived" }
  | { type: "weddingBeat"; count: number }
  | { type: "weddingKiss" }
  | { type: "weddingRuined"; points: number }
  | { type: "weddingMarried" }
  | { type: "weddingPhoto"; photoId: number; ruined: boolean }
  | { type: "bouquetThrown"; angry: boolean }
  | { type: "bouquetCaught"; points: number }
  | { type: "bouquetHit" }
  | { type: "balloonPop"; points: number; combo: number }
  | { type: "chuteOpen" }
  | { type: "basketLanded" }
  | { type: "burner" }
  | { type: "threaded"; points: number }
  | { type: "anglerCast" }
  | { type: "anglerHooked" }
  | { type: "anglerReel" }
  | { type: "anglerLanded"; photoId: number }
  | { type: "anglerPhoto" }
  | { type: "lineSnapped"; points: number }
  | { type: "anchorWarn" }
  | { type: "anchorRattle" }
  | { type: "anchorSnapped" }
  | { type: "anchorLanded" };
