/** Synthetic Node simulation benchmark. Does not measure browser frame time. */
import os from "node:os";
import { Game } from "../../src/game";
import { config } from "../../src/config";

console.log({ node: process.version, cpu: os.cpus()[0]?.model });
const originalRandom = Math.random;
const originalConfig = { ...config };
const lists = ["obstacles", "targets", "particles", "poops", "pebbles", "powerLines", "balloons", "jellies"] as const;
try {
  for (const label of ["demo", "city", "ocean", "city600"]) {
    const samples: number[] = [];
    const peaks: Record<string, number> = {};
    for (let run = 0; run < 5; run++) {
      let seed = 1234;
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      Object.assign(config, { ...originalConfig, cityObstaclesBeforeGate: 1e6, oceanObstacles: 1e6, sharkChance: 0, anglerChance: 0 });
      const game = new Game(1000);
      // Deliberately immortal synthetic scene; not a realistic gameplay replay.
      Object.defineProperties(game, { crash: { value: () => {} }, zap: { value: () => {} } });
      if (label === "demo") game.startDemo();
      if (label === "ocean") {
        game.stageTime = 10;
        game.shore = { x: game.bird.x - 80, kind: "dive" };
        for (let i = 0; i < 1440 && (game.stage === "city" || game.transition); i++) game.step(1 / 120);
        if (game.stage !== "ocean" || game.transition) throw Error("transition incomplete");
        game.puffInput = 0.4;
        game.obstacles = [];
        game.jellies = [];
      }
      if (label === "city600") game.particles = Array.from({ length: 600 }, (_, i) => ({
        x: i % 1000, y: 200, vx: 0, vy: 0, life: 1e5, maxLife: 1e5,
        size: 3, color: "#fff", gravity: 0, world: true,
      }));
      for (let batch = 0; batch < 210; batch++) {
        const start = performance.now();
        for (let i = 0; i < 120; i++) {
          if (label !== "demo") { game.bird.y = 250; game.bird.vy = 0; }
          if (label === "demo") game.stepDemo(1 / 120);
          else game.step(1 / 120);
          game.events.length = 0;
        }
        if (batch >= 10) samples.push((performance.now() - start) / 120);
        for (const key of lists) peaks[key] = Math.max(peaks[key] ?? 0, game[key].length);
        if (game.phase !== "playing") throw Error(`invalid phase ${label}: ${game.phase}`);
      }
    }
    samples.sort((a, b) => a - b);
    console.log({ label, batches: samples.length, ticksPerBatch: 120,
      medianMsPerTick: samples[500], p95MsPerTick: samples[950], maxBatchMs: samples.at(-1)! * 120, peaks });
  }
} finally {
  Math.random = originalRandom;
  Object.assign(config, originalConfig);
}
