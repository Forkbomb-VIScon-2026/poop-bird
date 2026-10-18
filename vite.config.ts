import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** The game's commit, stored with every face dataset session (APP_COMMIT in Docker builds, which have no .git). */
function commit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/**
 * Dev server only: the debug panel's "Save perf log" posts its CSV here, and it
 * lands in perf-logs/ of this checkout (so a phone on `adb reverse` saves to the laptop).
 */
function perfLog(): Plugin {
  return {
    name: "perf-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__perf-log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = basename(new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "");
        if (!/^poopybird-perf-[\w-]+\.csv$/.test(name)) {
          res.statusCode = 400;
          res.end("bad name");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const dir = join(server.config.root, "perf-logs");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), Buffer.concat(chunks));
          server.config.logger.info(`perf log saved: perf-logs/${name}`);
          res.end(`perf-logs/${name}`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [perfLog()],
  define: { __APP_COMMIT__: JSON.stringify(commit()) },
  server: {
    port: 5173,
    host: true,
    // The face dataset recorder (collect.html) uploads to /api. In dev that goes
    // to the collector on the team VM through `npm run tunnel` (the public site
    // is behind the ETH login), or to COLLECTOR_URL (e.g. a local collector).
    proxy: {
      "/api": { target: process.env.COLLECTOR_URL ?? "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    // Two pages: the game, and the face dataset recorder at /collect.html.
    rolldownOptions: { input: { main: "index.html", collect: "collect.html" } },
  },
  // The face worker (face-worker.ts) is a module worker: MediaPipe loads its WASM loader with import() there.
  worker: { format: "es" },
  test: { include: ["src/**/*.test.ts", "collector/**/*.test.ts"] },
});
