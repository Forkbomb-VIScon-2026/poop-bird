import { afterEach, describe, expect, it } from "vitest";
import { config, defaultConfig } from "./config";
import { Game } from "./game";

/** A city game whose bird hovers mid-screen and can't die, with power lines and kids as likely as they get. */
function immortalCity(cityStage: number): { game: Game; step: (seconds: number, each: () => void) => void } {
  Object.assign(config, { powerLineChance: 1, kidChance: 1, kidMinDistance: 0, kidMinGap: 0, paparazziChance: 0, weddingChance: 0 });
  const game = new Game(1000);
  game.cityStage = cityStage;
  const g = game as unknown as { crash: () => void; zap: () => void };
  g.crash = () => {};
  g.zap = () => {};
  const step = (seconds: number, each: () => void) => {
    for (let i = 0; i < seconds * 120 && game.stage === "city" && !game.transition; i++) {
      game.bird.y = 250;
      game.bird.vy = 0;
      game.step(1 / 120);
      each();
    }
  };
  return { game, step };
}

afterEach(() => Object.assign(config, defaultConfig()));

describe("progression", () => {
  it("keeps power lines and slingshot kids out of the first city", () => {
    const { game, step } = immortalCity(1);
    let lines = 0;
    let kids = 0;
    step(60, () => {
      lines = Math.max(lines, game.powerLines.length);
      kids = Math.max(kids, game.targets.filter((t) => t.kind === "kid").length);
    });
    expect(game.shore).not.toBeNull();
    expect(lines).toBe(0);
    expect(kids).toBe(0);
  });

  it("brings in single-wire power lines and one-shot kids in the second city, more in the third", () => {
    for (const [stage, maxWires, shots] of [[2, 1, 1], [3, 2, 2]] as const) {
      const { game, step } = immortalCity(stage);
      let wires = 0;
      let kidShots = 0;
      step(60, () => {
        for (const l of game.powerLines) wires = Math.max(wires, l.wires.length);
        for (const t of game.targets) if (t.kid) kidShots = Math.max(kidShots, t.kid.shots);
      });
      expect(wires).toBeGreaterThan(0);
      expect(wires).toBeLessThanOrEqual(maxWires);
      expect(kidShots).toBe(shots);
    }
  });
});
