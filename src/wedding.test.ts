import { describe, expect, it } from "vitest";
import { Game } from "./game";

/** A game whose bird hovers mid-screen and can't die, so the world just scrolls by. */
function immortalGame(): { game: Game; step: (seconds: number, until?: () => boolean) => void } {
  const game = new Game(1000);
  const g = game as unknown as { crash: () => void; zap: () => void };
  g.crash = () => {};
  g.zap = () => {};
  const step = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * 120; i++) {
      game.bird.y = 250;
      game.bird.vy = 0;
      game.step(1 / 120);
      if (until?.()) return;
    }
  };
  return { game, step };
}

describe("wedding", () => {
  it("happens in the run's first city stage", () => {
    const { game, step } = immortalGame();
    let seen = false;
    step(60, () => {
      seen ||= game.wedding !== null;
      return seen || game.stage !== "city";
    });
    expect(seen).toBe(true);
  });

  it("gets married when nobody splats the kiss, then clears once the church is gone", () => {
    const { game, step } = immortalGame();
    step(0.5);
    game.spawnWeddingNow();
    const wedding = game.wedding;
    expect(wedding).not.toBeNull();
    step(30, () => game.wedding === null);
    expect(wedding?.outcome).toBe("married");
    expect(game.weddingPhotos).toHaveLength(1);
    expect(game.wedding).toBeNull();
    // With the wedding gone, the sidewalk is open again for more than cars.
    step(20, () => game.targets.some((t) => t.kind !== "car" && !t.wedding));
    expect(game.targets.some((t) => t.kind !== "car" && !t.wedding)).toBe(true);
  });
});
