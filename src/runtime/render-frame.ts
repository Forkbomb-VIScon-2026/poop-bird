import type { Game } from "../game";

/** Presentation data only: no reset, spawn, step or other simulation commands.
 * Entity types remain shared during the incremental migration; ownership is
 * enforced by the engine and verified by frozen-state browser checks.
 */
export type RenderFrame = Readonly<Pick<Game,
  | "angler" | "balloons" | "bird" | "bodyRadius" | "bouquet" | "cameraY"
  | "charge" | "decals" | "demo" | "doves" | "eaten" | "fish" | "flash"
  | "floaters" | "jellies" | "obstacles" | "overstrainProgress" | "particles"
  | "pebbles" | "perchX" | "phase" | "polaroid" | "poops" | "popProgress"
  | "popWarning" | "powerLines" | "screenSplats" | "shake" | "shark" | "shore"
  | "speed" | "spike" | "stage" | "stageOffset" | "stunned" | "sweetSpot"
  | "targets" | "time" | "transition" | "wedding" | "zapFlash" | "zapped"
>>;

export type BirdLook = Readonly<Pick<RenderFrame,
  "stunned" | "phase" | "overstrainProgress" | "zapped" | "zapFlash" | "time"
>> & { readonly bird: Readonly<Game["bird"]>; readonly charge: Readonly<Game["charge"]> };

export type FishLook = Readonly<Pick<RenderFrame,
  "phase" | "stunned" | "popProgress" | "popWarning" | "bodyRadius" | "time"
>> & { readonly bird: Readonly<Game["bird"]>; readonly fish: Readonly<Game["fish"]> };
