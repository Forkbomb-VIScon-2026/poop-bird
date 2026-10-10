// Local copy of the face dataset, from the collector on the team VM.
//
//   npm run data:pull    download new sessions into data/sessions/ and delete
//                        local ones that were deleted on the server
//   npm run data:purge   delete data/ entirely (everyone runs this when the VM goes away)
//
// Pulling needs the team's dev token:
//   export POOPBIRD_DEV_TOKEN=$(ssh viscon@24-direct.viscon-hackathon.ch "grep DEV_TOKEN poopbird-collector.env | cut -d= -f2")
// COLLECTOR_URL overrides the server (default: the team VM).
//
// Plain Node (types stripped), so no imports from src/.

import { mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = "data";
const SESSIONS = join(DATA, "sessions");
const URL_BASE = (process.env.COLLECTOR_URL ?? "https://24.viscon-hackathon.ch").replace(/\/$/, "");

interface Row {
  participant: string;
  sessionId: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function listLocal(): Promise<string[]> {
  const out: string[] = [];
  for (const p of await readdir(SESSIONS).catch(() => [])) {
    for (const f of await readdir(join(SESSIONS, p)).catch(() => [])) if (f.endsWith(".json.gz")) out.push(`${p}/${f}`);
  }
  return out;
}

async function pull(): Promise<void> {
  const token = process.env.POOPBIRD_DEV_TOKEN;
  if (!token) fail("Set POOPBIRD_DEV_TOKEN first (see the top of scripts/data.ts).");
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${URL_BASE}/api/recordings`, { headers }).catch((err: unknown) =>
    fail(`Couldn't reach ${URL_BASE}: ${String(err)}`),
  );
  if (!res.ok) fail(`${URL_BASE} answered ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as Row[];

  await mkdir(SESSIONS, { recursive: true });
  await writeFile(join(DATA, "index.json"), JSON.stringify(rows, null, 2));
  const wanted = new Set(rows.map((r) => `${r.participant}/${r.sessionId}.json.gz`));
  const have = new Set(await listLocal());

  let added = 0;
  for (const r of rows) {
    const key = `${r.participant}/${r.sessionId}.json.gz`;
    if (have.has(key)) continue;
    const file = await fetch(`${URL_BASE}/api/recordings/${r.participant}/${r.sessionId}`, { headers });
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

const command = process.argv[2];
if (command === "pull") await pull();
else if (command === "purge") await purge();
else fail("Usage: node scripts/data.ts pull|purge");
