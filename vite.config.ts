import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["src/**/*.test.ts"] },
});
