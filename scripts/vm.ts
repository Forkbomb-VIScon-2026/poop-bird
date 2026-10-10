// Reaching the collector on the team VM from a dev machine, for data.ts and
// leaderboard.ts. The public site sits behind the ETH login, so this goes over
// SSH: it reads the dev token from the VM and tunnels to the VM's port 8080
// (Caddy, in front of the login). It needs your SSH key on the VM
// (ssh-copy-id). POOPBIRD_VM overrides the SSH target. For another collector
// (e.g. a local `npm run collector`), set COLLECTOR_URL and POOPBIRD_DEV_TOKEN
// instead.
//
// Plain Node (types stripped), so no imports from src/.

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";

export const VM = process.env.POOPBIRD_VM ?? "viscon@24-direct.viscon-hackathon.ch";

export interface Connection {
  base: string;
  token: string;
  close(): void;
}

/** Thrown for problems the user can fix; printed without a stack trace. */
export class Problem extends Error {}

export function fail(message: string): never {
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

export async function connect(): Promise<Connection> {
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

/** Runs a script's main, printing a Problem without a stack trace. */
export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Problem ? err.message : err);
    process.exitCode = 1;
  }
}
