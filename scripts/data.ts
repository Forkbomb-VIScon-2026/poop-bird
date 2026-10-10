// Local copy of the face dataset, from the collector on the team VM.
//
//   npm run data:pull    download new sessions into data/sessions/ and delete
//                        local ones that were deleted on the server
//   npm run data:purge   delete data/ entirely (everyone runs this when the VM goes away)
//
// The public site sits behind the ETH login, so pulling goes over SSH (see
// vm.ts: your SSH key on the VM, or COLLECTOR_URL + POOPBIRD_DEV_TOKEN).
//
// Plain Node (types stripped), so no imports from src/.

import { mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect, fail, runMain, type Connection } from "./vm.ts";

const DATA = "data";
const SESSIONS = join(DATA, "sessions");

interface Row {
  participant: string;
  sessionId: string;
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

await runMain(() => main(process.argv[2]));
