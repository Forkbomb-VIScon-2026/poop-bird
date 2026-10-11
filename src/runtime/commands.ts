/** Application commands, separate from continuous input and frame data. */
export type SpawnKind = "shore" | "powerLine" | "paparazzo" | "kid" | "wedding" | "balloon" | "angler" | "shark" | "anchor" | "car";
export type GameCommand =
  | { type: "reset" }
  | { type: "resize"; width: number }
  | { type: "demo" }
  | { type: "perch" }
  | { type: "takeOff" }
  | { type: "dive" }
  | { type: "lesson"; stage: "city" | "ocean"; enabled: boolean }
  | { type: "guideFish"; y: number | null }
  | { type: "spawn"; kind: SpawnKind };
