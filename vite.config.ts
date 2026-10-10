import { execSync } from "node:child_process";
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

export default defineConfig({
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
  test: { include: ["src/**/*.test.ts", "collector/**/*.test.ts"] },
});
