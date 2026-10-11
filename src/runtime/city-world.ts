/** Versioned, coarse Rust world boundary. Only migrated modes are exposed. */
import { config } from "../config";
import { initialSpikeState } from "../swim";
import type { GameEvent, Target } from "../game";
import type { RenderFrame } from "./render-frame";
import type { CityWorld as WasmCityWorld } from "../../public/game-wasm/poop_bird_wasm";

declare const __APP_COMMIT__: string;
export const CITY_PARAM_KEYS = ["chargeTime", "overstrainTime", "sweetSpotWindow", "sweetSpotMultiplier", "stunTime", "pushMin", "pushMax", "pushCurve",
  "gravity", "startGrace", "chargeGravityScale", "maxFallSpeed", "chargeMaxFallSpeed", "scrollSpeed", "poopGravity", "fallCancel",
  "targetSpawnRate", "statueChance", "angryChance", "angryDuration", "targetPoints", "comboMax", "comboStep"] as const;
const CARS = ["#e84a5f", "#2a9df4", "#ffb400", "#5cc96b", "#9b5de5", "#f9844a"];
const PEOPLE = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#fd79a8", "#00b894"];
const PARTICLES = ["#ffd166", "#fff", "#b5c99a", "#ffe066", "#7a4a1e", "#5c3310", "#8b5a2b", "#6b3e14", "#ffe14d"];
const FLOATERS = ["#ffd000", "#fff", "#e9f5db", "#ffe14d", "#ffd6d6"];
const CURSES = ["#@$%!", "%&#@!!", "$#!*@", "@#%&$!", "*!#@%"];
const ACCIDENTS = ["CODE BROWN!", "Oops… that wasn't a fart", "TOO MUCH PRESSURE!", "Should've had more fiber", "Abort! ABORT!", "Sharted mid-air", "Push gently, they said", "That's going to stain"];
const KINDS = ["car", "pedestrian", "statue"] as const;
export type CityCommand = { type: "reset" | "demo" | "perch" | "spawnCar" } | { type: "resize"; width: number };
export type CityFrame = RenderFrame & {
  width: number; runTime: number; stageTime: number; distance: number; bonus: number;
  combo: number; bestCombo: number; targetsHit: number; poopsDropped: number; accidents: number;
  message: { text: string; life: number } | null; events: GameEvent[];
  targets: (Target & { id: number })[];
};

export function decodeCityFrame(data: Float64Array): CityFrame {
  let cursor = 0;
  const n = () => { if (cursor >= data.length) throw new Error("Truncated city frame"); const value = data[cursor++]; if (!Number.isFinite(value)) throw new Error("Non-finite city frame"); return value; };
  const count = () => { const value = n(); if (value < 0 || !Number.isInteger(value) || value > 0xffffffff) throw new Error("Invalid city frame integer"); return value; };
  const length = () => { const value = count(); if (value > data.length - cursor) throw new Error("Invalid city frame count"); return value; };
  const at = <T>(table: readonly T[], index: number) => { if (!Number.isInteger(index) || index < 0 || index >= table.length) throw new Error("Unknown city frame enum"); return table[index]; };
  const entry = <T>(table: readonly T[]) => at(table, count());
  const boolean = () => entry([false, true]);
  if (n() !== 1) throw new Error("Unsupported city frame version");
  const width = n(); const mode = entry(["idle", "demo", "practice"]);
  const time = n(); const runTime = n();
  const bird = { x: n(), y: n(), vy: n(), rot: n(), stretch: n(), stretchV: n(), relief: n(), flap: n() };
  const charge = { charge: n(), fullHold: n(), stun: n(), needsRelease: boolean() };
  const hasPerch = boolean(); const px = n(); const speed = n(); const stageTime = n();
  const distance = n(); const bonus = n(); const combo = count(); const bestCombo = count();
  const targetsHit = count(); const poopsDropped = count(); const accidents = count(); const shake = n();
  const messageIndex = n(); const messageLife = n();
  if (!Number.isInteger(messageIndex) || messageIndex < -1 || messageIndex >= ACCIDENTS.length) throw new Error("Invalid city message");
  const counts = Array.from({ length: 7 }, length);
  const targets = Array.from({ length: counts[0] }, () => {
    const id = count(); const kind = entry(KINDS);
    const x = n(), y = n(), w = n(), h = n(), speed = n(); const colorIndex = count();
    const colors = kind === "car" ? CARS : kind === "pedestrian" ? PEOPLE : ["#8fa3a8"];
    if (colorIndex >= colors.length) throw new Error("Invalid target color");
    const seed = n(), hitFlash = n(), facing = n();
    if (facing !== -1 && facing !== 1) throw new Error("Invalid target facing");
    const raging = boolean(); const t = n(), walk = n(); const curse = entry(CURSES);
    const splats = Array.from({ length: length() }, () => ({ dx: n(), dy: n(), r: n(), seed: n() }));
    return { id, kind, x, y, w, h, speed, color: colors[colorIndex], seed, hitFlash, facing,
      splats, pap: null, kid: null, chute: null, rage: raging ? { t, walk, curse } : null } satisfies Target & { id: number };
  });
  const poops = Array.from({ length: counts[1] }, () => ({ id: count(), x: n(), y: n(), vx: n(), vy: n(), r: n(), big: boolean(), trail: n(), rot: n() }));
  const particles = Array.from({ length: counts[2] }, () => ({ x: n(), y: n(), vx: n(), vy: n(), life: n(), maxLife: n(), size: n(), color: entry(PARTICLES), gravity: n(), world: boolean() }));
  const decals = Array.from({ length: counts[3] }, () => ({ x: n(), y: n(), r: n(), seed: n() }));
  const floaters = Array.from({ length: counts[4] }, () => {
    const x = n(), y = n(), textCode = entry([0, 1, 2, 3, 4]), points = n(), multiplier = n();
    const text = ["PERFECT PUSH!", "BIG ONE!", "pfft", multiplier < 0 ? `+${points}` : `+${points}  x${multiplier.toFixed(1)}`, "combo lost"][textCode];
    return { x, y, text, color: entry(FLOATERS), size: n(), life: n(), maxLife: n() };
  });
  const screenSplats = Array.from({ length: counts[5] }, () => ({ x: n(), y: n(), r: n(), seed: n(), life: n() }));
  const events = Array.from({ length: counts[6] }, (): GameEvent => {
    const type = entry([0, 1, 2, 3, 4]); const a = n(), b = n(), c = n(); n();
    switch (type) {
      case 0: return { type: "release", charge: a, sweet: at([false, true], b) };
      case 1: return { type: "accident", message: at(ACCIDENTS, a) };
      case 2: return { type: "hit", points: a, combo: b, kind: at(KINDS, c) };
      case 3: return { type: "splat", big: at([false, true], a) };
      default: return { type: "curse" };
    }
  });
  if (cursor !== data.length) throw new Error("Trailing city frame data");
  return { width, time, runTime, stageTime, bird, charge, speed, distance, bonus, combo, bestCombo, targetsHit, poopsDropped, accidents, shake,
    message: messageIndex < 0 ? null : { text: ACCIDENTS[messageIndex], life: messageLife }, events,
    targets, poops, particles, decals, floaters, screenSplats,
    phase: "playing", stage: "city", demo: mode === "demo", perchX: hasPerch ? px : null,
    stunned: charge.stun > 0, bodyRadius: 22, overstrainProgress: charge.charge >= 1 ? Math.min(1, charge.fullHold / Math.max(1e-3, config.overstrainTime)) : 0,
    sweetSpot: charge.charge >= 1 && config.sweetSpotWindow > 0 && charge.fullHold >= config.overstrainTime - config.sweetSpotWindow && charge.fullHold <= config.overstrainTime,
    cameraY: 0, stageOffset: 0, flash: 0, zapFlash: 0, zapped: false, eaten: false, polaroid: null,
    fish: { puff: 0, spikes: 0, flare: 0 }, spike: initialSpikeState(), popWarning: false, popProgress: 0,
    transition: null, shore: null, wedding: null, bouquet: null, angler: null, shark: null,
    obstacles: [], powerLines: [], balloons: [], pebbles: [], jellies: [], doves: [],
  };
}

export class CityRuntime {
  private readonly parameters = new Float64Array(CITY_PARAM_KEYS.length);
  private readonly request = new Float64Array(4 + 64 * 2);
  private readonly world: Pick<WasmCityWorld, "advance" | "free">;
  constructor(world: Pick<WasmCityWorld, "advance" | "free">) { this.world = world; }
  advance(dt: number, ticks: number, held = false, commands: readonly CityCommand[] = []): CityFrame {
    if (commands.length > 64) throw new Error("City command batch exceeds 64");
    CITY_PARAM_KEYS.forEach((key, i) => { this.parameters[i] = config[key]; });
    this.request.set([dt, ticks, +held, commands.length]);
    commands.forEach((command, i) => {
      const code = { reset: 0, resize: 1, demo: 2, perch: 3, spawnCar: 4 }[command.type];
      this.request.set([code, command.type === "resize" ? command.width : 0], 4 + i * 2);
    });
    return decodeCityFrame(this.world.advance(this.parameters, this.request.subarray(0, 4 + commands.length * 2)));
  }
  dispose(): void { this.world.free(); }
}

export async function loadCityRuntime(width: number, seed: number): Promise<CityRuntime> {
  const url = new URL(`${import.meta.env.BASE_URL}game-wasm/poop_bird_wasm.js?v=${__APP_COMMIT__}`, location.href).href;
  const module: typeof import("../../public/game-wasm/poop_bird_wasm") = await import(/* @vite-ignore */ url);
  await module.default();
  return new CityRuntime(new module.CityWorld(width, seed));
}
