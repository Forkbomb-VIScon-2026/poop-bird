/** Synthetic Node comparison; includes the WASM boundary and frame decoding.
 * This excludes Canvas, MediaPipe and rAF, so it is not browser frame timing.
 */
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import init, { CityWorld } from "../../public/game-wasm/poop_bird_wasm.js";
import { Game } from "../../src/game";
import { SeededRng } from "../../src/rng";
import { CityRuntime, CITY_PARAM_KEYS } from "../../src/runtime/city-world";
import { config } from "../../src/config";

await init({ module_or_path: await readFile("public/game-wasm/poop_bird_wasm_bg.wasm") });
const percentile = (values: number[], fraction: number) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
for (const ticks of [1, 12]) {
  for (const engine of ["typescript", "rust-wasm", "rust-wasm-raw"] as const) {
    const durations: number[] = [], stepCosts: number[] = [];
    let checksum = 0;
    for (const seed of [1234, 42, 99, 456, 2026]) {
      const game = new Game(1000, new SeededRng(seed).next); game.startDemo();
      const rust = new CityRuntime(new CityWorld(1000, seed)); rust.advance(0, 0, false, [{ type: "demo" }]);
      const raw = new CityWorld(1000, seed);
      const parameters = new Float64Array(CITY_PARAM_KEYS.map(key => config[key]));
      raw.advance(parameters, new Float64Array([0, 0, 0, 1, 2, 0]));
      const request = new Float64Array([1 / 120, ticks, 0, 0]);
      try {
        const advance = engine === "typescript" ? () => { for (let i = 0; i < ticks; i++) game.stepDemo(1 / 120); return game.bonus; }
          : engine === "rust-wasm" ? () => rust.advance(1 / 120, ticks).bonus : () => raw.advance(parameters, request)[22];
        for (let i = 0; i < 1200 / ticks; i++) advance();
        const start = performance.now();
        for (let i = 0; i < 24000 / ticks; i++) {
          const before = performance.now(); checksum += advance(); durations.push(performance.now() - before);
        }
        stepCosts.push((performance.now() - start) / 24000);
      } finally { rust.dispose(); raw.free(); }
    }
    console.log(JSON.stringify({ engine, ticksPerBatch: ticks, runs: 5, timedTicksPerRun: 24000,
      medianBatchMs: percentile(durations, 0.5), p95BatchMs: percentile(durations, 0.95), p99BatchMs: percentile(durations, 0.99),
      medianAmortizedTickMs: percentile(stepCosts, 0.5), checksum }));
  }
}
