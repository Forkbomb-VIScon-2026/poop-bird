// Downloads the MediaPipe Face Landmarker model once into
// public/mediapipe/face_landmarker.task. Run with `npm run fetch-model`.
// Pass --force to re-download.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "mediapipe", "face_landmarker.task");
const force = process.argv.includes("--force");

if (existsSync(dest) && statSync(dest).size > 0 && !force) {
  console.log(`[fetch-model] ${dest} already exists (use --force to re-download)`);
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
console.log(`[fetch-model] downloading ${MODEL_URL}`);
const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`[fetch-model] failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(dest, buf);
console.log(`[fetch-model] saved ${(buf.length / 1e6).toFixed(1)} MB to ${dest}`);
