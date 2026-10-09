// Every gameplay / detection tunable lives here.
//
// The debug panel (press D) builds a slider for each entry in CONFIG_SPEC and
// writes changes into the live `config` object, which every system reads each
// frame. Changes are persisted to localStorage; "Reset to defaults" clears them.
//
// Units: distances in logical pixels (the playfield is 600 px tall), times in
// seconds, speeds in px/s, accelerations in px/s².

import { storageGet, storageRemove, storageSet } from "./storage";

export interface TunableSpec {
  value: number;
  min: number;
  max: number;
  step: number;
  group: string;
  label: string;
  hint?: string;
}

export const CONFIG_SPEC = {
  // --- Physics -------------------------------------------------------------
  gravity: { value: 420, min: 200, max: 2500, step: 10, group: "Physics", label: "Gravity", hint: "px/s²" },
  maxFallSpeed: { value: 220, min: 100, max: 1200, step: 10, group: "Physics", label: "Max fall speed", hint: "px/s" },
  chargeGravityScale: {
    value: 0.5, min: 0, max: 1, step: 0.05, group: "Physics", label: "Gravity while charging",
    hint: "× gravity while straining (the bird tenses up and glides a bit)",
  },
  chargeMaxFallSpeed: {
    value: 100, min: 20, max: 1200, step: 10, group: "Physics", label: "Max fall while charging",
    hint: "px/s; lets you hold a long strain without hitting the ground",
  },
  pushMin: { value: 120, min: 0, max: 800, step: 10, group: "Physics", label: "Push: tiny pfft", hint: "upward px/s at ~0 charge" },
  pushMax: { value: 480, min: 100, max: 1500, step: 10, group: "Physics", label: "Push: full charge", hint: "upward px/s at full charge" },
  pushCurve: { value: 0.8, min: 0.3, max: 3, step: 0.05, group: "Physics", label: "Push curve", hint: "exponent on charge (<1 = small strains count more)" },
  startGrace: {
    value: 1.5, min: 0, max: 5, step: 0.1, group: "Physics", label: "Start grace",
    hint: "s after GO over which gravity ramps from 0 to full",
  },
  fallCancel: { value: 0.85, min: 0, max: 1, step: 0.05, group: "Physics", label: "Fall cancel on push", hint: "fraction of downward speed removed on push" },

  // --- Charge & overstrain -------------------------------------------------
  chargeTime: { value: 1.2, min: 0.2, max: 4, step: 0.05, group: "Charge", label: "Charge time", hint: "s to fill 0→1" },
  overstrainTime: { value: 1.0, min: 0.2, max: 4, step: 0.05, group: "Charge", label: "Overstrain time", hint: "s at full charge before an accident" },
  sweetSpotWindow: { value: 0.3, min: 0, max: 2, step: 0.05, group: "Charge", label: "Sweet-spot window", hint: "s right before the accident that pays a bonus" },
  sweetSpotMultiplier: { value: 1.35, min: 1, max: 3, step: 0.05, group: "Charge", label: "Sweet-spot bonus", hint: "× push" },
  stunTime: { value: 1.0, min: 0.2, max: 3, step: 0.05, group: "Charge", label: "Accident stun", hint: "s tumbling without push" },

  // --- Strain detection ----------------------------------------------------
  strainOn: { value: 0.45, min: 0.05, max: 0.95, step: 0.01, group: "Strain", label: "On threshold" },
  strainOff: { value: 0.3, min: 0.02, max: 0.9, step: 0.01, group: "Strain", label: "Off threshold" },
  emaAlpha: { value: 0.45, min: 0.05, max: 1, step: 0.01, group: "Strain", label: "EMA factor", hint: "per frame at 30 fps; 1 = no smoothing" },
  featureClampMax: { value: 1.3, min: 1, max: 3, step: 0.05, group: "Strain", label: "Feature clamp max", hint: "normalized features are clamped to 0..this" },
  minFeatureDelta: { value: 0.04, min: 0, max: 0.3, step: 0.01, group: "Strain", label: "Min feature change", hint: "calibration change below this gets zero weight" },
  minCalibrationChange: { value: 0.25, min: 0, max: 2, step: 0.01, group: "Strain", label: "Min total change", hint: "calibration quality: summed weights must exceed this" },
  calibrationSeconds: { value: 3, min: 1, max: 8, step: 0.5, group: "Strain", label: "Calibration phase", hint: "s per phase" },
  calibrationSettle: { value: 0.7, min: 0, max: 2, step: 0.1, group: "Strain", label: "Calibration settle", hint: "s ignored at the start of each phase" },

  // --- World ---------------------------------------------------------------
  scrollSpeed: { value: 170, min: 50, max: 600, step: 5, group: "World", label: "Scroll speed (start)", hint: "px/s" },
  scrollSpeedMax: { value: 260, min: 50, max: 800, step: 5, group: "World", label: "Scroll speed (max)", hint: "px/s" },
  obstacleGap: { value: 250, min: 100, max: 500, step: 5, group: "World", label: "Gap (start)", hint: "px" },
  obstacleGapMin: { value: 175, min: 80, max: 500, step: 5, group: "World", label: "Gap (hardest)", hint: "px" },
  obstacleSpacing: { value: 460, min: 150, max: 1200, step: 10, group: "World", label: "Spacing (start)", hint: "px between obstacles" },
  obstacleSpacingMin: { value: 320, min: 150, max: 1200, step: 10, group: "World", label: "Spacing (hardest)", hint: "px" },
  difficultyRamp: { value: 6000, min: 500, max: 30000, step: 100, group: "World", label: "Difficulty ramp", hint: "px of distance to reach max difficulty" },
  firstObstacleDelay: { value: 700, min: 0, max: 3000, step: 50, group: "World", label: "First obstacle after", hint: "px" },

  // --- Targets & score -----------------------------------------------------
  poopGravity: { value: 1000, min: 100, max: 3000, step: 50, group: "Targets", label: "Poop gravity", hint: "px/s² (separate from the bird so aiming stays the same)" },
  targetSpawnRate: { value: 0.55, min: 0, max: 3, step: 0.05, group: "Targets", label: "Spawn rate", hint: "targets per second" },
  targetPoints: { value: 50, min: 0, max: 500, step: 5, group: "Targets", label: "Points per hit", hint: "base; cars ×1, pedestrians ×1.5, statue ×2" },
  comboStep: { value: 0.5, min: 0, max: 2, step: 0.05, group: "Targets", label: "Combo step", hint: "multiplier added per consecutive hit" },
  comboMax: { value: 5, min: 1, max: 20, step: 0.5, group: "Targets", label: "Combo max", hint: "multiplier cap" },
  distancePerPoint: { value: 10, min: 1, max: 100, step: 1, group: "Targets", label: "Distance per point", hint: "px of travel per score point" },
} satisfies Record<string, TunableSpec>;

export type ConfigKey = keyof typeof CONFIG_SPEC;
export type Config = Record<ConfigKey, number>;

const STORAGE_KEY = "poopbird.config.v1";

export function defaultConfig(): Config {
  const out = {} as Config;
  for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) out[key] = CONFIG_SPEC[key].value;
  return out;
}

function loadConfig(): Config {
  const cfg = defaultConfig();
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return cfg;
  try {
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
      const v = saved[key];
      if (typeof v === "number" && Number.isFinite(v)) cfg[key] = v;
    }
  } catch {
    // Corrupt entry: ignore and use defaults.
  }
  return cfg;
}

/** The live config. Mutated in place by the debug panel. */
export const config: Config = loadConfig();

export function setConfigValue(key: ConfigKey, value: number): void {
  config[key] = value;
  saveConfig();
}

export function saveConfig(): void {
  // Only store values that differ from the defaults, so new defaults apply
  // to anything the player hasn't touched.
  const defaults = defaultConfig();
  const diff: Partial<Config> = {};
  for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
    if (config[key] !== defaults[key]) diff[key] = config[key];
  }
  if (Object.keys(diff).length === 0) storageRemove(STORAGE_KEY);
  else storageSet(STORAGE_KEY, JSON.stringify(diff));
}

export function resetConfig(): void {
  Object.assign(config, defaultConfig());
  storageRemove(STORAGE_KEY);
}

/** Linear interpolation from the "start" value to the "hardest" value. */
export function ramp(start: number, hardest: number, difficulty: number): number {
  return start + (hardest - start) * Math.min(1, Math.max(0, difficulty));
}
