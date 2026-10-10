// The online leaderboard's format, shared by the game (leaderboard-view.ts)
// and the collector (collector/leaderboard.ts). Two boards rank the runs
// players chose to submit: by score, and (runs that shared their face) by how
// strained the finest-strain face is (strain.ts `strainedness`). Only runs
// played with the face count: keyboard and touch runs can't be submitted.
//
// The collector runs this in plain Node with types stripped, so like
// session.ts it has no runtime imports and only erasable TypeScript.

export const NAME_MAX_LENGTH = 16;
/**
 * Each board keeps this many runs (per pool, see `debug`); a run on neither
 * board isn't stored. Far more than anyone sees, so a flood of fake runs
 * can't push the real ones out for good: removing the fakes
 * (`npm run leaderboard`) brings them back.
 */
export const BOARD_KEEP = 500;
/** How many runs a board shows by default, and at most. */
export const BOARD_SHOW = 10;
export const BOARD_LIST_MAX = 100;
/** The face is a ~200 px wide JPEG (snapshot.ts), usually 10–25 kB. */
export const MAX_FACE_BYTES = 120_000;
/** Pixel size limits for a face, so a tiny file can't claim a huge image (and stall every viewer's browser). */
export const MAX_FACE_WIDTH = 400;
export const MAX_FACE_HEIGHT = 800;
/** Where the collector serves a run's face; the page shows nothing else as one. */
export const FACE_URL_RE = /^\/api\/leaderboard\/[0-9a-f]{16}\.jpg$/;
export const MAX_SCORE = 10_000_000;

export interface RunStats {
  targets: number;
  /** Meters, as on the game-over screen. */
  distance: number;
  bestCombo: number;
}

/** POST /api/leaderboard body. */
export interface Submission {
  name: string;
  score: number;
  /** Only face-mode runs count; the collector turns away anything else. */
  mode: "face";
  stats: RunStats;
  /** Opt-in: the run's finest-strain face. */
  face?: {
    /** Base64 JPEG, without the data: URL prefix. */
    jpeg: string;
    /** `strainedness` of the face, 0..1. */
    strain: number;
  };
  /** Sent by debug builds: their runs stay off the public boards (GET ?debug=1 shows them). */
  debug?: boolean;
}

/** A run as the boards list it. */
export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  stats: RunStats;
  /** `strainedness` of the shared face, 0..1; null without one. */
  strain: number | null;
  /** URL of the shared face JPEG; null without one. */
  face: string | null;
  submittedAt: string;
}

export interface Boards {
  scores: LeaderboardEntry[];
  faces: LeaderboardEntry[];
}

export interface SubmitResult {
  /** null if the run made neither board (then it wasn't stored). */
  id: string | null;
  /** Lets the submitter delete the run (DELETE with X-Delete-Key). */
  deleteKey: string | null;
  /** 1-based places on each board, or null if not on it. */
  rank: { score: number | null; face: number | null };
}

/**
 * Trims, collapses whitespace, drops control and format characters (bidi
 * overrides, zero-width) and stacks of combining marks ("Zalgo" text that
 * spills over the rows around it). null if nothing is left or it's too long.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return name.length > 0 && [...name].length <= NAME_MAX_LENGTH ? name : null;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** An error message, or null if `x` is a valid Submission. The collector also checks the JPEG's bytes. */
export function validateSubmission(x: unknown): string | null {
  if (typeof x !== "object" || x === null) return "not an object";
  const s = x as Record<string, unknown>;
  if (cleanName(s.name) === null) return `name must be 1–${NAME_MAX_LENGTH} characters`;
  if (!isCount(s.score, MAX_SCORE)) return "score must be a whole number ≥ 0";
  if (s.mode !== "face") return "only runs played with the face count";
  const stats = s.stats as Record<string, unknown> | null;
  if (typeof stats !== "object" || stats === null) return "stats missing";
  for (const k of ["targets", "distance", "bestCombo"] as const) {
    if (!isCount(stats[k], MAX_SCORE)) return `stats.${k} must be a whole number ≥ 0`;
  }
  if (s.face !== undefined) {
    const face = s.face as Record<string, unknown> | null;
    if (typeof face !== "object" || face === null) return "face must be an object";
    if (typeof face.strain !== "number" || !(face.strain >= 0 && face.strain <= 1)) return "face.strain must be 0..1";
    if (typeof face.jpeg !== "string" || !BASE64_RE.test(face.jpeg)) return "face.jpeg must be base64";
    if (face.jpeg.length > Math.ceil(MAX_FACE_BYTES / 3) * 4) return "face.jpeg is too large";
  }
  if (s.debug !== undefined && typeof s.debug !== "boolean") return "debug must be a boolean";
  return null;
}

function isCount(v: unknown, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
}

type Rankable = Pick<LeaderboardEntry, "score" | "strain" | "submittedAt">;

/** Higher score first; on a tie, whoever got there first. */
export function byScore(a: Rankable, b: Rankable): number {
  return b.score - a.score || a.submittedAt.localeCompare(b.submittedAt);
}

/** More strained first; on a tie, whoever got there first. */
export function byStrain(a: Rankable, b: Rankable): number {
  return (b.strain ?? 0) - (a.strain ?? 0) || a.submittedAt.localeCompare(b.submittedAt);
}

/** Both boards, `limit` runs each. Only runs with a face are on the faces board. */
export function rankBoards<T extends Rankable & { face: unknown }>(entries: readonly T[], limit = BOARD_KEEP): { scores: T[]; faces: T[] } {
  return {
    scores: entries.filter((e) => e.score > 0).sort(byScore).slice(0, limit),
    faces: entries.filter((e) => e.face !== null && e.strain !== null).sort(byStrain).slice(0, limit),
  };
}

/** Strainedness as players see it: 0–100. */
export function strainPercent(strain: number): number {
  return Math.round(strain * 100);
}
