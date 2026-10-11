// Face dataset collector: stores the sessions the collect page uploads and
// serves them to the team. No dependencies (node:http, types stripped by
// Node); the session format and its checks live in src/session.ts.
//
//   POST   /api/recordings                  upload (X-Collection-Code), gzipped session JSON
//   GET    /api/recordings                  index of all sessions (dev token)
//   GET    /api/recordings/<p>/<s>          one session, gzipped (dev token)
//   PATCH  /api/recordings/<p>/<s>          {"review": "ok" | "bad take" | note | null} (dev token)
//   DELETE /api/recordings/<p>/<s>          dev token, or the X-Delete-Key returned by the upload
//   DELETE /api/recordings/<p>              all sessions of a participant (dev token)
//   GET    /api/health
//   …      /api/leaderboard…                    the game's online leaderboard (leaderboard.ts)
//
// Data layout: <DATA_DIR>/sessions/<participant>/<session>.json.gz plus
// <session>.meta.json (index row and the delete key's hash), and
// <DATA_DIR>/leaderboard/ (leaderboard.ts).

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { PARTICIPANT_RE, SESSION_RE, indexRow, validateSession, type IndexRow, type Session } from "../src/session.ts";
import { HttpError, clientIp, exists, readBody, readdirSafe, safeEqual, send, sha256, writeAtomic } from "./http.ts";
import { createLeaderboard } from "./leaderboard.ts";

export interface CollectorOptions {
  dataDir: string;
  /** Shared with participants (in the collect link); allows uploads only. */
  collectionCode: string;
  /** For the team: list, download, review and delete. */
  devToken: string;
  maxUploadBytes?: number;
  uploadsPerHour?: number;
  leaderboardSubmitsPerHour?: number;
  now?: () => number;
}

interface Meta {
  row: IndexRow;
  deleteKeyHash: string;
}

export function createCollector(opts: CollectorOptions): Server {
  const maxUpload = opts.maxUploadBytes ?? 40 * 1024 * 1024;
  // Behind the hackathon proxy and Caddy, all participants may share one
  // address, so this is close to a total limit: high enough for a busy
  // collection table, low enough to bound the disk a leaked code can fill.
  const perHour = opts.uploadsPerHour ?? 200;
  const now = opts.now ?? Date.now;
  const sessionsDir = join(opts.dataDir, "sessions");
  const uploads = new Map<string, number[]>();

  const isDev = (req: IncomingMessage) => {
    const auth = req.headers.authorization ?? "";
    return auth.startsWith("Bearer ") && safeEqual(auth.slice(7), opts.devToken);
  };
  const requireDev = (req: IncomingMessage) => {
    if (!isDev(req)) throw new HttpError(401, "This needs the team's dev token.");
  };
  const paths = (p: string, s: string) => ({
    data: join(sessionsDir, p, `${s}.json.gz`),
    meta: join(sessionsDir, p, `${s}.meta.json`),
  });
  const leaderboard = createLeaderboard({
    dataDir: opts.dataDir, isDev, submitsPerHour: opts.leaderboardSubmitsPerHour, now,
  });

  async function upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!safeEqual(String(req.headers["x-collection-code"] ?? ""), opts.collectionCode)) {
      throw new HttpError(401, "Wrong collection code. Ask the team for the current one.");
    }
    const ip = clientIp(req);
    const recent = (uploads.get(ip) ?? []).filter((t) => now() - t < 3600_000);
    if (recent.length >= perHour) throw new HttpError(429, "Too many uploads from here. Try again in an hour.");

    const gz = await readBody(req, maxUpload);
    let session: unknown;
    try {
      session = JSON.parse(gunzipSync(gz, { maxOutputLength: 400 * 1024 * 1024 }).toString("utf8"));
    } catch {
      throw new HttpError(400, "The upload isn't gzipped JSON.");
    }
    const error = validateSession(session);
    if (error) throw new HttpError(400, `Not a valid session: ${error}.`);
    const s = session as Session;
    const p = paths(s.participant.code, s.sessionId);
    if (await exists(p.data)) throw new HttpError(409, "This session was already uploaded.");

    const deleteKey = randomBytes(16).toString("hex");
    const row = indexRow(s, { uploadedAt: new Date(now()).toISOString(), bytes: gz.length });
    await mkdir(join(sessionsDir, s.participant.code), { recursive: true });
    await writeAtomic(p.data, gz);
    await writeAtomic(p.meta, JSON.stringify({ row, deleteKeyHash: sha256(deleteKey) } satisfies Meta));
    recent.push(now());
    uploads.set(ip, recent);
    console.log(`[collector] stored ${s.participant.code}/${s.sessionId} (${gz.length} bytes)`);
    send(res, 201, { participant: s.participant.code, sessionId: s.sessionId, deleteKey, flags: row.quality.flags });
  }

  async function list(res: ServerResponse): Promise<void> {
    const rows: IndexRow[] = [];
    for (const participant of await readdirSafe(sessionsDir)) {
      for (const file of await readdirSafe(join(sessionsDir, participant))) {
        if (!file.endsWith(".meta.json")) continue;
        rows.push((JSON.parse(await readFile(join(sessionsDir, participant, file), "utf8")) as Meta).row);
      }
    }
    rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    send(res, 200, rows);
  }

  async function readMeta(p: string, s: string): Promise<Meta> {
    try {
      return JSON.parse(await readFile(paths(p, s).meta, "utf8")) as Meta;
    } catch {
      throw new HttpError(404, "No such session.");
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://collector");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") throw new HttpError(404, "Not found.");
    if (parts[1] === "health" && parts.length === 2 && req.method === "GET") return send(res, 200, { ok: true });
    if (parts[1] === "leaderboard") return leaderboard(req, res, parts);
    if (parts[1] !== "recordings" || parts.length > 4) throw new HttpError(404, "Not found.");
    const [p, s] = [parts[2], parts[3]];
    if (p !== undefined && !PARTICIPANT_RE.test(p)) throw new HttpError(404, "No such participant.");
    if (s !== undefined && !SESSION_RE.test(s)) throw new HttpError(404, "No such session.");

    if (p === undefined) {
      if (req.method === "POST") return upload(req, res);
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
      requireDev(req);
      return list(res);
    }
    if (s === undefined) {
      if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
      requireDev(req);
      await rm(join(sessionsDir, p), { recursive: true, force: true });
      console.log(`[collector] deleted participant ${p}`);
      return send(res, 200, { deleted: p });
    }
    const meta = await readMeta(p, s);
    switch (req.method) {
      case "GET": {
        requireDev(req);
        res.writeHead(200, { "Content-Type": "application/gzip", "Cache-Control": "no-store" });
        res.end(await readFile(paths(p, s).data));
        return;
      }
      case "PATCH": {
        requireDev(req);
        let review: unknown;
        try {
          review = (JSON.parse((await readBody(req, 10_000)).toString("utf8")) as { review?: unknown }).review;
        } catch {
          throw new HttpError(400, "Send JSON like {\"review\": \"ok\"}.");
        }
        if (review !== null && (typeof review !== "string" || review.length > 500)) {
          throw new HttpError(400, "review must be a short string or null.");
        }
        meta.row.review = review;
        await writeAtomic(paths(p, s).meta, JSON.stringify(meta));
        return send(res, 200, meta.row);
      }
      case "DELETE": {
        const key = String(req.headers["x-delete-key"] ?? "");
        if (!isDev(req) && !(key && safeEqual(sha256(key), meta.deleteKeyHash))) {
          throw new HttpError(401, "This needs the session's delete key or the team's dev token.");
        }
        await rm(paths(p, s).data, { force: true });
        await rm(paths(p, s).meta, { force: true });
        console.log(`[collector] deleted ${p}/${s}`);
        return send(res, 200, { deleted: `${p}/${s}` });
      }
      default:
        throw new HttpError(405, "Method not allowed.");
    }
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error("[collector]", err);
      send(res, 500, { error: "Something went wrong on the server." });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // HOST: all interfaces by default (needed inside the container); use 127.0.0.1 when running it locally.
  const { DATA_DIR = "/data", HOST = "0.0.0.0", PORT = "8787", COLLECTION_CODE, DEV_TOKEN } = process.env;
  if (!COLLECTION_CODE || !DEV_TOKEN) {
    console.error("[collector] Set COLLECTION_CODE and DEV_TOKEN.");
    process.exit(1);
  }
  createCollector({ dataDir: DATA_DIR, collectionCode: COLLECTION_CODE, devToken: DEV_TOKEN }).listen(Number(PORT), HOST, () =>
    console.log(`[collector] listening on ${HOST}:${PORT}, data in ${DATA_DIR}`),
  );
}
