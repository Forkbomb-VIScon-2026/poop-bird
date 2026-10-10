import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOARD_KEEP, BOARD_LIST_MAX, type Boards, type Submission } from "../src/leaderboard.ts";
import { jpegSize } from "./leaderboard.ts";
import { createCollector } from "./server.ts";

const TOKEN = "dev-secret";
/** The smallest thing that passes for a JPEG: start and end markers, an APP0, a frame header (SOF0) declaring its size, then "image data". */
function jpeg(width = 200, height = 240): Buffer {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, ...sof, 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);
}
const JPEG = jpeg();

let dir: string;
let server: Server;
let base: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leaderboard-"));
  clock = Date.UTC(2026, 9, 11, 12);
  server = createCollector({
    dataDir: dir, collectionCode: "code", devToken: TOKEN, leaderboardSubmitsPerHour: 10_000, now: () => clock++,
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
    const files = await readdir(join(dir, "leaderboard"));
    expect(files).toHaveLength(BOARD_KEEP + 1 + 1); // runs + the face run's .jpg
    const scores = await Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) =>
      (JSON.parse(await readFile(join(dir, "leaderboard", f), "utf8")) as { entry: { score: number; face: string | null } }).entry));
    expect(Math.min(...scores.filter((e) => !e.face).map((e) => e.score))).toBe(1001);
    // Lists stop at BOARD_LIST_MAX, however many are kept.
    const top = await boards(`?limit=${BOARD_KEEP}`);
    expect(top.scores).toHaveLength(BOARD_LIST_MAX);
    expect(top.scores[0].score).toBe(5000);
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

  it("drops keyboard runs stored before they stopped counting", async () => {
    const { id: face } = await (await submit(withFace(42, 0.6))).json();
    const old = (id: string, score: number) => ({
      entry: { id, name: "Kb", score, mode: "keyboard", stats: { targets: 0, distance: 1, bestCombo: 0 }, strain: null, face: null, submittedAt: "2026-10-10T20:40:00.000Z" },
      debug: false,
      deleteKeyHash: "0".repeat(64),
    });
    await writeFile(join(dir, "leaderboard", "00000000000000aa.json"), JSON.stringify(old("00000000000000aa", 9000)));
    await new Promise((r) => server.close(r));
    server = createCollector({ dataDir: dir, collectionCode: "code", devToken: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leaderboard`;
    expect((await boards()).scores.map((e) => e.id)).toEqual([face]);
    expect(await readdir(join(dir, "leaderboard"))).toEqual([`${face}.jpg`, `${face}.json`]);
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

  it("only takes JSON, so other sites can't submit through a visitor's browser", async () => {
    const res = await fetch(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(run(10)) });
    expect(res.status).toBe(415);
    expect(await boards()).toEqual({ scores: [], faces: [] });
  });

  it("serves faces so they can't run anything, even opened directly", async () => {
    const { id } = await (await submit(withFace(10, 0.5))).json();
    const img = await fetch(`${base}/${id}.jpg`);
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("turns away faces that claim a huge size, or have no frame header", async () => {
    expect(jpegSize(jpeg(200, 240))).toEqual({ width: 200, height: 240 });
    const face = (b: Buffer) => run(10, { face: { jpeg: b.toString("base64"), strain: 0.5 } });
    expect((await submit(face(jpeg(30_000, 30_000)))).status).toBe(400);
    expect((await submit(face(jpeg(401, 200)))).status).toBe(400);
    expect((await submit(face(jpeg(0, 200)))).status).toBe(400);
    expect((await submit(face(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])))).status).toBe(400);
    expect((await submit(face(jpeg(400, 800)))).status).toBe(201);
  });

  it("tames names: no bidi tricks, no towers of combining marks", async () => {
    await submit(run(10, { name: "Z\u0301\u0302\u0303\u0304\u0305\u0306al\u202Egog" }));
    expect((await boards()).scores[0].name).toBe("\u0179\u0302\u0303algog");
  });

  it("lists every stored run, both pools, for the team only", async () => {
    await submit(run(10, { name: "Pub" }));
    await submit(run(20, { name: "Dbg", debug: true }));
    expect((await fetch(`${base}/runs`)).status).toBe(401);
    expect((await fetch(`${base}/runs`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    const all = await (await fetch(`${base}/runs`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    expect(all.map((r: { name: string; debug: boolean }) => [r.name, r.debug])).toEqual([["Dbg", true], ["Pub", false]]);
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
    const notJson = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect(notJson.status).toBe(400);
    expect((await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(300_000) })).status).toBe(413);
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
