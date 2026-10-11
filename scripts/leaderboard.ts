// Leaderboard moderation for the team: list runs and remove bad ones. Uses the
// dev token, over SSH to the VM (vm.ts), so only people with their SSH key on
// the VM can do it; the game has no way to remove anyone else's run.
//
//   npm run leaderboard                              what the boards show (top 20 each) and the 20 newest runs
//   npm run leaderboard -- list --all [--debug]      every stored run (with --debug: debug-build runs too)
//   npm run leaderboard -- remove <id> [<id>…]       delete runs, faces included
//   npm run leaderboard -- remove-name <name> [--yes]    every run under that name (case-insensitive)
//   npm run leaderboard -- remove-since <time> [--yes]   every run submitted since then, e.g. "2026-10-11 14:30" (local time)
//
// The bulk removals only list what they'd delete until you add --yes.
//
// Plain Node (types stripped), so no imports from src/.

import { connect, fail, runMain, type Connection } from "./vm.ts";

interface Run {
  id: string;
  name: string;
  score: number;
  strain: number | null;
  face: string | null;
  submittedAt: string;
  debug: boolean;
}

const SHOW = 20;

async function api(c: Connection, path: string, method = "GET"): Promise<unknown> {
  const res = await fetch(`${c.base}/api/leaderboard${path}`, { method, headers: { Authorization: `Bearer ${c.token}` } });
  if (res.status === 404 && path === "/runs") fail(`The collector behind ${c.base} has no moderation endpoint yet. Has this been deployed?`);
  if (!res.ok) fail(`${method} /api/leaderboard${path}: the collector answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function allRuns(c: Connection): Promise<Run[]> {
  return api(c, "/runs") as Promise<Run[]>;
}

function table(title: string, runs: Run[]): void {
  console.log(`\n${title}`);
  if (runs.length === 0) return console.log("  (none)");
  const rows = runs.map((r, i) => [
    String(i + 1),
    r.id,
    r.name,
    String(r.score),
    r.strain === null ? "" : String(Math.round(r.strain * 100)),
    r.face ? "face" : "",
    r.debug ? "debug" : "",
    new Date(r.submittedAt).toLocaleString("sv-SE").slice(0, 16),
  ]);
  const head = ["#", "id", "name", "score", "strain", "", "", "submitted"];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  for (const r of [head, ...rows]) console.log(`  ${r.map((cell, i) => cell.padEnd(width[i])).join("  ").trimEnd()}`);
}

async function list(c: Connection, flags: Set<string>): Promise<void> {
  const runs = (await allRuns(c)).filter((r) => flags.has("--debug") || !r.debug);
  const byScore = runs.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.submittedAt.localeCompare(b.submittedAt));
  const byStrain = runs.filter((r) => r.face && r.strain !== null).sort((a, b) => b.strain! - a.strain! || a.submittedAt.localeCompare(b.submittedAt));
  if (flags.has("--all")) {
    table(`All ${runs.length} runs, by score`, byScore);
    table("Runs with a face, by strainedness", byStrain);
    return;
  }
  table(`Top scores (of ${byScore.length})`, byScore.slice(0, SHOW));
  table(`Most strained faces (of ${byStrain.length})`, byStrain.slice(0, SHOW));
  table("Newest", runs.slice(0, SHOW));
  console.log("\nFaces: open https://24.hackathon.ethz.ch/api/leaderboard/<id>.jpg. Remove with: npm run leaderboard -- remove <id>");
}

async function remove(c: Connection, ids: string[]): Promise<void> {
  if (ids.length === 0) fail("Which runs? npm run leaderboard -- remove <id> [<id>…]");
  for (const id of ids) {
    if (!/^[0-9a-f]{16}$/.test(id)) fail(`"${id}" isn't a run id (16 hex digits; see npm run leaderboard).`);
    await api(c, `/${id}`, "DELETE");
    console.log(`Removed ${id}.`);
  }
}

async function removeMatching(c: Connection, what: string, match: (r: Run) => boolean, confirmed: boolean): Promise<void> {
  const hits = (await allRuns(c)).filter(match);
  table(`${hits.length} runs ${what}`, hits);
  if (hits.length === 0) return;
  if (!confirmed) return console.log("\nNothing removed yet. Run it again with --yes to remove these.");
  await remove(c, hits.map((r) => r.id));
}

async function main(): Promise<void> {
  const [command = "list", ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  const known = ["list", "remove", "remove-name", "remove-since"];
  if (!known.includes(command)) fail(`Usage: npm run leaderboard -- ${known.join("|")} (see scripts/leaderboard.ts)`);
  let since = 0;
  if (command === "remove-since") {
    since = new Date(args.join(" ")).getTime();
    if (!Number.isFinite(since)) fail('remove-since needs a time, e.g. "2026-10-11 14:30".');
  }
  if (command === "remove-name" && args.length === 0) fail("remove-name needs a name.");

  const c = await connect();
  try {
    if (command === "list") return await list(c, flags);
    if (command === "remove") return await remove(c, args);
    if (command === "remove-name") {
      const name = args.join(" ").toLowerCase();
      return await removeMatching(c, `named "${args.join(" ")}"`, (r) => r.name.toLowerCase() === name, flags.has("--yes"));
    }
    return await removeMatching(c, `since ${new Date(since).toLocaleString("sv-SE")}`, (r) => Date.parse(r.submittedAt) >= since, flags.has("--yes"));
  } finally {
    c.close();
  }
}

await runMain(main);
