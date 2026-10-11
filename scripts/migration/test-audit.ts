/** Exercise the batched observer with real TypeScript simulation and real WASM. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { evaluate_batch } from "../../public/game-wasm/poop_bird_wasm.js";
import { Game } from "../../src/game";
import { SeededRng } from "../../src/rng";
import { KernelAudit } from "../../src/runtime/kernel-audit";
import { config } from "../../src/config";

await init({ module_or_path: await readFile("public/game-wasm/poop_bird_wasm_bg.wasm") });
const audit = new KernelAudit(evaluate_batch);
const demo = new Game(1000, new SeededRng(1234).next);
demo.kernelObserver = audit;
demo.startDemo();
for (let i = 0; i < 12000; i++) {
  demo.stepDemo(1 / 120);
  if (i % 12 === 11) audit.flush();
  demo.events.length = 0;
}
// Isolate spike behavior without changing persistent config or running browser I/O.
const original = { ...config };
try {
  Object.assign(config, { oceanObstacles: 1e6, sharkChance: 0, anglerChance: 0 });
  const ocean = new Game(1000, new SeededRng(42).next);
  ocean.stage = "ocean";
  ocean.kernelObserver = audit;
  Object.defineProperty(ocean, "crash", { value: () => {} });
  for (let i = 0; i < 12000; i++) {
    ocean.bird.y = 250; ocean.bird.vy = 0;
    ocean.puffInput = i % 500 < 350 ? 1 : 0;
    ocean.step(1 / 120);
    if (i % 12 === 11) audit.flush();
    ocean.events.length = 0;
  }
} finally { Object.assign(config, original); }
assert.equal(audit.stats.cases, 36000);
assert.equal(audit.stats.batches, 2000);
console.log("Live simulation / batched WASM shadow comparison:", audit.stats);
