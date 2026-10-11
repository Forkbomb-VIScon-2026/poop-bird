// Build the game WASM (MediaPipe's separate WASM is copied by copy-wasm.mjs).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const version = "0.2.104"; // Must match crates/poop-bird-wasm/Cargo.toml.
function run(program, args) {
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.error) throw new Error(`${program} unavailable: ${result.error.message}. See docs/rust-build.md.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.env.GAME_WASM_PREBUILT === "1") {
  // Only Docker uses this: the Rust stage builds from the exact copied source.
  for (const name of ["poop_bird_wasm.js", "poop_bird_wasm.d.ts", "poop_bird_wasm_bg.wasm"]) {
    readFileSync(`public/game-wasm/${name}`);
  }
} else {
  const actual = spawnSync("wasm-bindgen", ["--version"], { encoding: "utf8" });
  if (actual.error || actual.status !== 0 || actual.stdout.trim() !== `wasm-bindgen ${version}`) {
    throw new Error(`Install the matching CLI: cargo install wasm-bindgen-cli --version ${version} --locked`);
  }
  run("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "-p", "poop-bird-wasm"]);
  mkdirSync("public/game-wasm", { recursive: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", "public/game-wasm", "target/wasm32-unknown-unknown/release/poop_bird_wasm.wasm"]);
}
