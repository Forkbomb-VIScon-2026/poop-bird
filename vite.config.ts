import { execSync } from "node:child_process";
import { defineConfig } from "vitest/config";

/** The game's commit, stored with every face dataset session. */
function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => ({
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
    // The recorder is only built in debug mode for now; the production build
    // ships just the game.
    rolldownOptions: mode === "debug" ? { input: { main: "index.html", collect: "collect.html" } } : {},
  },
  test: { include: ["src/**/*.test.ts", "collector/**/*.test.ts"] },
}));
