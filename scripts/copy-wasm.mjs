// Copies the MediaPipe tasks-vision WASM runtime from node_modules into
// public/mediapipe/wasm so it is served locally (no CDN at runtime).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "mediapipe", "wasm");

if (!existsSync(src)) {
  console.warn(`[copy-wasm] ${src} not found, skipping (run npm install first)`);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-wasm] copied MediaPipe WASM to ${dest}`);
