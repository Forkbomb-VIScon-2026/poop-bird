import { describe, expect, it } from "vitest";
import { BIRD_RADIUS, GROUND_Y, Game, WATER_Y } from "./game";

/** A city game with the quay's edge `edge` px behind the bird. */
function atHarbour(edge: number, y: number, vy: number): Game {
  const game = new Game(1000);
  game.stageTime = 10; // past the start grace: full gravity
  game.shore = { x: game.bird.x - edge, kind: "dive" };
  Object.assign(game.bird, { y, vy });
  return game;
}

describe("harbour dive", () => {
  it("dives in instead of crashing when the bird hits the water just past the edge", () => {
    const game = atHarbour(5, WATER_Y - BIRD_RADIUS - 1, 300);
    game.step(1 / 60);
    expect(game.phase).toBe("playing");
    expect(game.transition?.to).toBe("ocean");
  });

  it("takes over once the bird is well past the edge, at any height", () => {
    const game = atHarbour(80, 120, 0);
    game.step(1 / 60);
    expect(game.transition?.to).toBe("ocean");
  });

  it("lets the bird fly on over the street before the edge", () => {
    const game = atHarbour(-50, 240, 0);
    game.step(1 / 60);
    expect(game.transition).toBeNull();
  });

  it("ends up in the ocean, alive", () => {
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 6 && game.stage === "city"; i++) game.step(1 / 60);
    for (let i = 0; i < 60 * 6 && game.transition; i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    expect(game.transition).toBeNull();
    expect(game.phase).toBe("playing");
  });
});

describe("leaping out", () => {
  /** Dives in, then brings the far quay up `ahead` px in front of the fish at depth `y`. */
  function leapFrom(ahead: number, y: number, puff: number): Game {
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    game.bird.y = y;
    game.puffInput = puff;
    game.shore = { x: game.bird.x + ahead, kind: "exit" };
    for (let i = 0; i < 60 * 12 && (game.stage === "ocean" || game.transition); i++) game.step(1 / 60);
    return game;
  }

  for (const [label, ahead, y, puff] of [
    ["hovering, with the quay still coming up", 600, 300, 0.4],
    ["from deep down, right at the takeover", 300, 470, 0],
  ] as const) {
    it(`hands the bird back above the street, past the quay wall (${label})`, () => {
      const game = leapFrom(ahead, y, puff);
      expect(game.phase).toBe("playing");
      expect(game.stage).toBe("city");
      expect(game.transition).toBeNull();
      expect(game.overWater(game.bird.x)).toBe(false);
      expect(game.bird.y + BIRD_RADIUS).toBeLessThan(GROUND_Y - 100);
    });
  }
});

describe("attract mode", () => {
  it("flies on its own for a long while and keeps hitting people", () => {
    const game = new Game(1000);
    game.startDemo();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 120 * 120; i++) {
      game.stepDemo(1 / 120);
      minY = Math.min(minY, game.bird.y);
      maxY = Math.max(maxY, game.bird.y);
    }
    expect(game.phase).toBe("playing");
    expect(game.accidents).toBe(0);
    expect(game.obstacles).toHaveLength(0);
    expect(game.targetsHit).toBeGreaterThan(20);
    expect(game.targetsHit).toBeGreaterThanOrEqual(game.poopsDropped * 0.85);
    // Clear of the statues' heads, and never pinned to the top of the screen.
    expect(maxY).toBeLessThan(GROUND_Y - BIRD_RADIUS - 100);
    expect(minY).toBeGreaterThan(80);
  });

  it("leaves no trace once reset for a real run", () => {
    const game = new Game(1000);
    game.startDemo();
    for (let i = 0; i < 120 * 10; i++) game.stepDemo(1 / 120);
    game.reset();
    expect(game.demo).toBe(false);
    expect(game.targets).toHaveLength(0);
    expect(game.score).toBe(0);
  });
});
