// The online leaderboard (format and ranking in src/leaderboard.ts). Players
// submit a run from the game-over screen, and choose whether their
// finest-strain face goes with it. Everyone who can open the game sees the
// boards.
//
//   GET    /api/leaderboard[?limit=n][&debug=1]   both boards (debug=1: runs from debug builds instead)
//   POST   /api/leaderboard                       a run (JSON Submission)
//   GET    /api/leaderboard/<id>.jpg              a run's shared face
//   DELETE /api/leaderboard/<id>                  X-Delete-Key returned by the submission, or the dev token
//
// Data layout: <DATA_DIR>/leaderboard/<id>.json (the run, its pool and the
// delete key's hash) plus <id>.jpg. Only runs on a board are kept: a run that
// makes neither board isn't stored, and one pushed off both is deleted.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  BOARD_KEEP, BOARD_SHOW, MAX_FACE_BYTES, cleanName, rankBoards, validateSubmission,
  type LeaderboardEntry, type Submission, type SubmitResult,
} from "../src/leaderboard.ts";
import { HttpError, clientIp, rateLimiter, readBody, readdirSafe, safeEqual, send, sha256, writeAtomic } from "./http.ts";

export interface LeaderboardOptions {
  dataDir: string;
  /** The request carries the team's dev token. */
  isDev: (req: IncomingMessage) => boolean;
  submitsPerHour?: number;
  now?: () => number;
}

interface Stored {
  entry: LeaderboardEntry;
  /** Submitted by a debug build: ranked separately and never on the public boards. */
  debug: boolean;
  deleteKeyHash: string;
}

const ID_RE = /^[0-9a-f]{16}$/;

/** Handles /api/leaderboard/… (`parts` = the path split on "/", starting with "api"). */
export function createLeaderboard(opts: LeaderboardOptions): (req: IncomingMessage, res: ServerResponse, parts: string[]) => Promise<void> {
  const dir = join(opts.dataDir, "leaderboard");
  const now = opts.now ?? Date.now;
  const allow = rateLimiter(opts.submitsPerHour ?? 300, now);
  const file = (id: string, ext: "json" | "jpg") => join(dir, `${id}.${ext}`);

  let loaded: Promise<Map<string, Stored>> | null = null;
  const runs = () => (loaded ??= loadAll());
  async function loadAll(): Promise<Map<string, Stored>> {
    const map = new Map<string, Stored>();
    for (const name of await readdirSafe(dir)) {
      const id = name.slice(0, -".json".length);
      if (!name.endsWith(".json") || !ID_RE.test(id)) continue;
      try {
        const run = JSON.parse(await readFile(file(id, "json"), "utf8")) as Stored;
        // Keyboard runs were accepted at first; only face-mode runs count now.
        if ((run.entry as { mode?: unknown }).mode === "keyboard") {
          await rm(file(id, "json"), { force: true });
          await rm(file(id, "jpg"), { force: true });
          console.log(`[leaderboard] dropped keyboard run ${id}`);
          continue;
        }
        map.set(id, run);
      } catch (err) {
        console.error(`[leaderboard] skipping ${name}:`, err);
      }
    }
    return map;
  }

  // Changes run one at a time, so two submissions can't both prune with a stale view.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }

  const pool = (all: Map<string, Stored>, debug: boolean) =>
    [...all.values()].filter((s) => s.debug === debug).map((s) => s.entry);

  async function remove(all: Map<string, Stored>, id: string): Promise<void> {
    all.delete(id);
    await rm(file(id, "json"), { force: true });
    await rm(file(id, "jpg"), { force: true });
  }

  async function boards(res: ServerResponse, url: URL): Promise<void> {
    const limit = Math.min(BOARD_KEEP, Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || BOARD_SHOW));
    send(res, 200, rankBoards(pool(await runs(), url.searchParams.get("debug") === "1"), limit));
  }

  async function submit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allow(clientIp(req))) throw new HttpError(429, "Too many submissions from here. Try again in an hour.");
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, 200_000)).toString("utf8"));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "Send the run as JSON.");
    }
    const error = validateSubmission(body);
    if (error) throw new HttpError(400, `Not a valid run: ${error}.`);
    const s = body as Submission;
    const jpeg = s.face ? Buffer.from(s.face.jpeg, "base64") : null;
    if (jpeg && !isJpeg(jpeg)) throw new HttpError(400, "The face isn't a JPEG.");

    const result = await serial(async (): Promise<SubmitResult> => {
      const all = await runs();
      const debug = s.debug === true;
      const id = randomBytes(8).toString("hex");
      const entry: LeaderboardEntry = {
        id,
        name: cleanName(s.name)!,
        score: s.score,
        stats: { targets: s.stats.targets, distance: s.stats.distance, bestCombo: s.stats.bestCombo },
        strain: s.face ? s.face.strain : null,
        face: s.face ? `/api/leaderboard/${id}.jpg` : null,
        submittedAt: new Date(now()).toISOString(),
      };
      const ranked = rankBoards([...pool(all, debug), entry]);
      const place = (board: LeaderboardEntry[]) => {
        const i = board.findIndex((e) => e.id === id);
        return i < 0 ? null : i + 1;
      };
      const rank = { score: place(ranked.scores), face: place(ranked.faces) };
      if (rank.score === null && rank.face === null) return { id: null, deleteKey: null, rank };

      const deleteKey = randomBytes(16).toString("hex");
      await mkdir(dir, { recursive: true });
      if (jpeg) await writeAtomic(file(id, "jpg"), jpeg);
      await writeAtomic(file(id, "json"), JSON.stringify({ entry, debug, deleteKeyHash: sha256(deleteKey) } satisfies Stored));
      all.set(id, { entry, debug, deleteKeyHash: sha256(deleteKey) });
      // Whoever this pushed off both boards goes.
      const kept = new Set([...ranked.scores, ...ranked.faces].map((e) => e.id));
      for (const e of pool(all, debug)) if (!kept.has(e.id)) await remove(all, e.id);
      console.log(`[leaderboard] ${debug ? "debug " : ""}run ${id}: score #${rank.score ?? "-"}, face #${rank.face ?? "-"}`);
      return { id, deleteKey, rank };
    });
    send(res, result.id ? 201 : 200, result);
  }

  async function face(res: ServerResponse, id: string): Promise<void> {
    if (!(await runs()).get(id)?.entry.face) throw new HttpError(404, "No such face.");
    const jpeg = await readFile(file(id, "jpg")).catch(() => null);
    if (!jpeg) throw new HttpError(404, "No such face.");
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(jpeg);
  }

  async function del(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    await serial(async () => {
      const all = await runs();
      const run = all.get(id);
      if (!run) throw new HttpError(404, "No such run.");
      const key = String(req.headers["x-delete-key"] ?? "");
      if (!opts.isDev(req) && !(key && safeEqual(sha256(key), run.deleteKeyHash))) {
        throw new HttpError(401, "This needs the run's delete key or the team's dev token.");
      }
      await remove(all, id);
      console.log(`[leaderboard] deleted run ${id}`);
    });
    send(res, 200, { deleted: id });
  }

  return async (req, res, parts) => {
    const url = new URL(req.url ?? "/", "http://collector");
    const target = parts[2];
    if (parts.length === 2) {
      if (req.method === "GET") return boards(res, url);
      if (req.method === "POST") return submit(req, res);
      throw new HttpError(405, "Method not allowed.");
    }
    if (parts.length !== 3) throw new HttpError(404, "Not found.");
    if (target.endsWith(".jpg") && ID_RE.test(target.slice(0, -4))) {
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
      return face(res, target.slice(0, -4));
    }
    if (!ID_RE.test(target)) throw new HttpError(404, "No such run.");
    if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
    return del(req, res, target);
  };
}

/** JPEG start and end markers, and no bigger than a face snapshot can be. */
function isJpeg(b: Buffer): boolean {
  return b.length >= 4 && b.length <= MAX_FACE_BYTES &&
    b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}
