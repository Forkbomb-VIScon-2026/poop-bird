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

/** Inserts the entry and returns the new list. Drops snapshots if storage is full. */
export function addToHallOfFame(entry: HallOfFameEntry): HallOfFameEntry[] {
  const list = [...loadHallOfFame(), entry].sort((a, b) => b.score - a.score).slice(0, HALL_OF_FAME_SIZE);
  if (!storageSet(HOF_KEY, JSON.stringify(list))) {
    // Probably quota: retry without images.
    const slim = list.map(({ snapshot: _snapshot, ...rest }) => rest);
    storageSet(HOF_KEY, JSON.stringify(slim));
    return slim;
  }
  return list;
}

export function clearHallOfFame(): void {
  storageRemove(HOF_KEY);
}
