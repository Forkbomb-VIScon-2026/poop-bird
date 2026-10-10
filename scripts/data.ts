// Local copy of the face dataset, from the collector on the team VM.
//
//   npm run data:pull    download new sessions into data/sessions/ and delete
//                        local ones that were deleted on the server
//   npm run data:purge   delete data/ entirely (everyone runs this when the VM goes away)
//
// The public site sits behind the ETH login, so pulling goes over SSH: it
// reads the dev token from the VM and tunnels to the VM's port 8080 (Caddy,
// in front of the login). It needs your SSH key on the VM (ssh-copy-id).
// POOPBIRD_VM overrides the SSH target. For another collector (e.g. a local
// `npm run collector`), set COLLECTOR_URL and POOPBIRD_DEV_TOKEN instead.
//
// Plain Node (types stripped), so no imports from src/.

import { execFileSync, spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

const DATA = "data";
const SESSIONS = join(DATA, "sessions");
const VM = process.env.POOPBIRD_VM ?? "viscon@24-direct.viscon-hackathon.ch";

interface Row {
  participant: string;
  sessionId: string;
}

interface Connection {
  base: string;
  token: string;
  close(): void;
}

/** Thrown for problems the user can fix; printed without a stack trace. */
class Problem extends Error {}

function fail(message: string): never {
  throw new Problem(message);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** The dev token from ~/poopbird-collector.env on the VM. */
function tokenFromVm(): string {
  try {
    const out = execFileSync("ssh", ["-o", "BatchMode=yes", VM, "grep '^DEV_TOKEN=' poopbird-collector.env"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const token = out.toString().trim().split("=")[1];
    if (token) return token;
  } catch {
    // Reported below.
  }
  return fail(
    `Couldn't read the dev token from ${VM} over SSH. Check that \`ssh ${VM}\` works without a password ` +
      "(ssh-copy-id) and that the collector has been deployed.",
  );
}

async function connect(): Promise<Connection> {
  if (process.env.COLLECTOR_URL) {
    const token = process.env.POOPBIRD_DEV_TOKEN ?? fail("With COLLECTOR_URL, also set POOPBIRD_DEV_TOKEN.");
    return { base: process.env.COLLECTOR_URL.replace(/\/$/, ""), token, close: () => undefined };
  }
  const token = process.env.POOPBIRD_DEV_TOKEN ?? tokenFromVm();
  const port = await freePort();
  const tunnel = spawn("ssh", ["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-L", `${port}:localhost:8080`, VM], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let exited = false;
  let stderr = "";
  tunnel.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  tunnel.on("exit", () => (exited = true));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60 && !exited; i++) {
    try {
      // Any HTTP answer means the tunnel is up.
      await fetch(`${base}/api/health`);
      return { base, token, close: () => tunnel.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  tunnel.kill();
  return fail(`Couldn't open an SSH tunnel to ${VM}. ${stderr.trim()}`);
}

async function listLocal(): Promise<string[]> {
  const out: string[] = [];
  for (const p of await readdir(SESSIONS).catch(() => [])) {
    for (const f of await readdir(join(SESSIONS, p)).catch(() => [])) if (f.endsWith(".json.gz")) out.push(`${p}/${f}`);
  }
  return out;
}

async function pull(c: Connection): Promise<void> {
  const headers = { Authorization: `Bearer ${c.token}` };
  const res = await fetch(`${c.base}/api/recordings`, { headers });
  if (res.status === 404 || res.status === 502) fail(`No collector behind ${c.base} (${res.status}). Has it been deployed?`);
  if (!res.ok) fail(`The collector answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as Row[];

  await mkdir(SESSIONS, { recursive: true });
  await writeFile(join(DATA, "index.json"), JSON.stringify(rows, null, 2));
  const wanted = new Set(rows.map((r) => `${r.participant}/${r.sessionId}.json.gz`));
  const have = new Set(await listLocal());

  let added = 0;
  for (const r of rows) {
    const key = `${r.participant}/${r.sessionId}.json.gz`;
    if (have.has(key)) continue;
    const file = await fetch(`${c.base}/api/recordings/${r.participant}/${r.sessionId}`, { headers });
    if (!file.ok) fail(`Downloading ${key} failed: ${file.status}`);
    await mkdir(join(SESSIONS, r.participant), { recursive: true });
    const tmp = join(SESSIONS, `${key}.tmp`);
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    await rename(tmp, join(SESSIONS, key));
    added++;
  }
  let removed = 0;
  for (const key of have) {
    if (wanted.has(key)) continue;
    await rm(join(SESSIONS, key));
    removed++;
  }
  for (const p of await readdir(SESSIONS)) await rmdir(join(SESSIONS, p)).catch(() => undefined); // only empty ones
  console.log(`${rows.length} sessions on the server: ${added} downloaded, ${removed} deleted locally. Index in data/index.json.`);
}

async function purge(): Promise<void> {
  await rm(DATA, { recursive: true, force: true });
  console.log("Deleted data/.");
}

async function main(command: string | undefined): Promise<void> {
  if (command === "purge") return purge();
  if (command !== "pull") fail("Usage: node scripts/data.ts pull|purge");
  const c = await connect();
  try {
    await pull(c);
  } finally {
    c.close();
  }
}

try {
  await main(process.argv[2]);
} catch (err) {
  console.error(err instanceof Problem ? err.message : err);
  process.exitCode = 1;
}
