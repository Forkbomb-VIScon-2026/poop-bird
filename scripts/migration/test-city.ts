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
  "targets", "poops", "particles", "decals", "floaters", "screenSplats", "events", "sweetSpot", "overstrainProgress", "phase", "calmCity", "score", "obstacles"] as const;
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
// This checkpoint deliberately excludes encounters; disable them before reset.
const scoped = { powerLineChance: 0, balloonChance: 0, weddingChance: 0, paparazziChance: 0, kidChance: 0 };
const coverage = { buildings: 0, buildingSplats: 0, crash: 0, gameover: 0, calmBounces: 0, boundary: 0 };
try {
  Object.assign(config, scoped);
  for (const seed of [1234, 42, 0xffffffff]) for (const lesson of [false, true]) {
    const game = new Game(720, new SeededRng(seed).next);
    const rust = new CityRuntime(new CityWorld(720, seed));
    try {
      game.command({ type: "perch" });
      rust.advance(0, 0, false, [{ type: "perch" }]);
      // Practice entities/effects survive takeoff; practice scores do not.
      game.spawnCarNow(); rust.advance(0, 0, false, [{ type: "spawnCar" }]);
      for (let i = 0; i < 160; i++) {
        const held = i < 100; game.straining = held;
        game.stepPerch(1 / 120); rust.advance(1 / 120, 1, held); game.events.length = 0;
      }
      game.command({ type: "takeOff" }); game.command({ type: "lesson", stage: "city", enabled: lesson });
      check(rust.advance(0, 0, false, [{ type: "takeOff" }, { type: "lesson", enabled: lesson }]), game, "takeoff");
      for (let batch = 0; batch < 4000; batch++) {
        const commands: CityCommand[] = [];
        if (batch === 1800 && lesson) { game.calmCity = false; commands.push({ type: "lesson", enabled: false }); }
        if (batch === 2500) { game.resize(1000); commands.push({ type: "resize", width: 1000 }); }
        // Fly near the top to pass ordinary buildings; periodically overstrain.
        const held = !(lesson && batch < 500) && (batch % 1000 > 850 || (game.charge.charge > 0 ? game.charge.charge < 0.5 : game.bird.y > 130 && game.bird.vy > 0));
        const ticks = batch % 13 === 0 ? 12 : 2;
        game.straining = held;
        // Keep this trace below the waterfront; boundary has a separate test.
        config.cityObstaclesBeforeGate = 100000;
        for (let t = 0; t < ticks; t++) game.step(1 / 120);
        const frame = rust.advance(1 / 120, ticks, held, commands);
        check(frame, game, `run ${seed}:${lesson}:${batch}`);
        assert.equal(frame.blocked, false);
        coverage.buildings += frame.obstacles.length;
        coverage.buildingSplats += frame.obstacles.reduce((n, o) => n + o.splats.length, 0);
        for (const event of frame.events) if (event.type === "crash" || event.type === "gameover") coverage[event.type]++;
        if (frame.calmCity && frame.bird.vy === -320) coverage.calmBounces++;
        game.events.length = 0;
      }
    } finally { rust.dispose(); }
  }
  // Atomic rejection if live tuning enables an unsupported encounter.
  const world = new CityRuntime(new CityWorld(720, 42));
  try {
    const before = world.advance(0, 0);
    config.balloonChance = 1;
    assert.throws(() => world.advance(0, 0, false, [{ type: "resize", width: 500 }, { type: "takeOff" }]), /UnsupportedRun/);
    config.balloonChance = 0;
    assert.deepEqual(world.advance(0, 0), before);
    // A waterfront pauses before its first tick; repeated batches stay still.
    config.cityObstaclesBeforeGate = 0; config.firstObstacleDelay = 0;
    const frame = world.advance(1 / 120, 12, false, [{ type: "reset" }, { type: "takeOff" }]);
    assert.equal(frame.blocked, true); assert.equal(frame.runTime, 0); assert.equal(frame.distance, 0);
    assert.deepEqual(world.advance(1 / 120, 12), frame); coverage.boundary++;
  } finally { world.dispose(); }
} finally { Object.assign(config, original); }
assert.ok(coverage.buildings > 0 && coverage.buildingSplats > 0 && coverage.crash > 0 && coverage.gameover > 0 && coverage.calmBounces > 0, JSON.stringify(coverage));
console.log("City run/lesson parity coverage:", coverage);
const raw = new CityWorld(1000, 1234);
try {
  const packet = raw.advance(new Float64Array(CITY_PARAM_KEYS.map(key => config[key])), new Float64Array([0, 0, 0, 0]));
  assert.throws(() => decodeCityFrame(packet.subarray(0, 10)), /Truncated/);
  const bad = packet.slice(); bad[0] = 99; assert.throws(() => decodeCityFrame(bad), /version/);
  bad.set(packet); bad[31] = 1e9; assert.throws(() => decodeCityFrame(bad), /count/);
  bad.set(packet); bad[6] = NaN; assert.throws(() => decodeCityFrame(bad), /Non-finite/);
} finally { raw.free(); }
console.log("Complete scoped Rust city world parity:", { seeds: 3, batches: 51300, comparisons, maxError });
