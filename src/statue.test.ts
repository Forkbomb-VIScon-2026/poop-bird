import { afterEach, describe, expect, it } from "vitest";
import { config } from "./config";
import { Game, obstacleSpan, poleX } from "./game";

const saved = { statueChance: config.statueChance, targetSpawnRate: config.targetSpawnRate };
afterEach(() => Object.assign(config, saved));

describe("statues", () => {
  it("never stand in a building, a pole or another statue", () => {
    config.statueChance = 1;
    config.targetSpawnRate = 3;
    const game = new Game(1000);
    const g = game as unknown as { crash: () => void; zap: () => void };
    g.crash = () => {};
    g.zap = () => {};
    let statues = 0;
    const seen = new Set<object>();
    for (let i = 0; i < 120 * 90 && game.stage === "city"; i++) {
      game.bird.y = 250;
      game.bird.vy = 0;
      game.step(1 / 120);
      for (const t of game.targets) {
        if (t.kind !== "statue") continue;
        if (!seen.has(t)) {
          seen.add(t);
          statues++;
        }
        const l = t.x - t.w / 2, r = t.x + t.w / 2;
        for (const o of game.obstacles) {
          const s = obstacleSpan(o);
          expect(r < s.left || l > s.right).toBe(true);
        }
        for (const pl of game.powerLines) {
          for (let k = 0; k < pl.poles; k++) expect(Math.abs(poleX(pl, k) - t.x) > t.w / 2 + 6).toBe(true);
        }
        for (const u of game.targets) {
          if (u !== t && u.kind === "statue") expect(Math.abs(u.x - t.x) >= t.w).toBe(true);
        }
      }
    }
    expect(statues).toBeGreaterThan(3);
  });
});
