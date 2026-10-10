import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_SCHEMA, SegmentRecorder, calibrationScript, type Session } from "../src/session.ts";
import { createCollector } from "./server.ts";

const CODE = "collect-me";
const TOKEN = "dev-secret";

function makeSession(sessionId = "s-20261011-120000-abcdef", code = "pb-abc234"): Session {
  const rec = new SegmentRecorder("calibration", calibrationScript(1));
  rec.begin(0);
  for (let t = 0; t < rec.duration * 1000; t += 50) {
    rec.push({ time: t, features: { browDown: 0.2 }, blendshapes: { browDownLeft: 0.2 }, box: null, landmarks: null });
  }
  return {
    schema: SESSION_SCHEMA, sessionId, recordedAt: "2026-10-11T12:00:00.000Z", app: { commit: "test" },
    consent: { version: "test", text: "I agree.", agreedAt: "2026-10-11T11:59:00.000Z" },
    participant: { code, glasses: "glasses", facialHair: "none", lighting: "dim" },
    device: { userAgent: "test", platform: "Linux", mobile: false, camera: "cam", video: { width: 640, height: 480 }, delegate: "CPU" },
    check: { brightness: 100, faceSize: 0.4 }, config: {}, savedCalibrations: { strain: null, puff: null },
    segments: [JSON.parse(JSON.stringify(rec.toJSON()))],
  };
}

let dir: string;
let server: Server;
let base: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "collector-"));
  clock = Date.UTC(2026, 9, 11, 12);
  server = createCollector({
    dataDir: dir, collectionCode: CODE, devToken: TOKEN, uploadsPerHour: 3, maxUploadBytes: 2_000_000, now: () => clock,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const dev = { Authorization: `Bearer ${TOKEN}` };

function upload(body: unknown, code = CODE, ip = "10.0.0.1") {
  return fetch(`${base}/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/gzip", "X-Collection-Code": code, "X-Forwarded-For": ip },
    body: gzipSync(JSON.stringify(body)),
  });
}

describe("collector", () => {
  it("stores an upload and lists it in the index for the team", async () => {
    const res = await upload(makeSession());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ participant: "pb-abc234", sessionId: "s-20261011-120000-abcdef" });
    expect(body.deleteKey).toMatch(/^[0-9a-f]{32}$/);

    expect((await fetch(`${base}/recordings`)).status).toBe(401);
    const rows = await (await fetch(`${base}/recordings`, { headers: dev })).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      participant: "pb-abc234", profile: { glasses: "glasses", lighting: "dim" }, device: { delegate: "CPU" },
      uploadedAt: "2026-10-11T12:00:00.000Z", review: null,
    });
    expect(rows[0].quality.faceCoverage).toBe(1);
  });

  it("serves the session back unchanged", async () => {
    const s = makeSession();
    await upload(s);
    const res = await fetch(`${base}/recordings/pb-abc234/${s.sessionId}`, { headers: dev });
    expect(res.status).toBe(200);
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"))).toEqual(s);
  });

  it("rejects a wrong collection code, invalid sessions, duplicates and oversized uploads", async () => {
    expect((await upload(makeSession(), "nope")).status).toBe(401);
    expect((await upload({ ...makeSession(), consent: null })).status).toBe(400);
    const notGzip = await fetch(`${base}/recordings`, { method: "POST", headers: { "X-Collection-Code": CODE }, body: "{}" });
    expect(notGzip.status).toBe(400);
    expect((await upload(makeSession())).status).toBe(201);
    expect((await upload(makeSession())).status).toBe(409);
    const big = await fetch(`${base}/recordings`, {
      method: "POST", headers: { "X-Collection-Code": CODE }, body: new Uint8Array(3_000_000),
    });
    expect(big.status).toBe(413);
  });

  it("limits uploads per address per hour", async () => {
    for (let i = 0; i < 3; i++) expect((await upload(makeSession(`s-20261011-12000${i}-abcdef`))).status).toBe(201);
    expect((await upload(makeSession("s-20261011-120009-abcdef"))).status).toBe(429);
    expect((await upload(makeSession("s-20261011-120009-abcdef"), CODE, "10.0.0.2")).status).toBe(201);
    clock += 3601_000;
    expect((await upload(makeSession("s-20261011-120010-abcdef"))).status).toBe(201);
  });

  it("lets the participant delete their session with the delete key", async () => {
    const { deleteKey, sessionId } = await (await upload(makeSession())).json();
    const url = `${base}/recordings/pb-abc234/${sessionId}`;
    expect((await fetch(url, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(url, { method: "DELETE", headers: { "X-Delete-Key": "0".repeat(32) } })).status).toBe(401);
    expect((await fetch(url, { method: "DELETE", headers: { "X-Delete-Key": deleteKey } })).status).toBe(200);
    expect(await readdir(join(dir, "sessions", "pb-abc234"))).toEqual([]);
    expect((await fetch(url, { method: "DELETE", headers: dev })).status).toBe(404);
  });

  it("lets the team review sessions and delete a participant", async () => {
    await upload(makeSession("s-20261011-120001-abcdef"));
    await upload(makeSession("s-20261011-120002-abcdef"));
    await upload(makeSession("s-20261011-120003-abcdef", "pb-zzz999"));
    const review = await fetch(`${base}/recordings/pb-abc234/s-20261011-120001-abcdef`, {
      method: "PATCH", headers: dev, body: JSON.stringify({ review: "bad take" }),
    });
    expect((await review.json()).review).toBe("bad take");

    expect((await fetch(`${base}/recordings/pb-abc234`, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(`${base}/recordings/pb-abc234`, { method: "DELETE", headers: dev })).status).toBe(200);
    const rows = await (await fetch(`${base}/recordings`, { headers: dev })).json();
    expect(rows.map((r: { participant: string }) => r.participant)).toEqual(["pb-zzz999"]);
  });

  it("refuses paths that aren't participant or session ids", async () => {
    expect((await fetch(`${base}/recordings/..%2F..%2Fetc`, { headers: dev })).status).toBe(404);
    expect((await fetch(`${base}/recordings/pb-abc234/passwd`, { headers: dev })).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
