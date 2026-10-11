// Safe localStorage wrappers. Storage can be missing or throw (private mode,
// blocked site data, quota), so every access is guarded and the game keeps
// working without it.

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

// --- Calibrations (written by main.ts, also read by the collect page) --------

export const CALIBRATION_KEY = "poopbird.calibration.v1";
// v2: puff features changed (eyeMouth replaced cheekBulge; robust puff stats).
// v3: interactive calibration (puff/relax cycles; "relaxed" includes the face right after a puff).
export const PUFF_CALIBRATION_KEY = "poopbird.puffCalibration.v3";

// --- Tutorials (new-player tips) -----------------------------------------------

const TUTORIALS_KEY = "poopbird.tutorialsSeen.v1";
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

const BEST_KEY = "poopbird.best.v1";

export function loadBest(): number {
  const v = Number(storageGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function saveBest(score: number): void {
  storageSet(BEST_KEY, String(Math.floor(score)));
}

// The old Hall of Fame (top 5 on this device, with face snapshots) gave way to
// the online leaderboard. Its faces shouldn't linger unseen in storage.
storageRemove("poopbird.halloffame.v1");

// --- Leaderboard: runs this browser submitted ------------------------------------

const LEADERBOARD_RUNS_KEY = "poopbird.leaderboardRuns.v1";

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

