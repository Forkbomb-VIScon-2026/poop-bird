// Runs a TypeScript script with Vite's module runner, so it can import the
// game's modules (extensionless imports, import.meta.env) unchanged.
//   node scripts/run-ts.mjs scripts/eval/main.ts [args…]
import { resolve } from "node:path";
import { runnerImport } from "vite";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-ts.mjs <file.ts> [args…]");
  process.exit(1);
}
await runnerImport(resolve(file));
