import { describe, expect, it } from "vitest";
import { ANGLER_TIP_DX, Game } from "./game";

/** Dives in and settles in the ocean, hovering, with a fisherman whose hook is `dy` below the fish and `ahead` px in front. */
function fishing(ahead: number, dy: number, puff = 0.4): Game {
  const game = new Game(1000);
  game.stageTime = 10;
  game.shore = { x: game.bird.x - 80, kind: "dive" };
  for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
  expect(game.stage).toBe("ocean");
  game.puffInput = puff;
  for (let i = 0; i < 60 && !(puff >= 0.85 && game.spike.spiked); i++) game.step(1 / 60);
  game.obstacles = [];
  game.jellies = [];
  game.spawnAnglerNow();
  const a = game.angler!;
  a.state = "fishing";
  a.t = 10; // the hook is down already
  a.x = game.bird.x + ahead + ANGLER_TIP_DX;
  a.hookY = a.target = game.bird.y + dy;
  return game;
}

function stepFor(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * 120; i++) game.step(1 / 120);
}

describe("the fisherman", () => {
  it("hooks the fish, holds the world still, and lands it", () => {
    const game = fishing(0, 0);
    game.step(1 / 120);
    expect(game.angler?.state).toBe("hooked");
    stepFor(game, 0.5);
    expect(game.speed).toBe(0);
    expect(game.phase).toBe("playing");
    stepFor(game, 5);
    expect(game.angler?.state).toBe("landed");
    expect(game.phase).toBe("over");
    expect(game.trophy).not.toBeNull();
  });

  it("hooks a spiked fish too: the hook always catches", () => {
    const game = fishing(0, 0, 1);
    expect(game.spike.spiked).toBe(true);
    game.step(1 / 120);
    expect(game.angler?.state).toBe("hooked");
  });

  it("hauls on a line snagged on a spiked fish until it parts", () => {
    const game = fishing(0, 120, 1);
    expect(game.spike.spiked).toBe(true);
    const bonus = game.bonus;
    game.step(1 / 120);
    expect(game.angler?.state).toBe("tugging");
    stepFor(game, 0.5);
    expect(game.angler?.state).toBe("snapped");
    const hookY = game.angler!.hookY;
    stepFor(game, 0.5);
    expect(game.angler!.hookY).toBeGreaterThan(hookY);
    expect(game.anglersSnapped).toBe(1);
    expect(game.bonus).toBeGreaterThan(bonus);
    expect(game.phase).toBe("playing");
  });

  it("lets an unspiked fish slip past his line", () => {
    const game = fishing(0, 120);
    game.step(1 / 120);
    expect(game.angler?.state).toBe("fishing");
    expect(game.phase).toBe("playing");
  });

  it("keeps the hook at the depth he cast it to", () => {
    const game = fishing(300, 150);
    const depth = game.angler!.target;
    game.bird.y -= 120;
    stepFor(game, 1);
    expect(Math.abs(game.angler!.hookY - depth)).toBeLessThanOrEqual(15);
  });
});
