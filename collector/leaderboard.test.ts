import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOARD_KEEP, type Boards, type Submission } from "../src/leaderboard.ts";
import { createCollector } from "./server.ts";

const TOKEN = "dev-secret";
/** The smallest thing that passes for a JPEG: start and end markers. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

let dir: string;
let server: Server;
let base: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leaderboard-"));
  clock = Date.UTC(2026, 9, 11, 12);
  server = createCollector({
    dataDir: dir, collectionCode: "code", devToken: TOKEN, leaderboardSubmitsPerHour: 500, now: () => clock++,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leaderboard`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

function run(score: number, extra: Partial<Submission> = {}): Submission {
  return { name: "Ada", score, mode: "face", stats: { targets: 3, distance: 120, bestCombo: 2 }, ...extra };
}

function withFace(score: number, strain: number, extra: Partial<Submission> = {}): Submission {
  return run(score, { face: { jpeg: JPEG.toString("base64"), strain }, ...extra });
}

function submit(body: unknown, ip = "10.0.0.1") {
  return fetch(base, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body),
  });
}

async function boards(query = ""): Promise<Boards> {
  return (await fetch(`${base}${query}`)).json() as Promise<Boards>;
}

describe("leaderboard", () => {
  it("ranks runs by score, and runs that shared a face by strain", async () => {
    await submit(run(500, { name: "  Bea   Bop " }));
    await submit(withFace(300, 0.7, { name: "Cy" }));
    await submit(withFace(900, 0.4, { name: "Di" }));
    const b = await boards();
    expect(b.scores.map((e) => [e.name, e.score])).toEqual([["Di", 900], ["Bea Bop", 500], ["Cy", 300]]);
    expect(b.faces.map((e) => [e.name, e.strain])).toEqual([["Cy", 0.7], ["Di", 0.4]]);
    expect(b.scores[1]).toMatchObject({ face: null, strain: null, stats: { targets: 3, distance: 120, bestCombo: 2 } });

    const img = await fetch(new URL(b.faces[0].face!, base));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await img.arrayBuffer())).toEqual(JPEG);
  });

  it("tells the submitter their places, and limits what it lists", async () => {
    for (let i = 1; i <= 12; i++) await submit(run(i * 10));
    const res = await submit(withFace(55, 0.5));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ rank: { score: 8, face: 1 } });
    expect(body.id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.deleteKey).toMatch(/^[0-9a-f]{32}$/);
    expect((await boards()).scores).toHaveLength(10);
    expect((await boards("?limit=3")).scores.map((e) => e.score)).toEqual([120, 110, 100]);
  });

  it("keeps only runs on a board, and doesn't store one that makes neither", async () => {
    for (let i = 0; i < BOARD_KEEP; i++) await submit(run(1000 + i));
    const low = await submit(run(5));
    expect(low.status).toBe(200);
    expect(await low.json()).toEqual({ id: null, deleteKey: null, rank: { score: null, face: null } });
    // A low score still makes the faces board with a face.
    expect((await (await submit(withFace(5, 0.3))).json()).rank).toEqual({ score: null, face: 1 });
    // A better score pushes the lowest face-less run out, files and all.
    await submit(run(5000));
    const top = await boards(`?limit=${BOARD_KEEP}`);
    expect(top.scores).toHaveLength(BOARD_KEEP);
    expect(top.scores.at(-1)!.score).toBe(1001);
    expect(await readdir(join(dir, "leaderboard"))).toHaveLength(BOARD_KEEP + 1 + 1); // runs + the face run's .jpg
  });

  it("survives a restart", async () => {
    await submit(withFace(42, 0.6));
    await new Promise((r) => server.close(r));
    server = createCollector({ dataDir: dir, collectionCode: "code", devToken: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leaderboard`;
    const b = await boards();
    expect(b.scores.map((e) => e.score)).toEqual([42]);
    expect((await fetch(new URL(b.faces[0].face!, base))).status).toBe(200);
  });

  it("keeps runs from debug builds off the public boards", async () => {
    await submit(run(100));
    await submit(run(999, { debug: true }));
    expect((await boards()).scores.map((e) => e.score)).toEqual([100]);
    expect((await boards("?debug=1")).scores.map((e) => e.score)).toEqual([999]);
  });

  it("lets the submitter (or the team) delete a run", async () => {
    const { id, deleteKey } = await (await submit(withFace(10, 0.5))).json();
    const { id: other } = await (await submit(run(20))).json();
    expect((await fetch(`${base}/${id}`, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(`${base}/${id}`, { method: "DELETE", headers: { "X-Delete-Key": "0".repeat(32) } })).status).toBe(401);
    expect((await fetch(`${base}/${id}`, { method: "DELETE", headers: { "X-Delete-Key": deleteKey } })).status).toBe(200);
    expect((await fetch(`${base}/${id}.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/${other}`, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect(await boards()).toEqual({ scores: [], faces: [] });
    expect(await readdir(join(dir, "leaderboard"))).toEqual([]);
  });

  it("turns away keyboard runs", async () => {
    const res = await submit({ ...run(5000), mode: "keyboard" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/face/);
    expect(await boards()).toEqual({ scores: [], faces: [] });
  });

  it("rejects invalid runs", async () => {
    const bad = [
      run(10, { name: "   " }),
      run(10, { name: "x".repeat(17) }),
      run(-1),
      run(1.5),
      { ...run(10), mode: "cheat" },
      { ...run(10), mode: undefined },
      { ...run(10), stats: null },
      withFace(10, 1.2),
      run(10, { face: { jpeg: Buffer.from("<svg/>").toString("base64"), strain: 0.5 } }),
      run(10, { face: { jpeg: "not base64!", strain: 0.5 } }),
    ];
    for (const body of bad) expect((await submit(body)).status, JSON.stringify(body)).toBe(400);
    const notJson = await fetch(base, { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    expect((await fetch(base, { method: "POST", body: "x".repeat(300_000) })).status).toBe(413);
    expect((await fetch(`${base}/../recordings`)).status).not.toBe(200);
    expect((await fetch(`${base}/abc.jpg`)).status).toBe(404);
    expect(await boards()).toEqual({ scores: [], faces: [] });
  });

  it("limits submissions per address per hour", async () => {
    await new Promise((r) => server.close(r));
    server = createCollector({ dataDir: dir, collectionCode: "code", devToken: TOKEN, leaderboardSubmitsPerHour: 2, now: () => clock });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leaderboard`;
    expect((await submit(run(1))).status).toBe(201);
    expect((await submit(run(2))).status).toBe(201);
    expect((await submit(run(3))).status).toBe(429);
    expect((await submit(run(3), "10.0.0.2")).status).toBe(201);
    clock += 3601_000;
    expect((await submit(run(4))).status).toBe(201);
  });
});
