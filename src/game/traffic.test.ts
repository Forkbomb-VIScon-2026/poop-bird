import { describe, expect, it } from "vitest";
import { config } from "../config";
import { Game, carLength, type Target } from ".";

describe("traffic", () => {
  it("keeps each direction in its own lane, and cars never overlap", () => {
    const saved = config.targetSpawnRate;
    config.targetSpawnRate = 3; // a busy road
    const game = new Game(1000);
    game.calmCity = true;
    try {
      for (let i = 0; i < 120 * 60; i++) {
        game.bird.y = 250;
        game.bird.vy = 0;
        game.step(1 / 120);
        const cars = game.targets.filter((t) => t.kind === "car");
        for (const dir of [1, -1] as const) {
          const lane = cars.filter((t) => t.facing === dir).sort((a, b) => a.x - b.x);
          expect(new Set(lane.map((t) => t.y)).size).toBeLessThanOrEqual(1);
          for (let j = 1; j < lane.length; j++) {
            const gap = lane[j].x - lane[j - 1].x - (carLength(lane[j]) + carLength(lane[j - 1])) / 2;
            expect(gap).toBeGreaterThan(0);
          }
          // Nobody drives backwards.
          for (const t of lane) expect(t.speed * dir).toBeGreaterThanOrEqual(0);
        }
        const ys = (dir: number) => cars.find((t: Target) => t.facing === dir)?.y;
        if (ys(1) !== undefined && ys(-1) !== undefined) expect(ys(1)).not.toBe(ys(-1));
      }
    } finally {
      config.targetSpawnRate = saved;
    }
  });

  it("always brings the lesson's car, even onto a busy road", () => {
    const game = new Game(1000);
    game.calmCity = true;
    for (let i = 0; i < 20; i++) game.spawnCarNow();
    expect(game.targets.filter((t) => t.kind === "car")).toHaveLength(20);
  });
});
