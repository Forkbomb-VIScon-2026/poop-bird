// Safe localStorage wrappers. Storage can be missing or throw (private mode,
// blocked site data, quota), so every access is guarded and the game keeps
// working without it.

import { restoreCalibration, type Calibration, type FeatureName } from "./strain";

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false if the write failed (e.g. quota exceeded). */
export function storageSet(key: string, value: string): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // ignore
  }
}

// The game was renamed from Poop Bird to Poopy Bird. Carry the old keys
// ("poopbird.*", "poopBird.*") over once, so players keep their calibration,
// best score and settings.
function migrateRenamedKeys(): void {
  try {
    const s = store();
    if (!s) return;
    const old: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && /^poop(bird|Bird)\./.test(key)) old.push(key);
    }
    for (const key of old) {
      const renamed = key.replace(/^poop(b|B)ird\./, "poopy$1ird.");
      const value = s.getItem(key);
      if (value !== null && s.getItem(renamed) === null) s.setItem(renamed, value);
      s.removeItem(key);
    }
  } catch {
    // ignore
  }
}
migrateRenamedKeys();

// --- Known faces (sessionStorage only) ------------------------------------------
// Face descriptors are biometric data (known-faces.ts): they stay in this tab's
// sessionStorage, so they go when the tab closes, and never in localStorage.

const KNOWN_FACES_KEY = "poopybird.knownFaces.v1";

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The stored known faces as parsed JSON (known-faces.ts parseFaces checks it); null if none. */
export function loadKnownFacesJson(): unknown {
  try {
    const raw = sessionStore()?.getItem(KNOWN_FACES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Stores the known faces (serializeFaces), or deletes them for null. */
export function saveKnownFacesJson(json: string | null): void {
  try {
    if (json === null) sessionStore()?.removeItem(KNOWN_FACES_KEY);
    else sessionStore()?.setItem(KNOWN_FACES_KEY, json);
  } catch {
    // ignore: the faces are still known in memory for this page
  }
}

// --- Calibrations (written by main.ts, also read by the collect page) --------

export const CALIBRATION_KEY = "poopybird.calibration.v1";
// v2: puff features changed (eyeMouth replaced cheekBulge; robust puff stats).
// v3: interactive calibration (puff/relax cycles; "relaxed" includes the face right after a puff).
export const PUFF_CALIBRATION_KEY = "poopybird.puffCalibration.v3";

export function saveCalibration(key: string, cal: Calibration): void {
  storageSet(key, JSON.stringify(cal));
}

/** Calibrations saved before the puff features existed still load (see restoreCalibration). */
export function loadCalibration(key: string, required: readonly FeatureName[]): Calibration | null {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    return restoreCalibration(JSON.parse(raw), required);
  } catch {
    return null;
  }
}

// --- Tutorials (new-player tips) -----------------------------------------------

const TUTORIALS_KEY = "poopybird.tutorialsSeen.v1";
export const TUTORIALS = ["perch", "city", "ocean"] as const;
export type Tutorial = (typeof TUTORIALS)[number];

/** Tutorials this browser has already shown (and the player dismissed). */
export function loadSeenTutorials(): Set<Tutorial> {
  try {
    const parsed: unknown = JSON.parse(storageGet(TUTORIALS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(TUTORIALS.filter((t) => parsed.includes(t)));
  } catch {
    return new Set();
  }
}

export function saveSeenTutorials(seen: ReadonlySet<Tutorial>): void {
  if (seen.size === 0) storageRemove(TUTORIALS_KEY);
  else storageSet(TUTORIALS_KEY, JSON.stringify([...seen]));
}

// --- Best score ------------------------------------------------------------------

const BEST_KEY = "poopybird.best.v1";

const GRAPHICS_KEY = "poopyBird.graphics";

/** The chosen graphics style: "rtx" (real photos) or "classic" (the default). */
export function loadGraphics(): "classic" | "rtx" {
  return storageGet(GRAPHICS_KEY) === "rtx" ? "rtx" : "classic";
}

export function saveGraphics(mode: "classic" | "rtx"): void {
  storageSet(GRAPHICS_KEY, mode);
}

const MUTED_KEY = "poopybird.muted.v1";

export function loadMuted(): boolean {
  return storageGet(MUTED_KEY) === "1";
}

export function saveMuted(muted: boolean): void {
  storageSet(MUTED_KEY, muted ? "1" : "0");
}

export function loadBest(): number {
  const v = Number(storageGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function saveBest(score: number): void {
  storageSet(BEST_KEY, String(Math.floor(score)));
}

// The old Hall of Fame (top 5 on this device, with face snapshots) gave way to
// the online leaderboard. Its faces shouldn't linger unseen in storage.
storageRemove("poopybird.halloffame.v1");

// --- Leaderboard: runs this browser submitted ------------------------------------

const LEADERBOARD_RUNS_KEY = "poopybird.leaderboardRuns.v1";

/** Run id → its delete key, for the runs submitted from this browser (they get a remove button). */
export function loadLeaderboardKeys(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storageGet(LEADERBOARD_RUNS_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

export function saveLeaderboardKey(id: string, deleteKey: string): void {
  storageSet(LEADERBOARD_RUNS_KEY, JSON.stringify({ ...loadLeaderboardKeys(), [id]: deleteKey }));
}

export function forgetLeaderboardKey(id: string): void {
  const keys = loadLeaderboardKeys();
  delete keys[id];
  storageSet(LEADERBOARD_RUNS_KEY, JSON.stringify(keys));
}

