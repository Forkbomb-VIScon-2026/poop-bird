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
  a.x = game.bird.x + ahead + ANGLER_TIP_DX;
  a.hookY = a.target = game.bird.y + dy;
  return game;
}

function stepFor(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * 120; i++) game.step(1 / 120);
}

describe("the fisherman", () => {
  it("hooks an unspiked fish, holds the world still, and lands it if it never spikes out", () => {
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

  it("lets a hooked fish break free by puffing up to spikes", () => {
    const game = fishing(0, 0);
    game.step(1 / 120);
    expect(game.angler?.state).toBe("hooked");
    game.puffInput = 1;
    stepFor(game, 0.6);
    expect(game.angler?.state).toBe("overboard");
    expect(game.angler?.escaped).toBe(true);
    expect(game.phase).toBe("playing");
    expect(game.anglersSnapped).toBe(1);
    expect(game.speed).toBeGreaterThan(0);
  });

  it("gets his line snapped by a spiked fish", () => {
    const game = fishing(0, 0, 1);
    expect(game.spike.spiked).toBe(true);
    const bonus = game.bonus;
    game.step(1 / 120);
    expect(game.angler?.state).toBe("overboard");
    expect(game.angler?.escaped).toBe(false);
    expect(game.bonus).toBeGreaterThan(bonus);
  });

  it("can be dodged once he's committed to a depth", () => {
    const game = fishing(60, 120);
    stepFor(game, 2);
    expect(game.angler?.state).toBe("leaving");
    expect(game.phase).toBe("playing");
  });
});
