// Copies runtime files from node_modules into public/ so they are served
// locally (no CDN at runtime):
// - the MediaPipe tasks-vision WASM runtime → public/mediapipe/wasm
// - the face recognition weights the two-player mode uses to tell the players
//   apart (dlib's ResNet face model, public domain, shipped in
//   @vladmandic/face-api) → public/faceid
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
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

const faceIdSrc = join(root, "node_modules", "@vladmandic", "face-api", "model");
const faceIdDest = join(root, "public", "faceid");
const FACE_ID_FILES = ["face_recognition_model-weights_manifest.json", "face_recognition_model.bin"];
if (FACE_ID_FILES.every((f) => existsSync(join(faceIdSrc, f)))) {
  mkdirSync(faceIdDest, { recursive: true });
  for (const f of FACE_ID_FILES) copyFileSync(join(faceIdSrc, f), join(faceIdDest, f));
  console.log(`[copy-wasm] copied face recognition weights to ${faceIdDest}`);
} else {
  console.warn(`[copy-wasm] ${faceIdSrc} has no face recognition weights, skipping (two players fall back to appearance checks)`);
}
