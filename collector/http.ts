// Helpers shared by the collector's routes (server.ts, leaderboard.ts).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, readdir, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > limit) {
      reject(new HttpError(413, "The upload is too large."));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "The upload is too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The client's address (Caddy sets X-Forwarded-For). */
export function clientIp(req: IncomingMessage): string {
  return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
}

/**
 * At most `perHour` events per key in any hour. Behind the hackathon proxy
 * and Caddy, everyone may share one address, so per address is close to a
 * total limit.
 */
export function rateLimiter(perHour: number, now: () => number): (key: string) => boolean {
  const events = new Map<string, number[]>();
  return (key) => {
    const recent = (events.get(key) ?? []).filter((t) => now() - t < 3600_000);
    if (recent.length >= perHour) {
      events.set(key, recent);
      return false;
    }
    recent.push(now());
    events.set(key, recent);
    return true;
  };
}

/** Write to a temp file, then rename, so a crash never leaves half a file. */
export async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y) && a.length > 0;
}
