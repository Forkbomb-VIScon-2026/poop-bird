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
export const TUTORIALS = ["perch", "ocean"] as const;
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

// --- Best score & Hall of Fame ----------------------------------------------

const BEST_KEY = "poopbird.best.v1";
const HOF_KEY = "poopbird.halloffame.v1";
export const HALL_OF_FAME_SIZE = 5;

export interface HallOfFameEntry {
  name: string;
  score: number;
  date: string; // ISO
  targets: number;
  snapshot?: string; // JPEG data URL, never leaves the device
}

export function loadBest(): number {
  const v = Number(storageGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function saveBest(score: number): void {
  storageSet(BEST_KEY, String(Math.floor(score)));
}

export function loadHallOfFame(): HallOfFameEntry[] {
  const raw = storageGet(HOF_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is HallOfFameEntry =>
          typeof e === "object" && e !== null && typeof e.score === "number" && typeof e.name === "string",
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, HALL_OF_FAME_SIZE);
  } catch {
    return [];
  }
}

export function qualifiesForHallOfFame(score: number, list = loadHallOfFame()): boolean {
  if (score <= 0) return false;
  return list.length < HALL_OF_FAME_SIZE || score > list[list.length - 1].score;
}

/**
 * Inserts the entry and returns the new list. If storage is full it retries
 * without snapshots; `saved` is false if nothing could be persisted.
 */
export function addToHallOfFame(entry: HallOfFameEntry): { list: HallOfFameEntry[]; saved: boolean } {
  const list = [...loadHallOfFame(), entry].sort((a, b) => b.score - a.score).slice(0, HALL_OF_FAME_SIZE);
  if (storageSet(HOF_KEY, JSON.stringify(list))) return { list, saved: true };
  // Probably quota: retry without images.
  const slim = list.map(({ snapshot: _snapshot, ...rest }) => rest);
  if (storageSet(HOF_KEY, JSON.stringify(slim))) return { list: slim, saved: true };
  return { list, saved: false };
}

export function clearHallOfFame(): void {
  storageRemove(HOF_KEY);
}
