/** Compare complete scoped world state, all effects and ordered events. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { CityWorld } from "../../public/game-wasm/poop_bird_wasm.js";
import { Game } from "../../src/game";
import { SeededRng } from "../../src/rng";
import { config } from "../../src/config";
import { CityRuntime, decodeCityFrame, CITY_PARAM_KEYS, type CityCommand, type CityFrame } from "../../src/runtime/city-world";

await init({ module_or_path: await readFile("public/game-wasm/poop_bird_wasm_bg.wasm") });
const keys = ["width", "time", "runTime", "stageTime", "bird", "charge", "perchX", "speed", "distance", "bonus", "combo", "bestCombo", "targetsHit", "poopsDropped", "accidents", "shake", "message",
  "targets", "poops", "particles", "decals", "floaters", "screenSplats", "events", "sweetSpot", "overstrainProgress"] as const;
let maxError = 0, comparisons = 0;
function compare(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === "number" && typeof expected === "number") {
    const error = Math.abs(actual - expected); maxError = Math.max(maxError, error); comparisons++;
    assert.ok(Number.isFinite(actual) && error <= 1e-10 * Math.max(1, Math.abs(expected)), `${path}: ${actual} != ${expected}`);
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path + ".length");
    actual.forEach((value, i) => compare(value, expected[i], `${path}[${i}]`));
  } else if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const a = actual as Record<string, unknown>, b = expected as Record<string, unknown>;
    for (const key of Object.keys(b)) compare(a[key], b[key], `${path}.${key}`);
  } else { assert.equal(actual, expected, path); }
}
function snapshot(game: Game) {
  return Object.fromEntries(keys.map(key => [key, key === "targets"
    ? game.targets.map(t => ({ ...t, rage: t.rage ?? null })) : game[key]]));
}
function check(frame: CityFrame, game: Game, label: string) { compare(frame, snapshot(game), label); }

const original = { ...config };
try { for (const seed of [1234, 42, 0xffffffff]) {
  const game = new Game(1000, new SeededRng(seed).next);
  const rust = new CityRuntime(new CityWorld(1000, seed));
  try {
    game.startDemo(); check(rust.advance(0, 0, false, [{ type: "demo" }]), game, "demo initial");
    const before = rust.advance(0, 0);
    assert.throws(() => rust.advance(1 / 120, 13, false, [{ type: "reset" }]), /Request/);
    assert.deepEqual(rust.advance(0, 0), before);
    for (let i = 0; i < 6000; i++) {
      const commands: CityCommand[] = i === 2000 ? [{ type: "resize", width: 720 }] : i === 4000 ? [{ type: "resize", width: 1200 }] : [];
      for (const c of commands) if (c.type === "resize") game.resize(c.width);
      // Alternate one-tick and twelve-tick calls to verify coarse batching.
      const ticks = i % 11 === 0 ? 12 : 1;
      for (let tick = 0; tick < ticks; tick++) game.stepDemo(1 / 120);
      check(rust.advance(1 / 120, ticks, false, commands), game, `demo ${seed}:${i}`);
    }
    game.reset(); game.perch();
    check(rust.advance(0, 0, false, [{ type: "reset" }, { type: "perch" }]), game, "perch initial");
    for (let i = 0; i < 3000; i++) {
      const held = i % 500 < 350;
      game.straining = held;
      const commands: CityCommand[] = i === 50 ? [{ type: "spawnCar" }] : i === 900 ? [{ type: "resize", width: 900 }] : [];
      for (const c of commands) if (c.type === "resize") game.resize(c.width); else game.spawnCarNow();
      const ticks = i % 17 === 0 ? 12 : 1;
      for (let tick = 0; tick < ticks; tick++) game.stepPerch(1 / 120);
      check(rust.advance(1 / 120, ticks, held, commands), game, `practice ${seed}:${i}`);
      game.events.length = 0;
      if (i === 1000) { config.pushMax += 5; }
      if (i === 1001) { config.pushMax -= 5; }
    }
    game.reset(); check(rust.advance(0, 0, false, [{ type: "reset" }]), game, "idle initial");
    const retained = rust.advance(0, 0), retainedCopy = structuredClone(retained);
    for (let i = 0; i < 100; i++) { game.idle(0.1); check(rust.advance(0.1, 1), game, `idle ${i}`); }
    assert.deepEqual(retained, retainedCopy);
  } finally { rust.dispose(); }
} } finally { Object.assign(config, original); }
const raw = new CityWorld(1000, 1234);
try {
  const packet = raw.advance(new Float64Array(CITY_PARAM_KEYS.map(key => config[key])), new Float64Array([0, 0, 0, 0]));
  assert.throws(() => decodeCityFrame(packet.subarray(0, 10)), /Truncated/);
  const bad = packet.slice(); bad[0] = 99; assert.throws(() => decodeCityFrame(bad), /version/);
  bad.set(packet); bad[31] = 1e9; assert.throws(() => decodeCityFrame(bad), /count/);
  bad.set(packet); bad[6] = NaN; assert.throws(() => decodeCityFrame(bad), /Non-finite/);
} finally { raw.free(); }
console.log("Complete attract/practice Rust world parity:", { seeds: 3, batches: 27300, comparisons, maxError });
