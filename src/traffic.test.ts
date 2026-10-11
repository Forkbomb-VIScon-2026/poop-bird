import { describe, expect, it } from "vitest";
import { config } from "./config";
import { GROUND_Y, Game, carLength, type Target } from "./game";

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

  /** A quiet street with just these cars on it: [x, direction, cruising speed]. */
  function street(cars: [number, 1 | -1, number][]): { game: Game; cars: Target[]; run: (seconds: number) => void } {
    const game = new Game(1000);
    game.calmCity = true;
    config.targetSpawnRate = 0;
    const list = cars.map(([x, dir, cruise]) => {
      game.spawnCarNow();
      const t = game.targets[game.targets.length - 1];
      Object.assign(t, { x, facing: dir, y: dir === 1 ? GROUND_Y + 74 : GROUND_Y + 46, cruise, speed: dir * cruise, model: 1 });
      return t;
    });
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 120; i++) {
        game.bird.y = 250;
        game.bird.vy = 0;
        game.step(1 / 120);
      }
    };
    return { game, cars: list, run };
  }

  function blind(game: Game, t: Target, swerve: boolean): void {
    (game as unknown as { blindDriver: (t: Target) => void }).blindDriver(t);
    t.blind!.swerve = swerve;
  }

  it("a blinded driver doesn't brake, and rear-ends the car ahead", () => {
    const saved = config.targetSpawnRate;
    try {
      const { game, cars, run } = street([[600, 1, 40], [400, 1, 100]]);
      run(1);
      blind(game, cars[1], false);
      run(3);
      expect(cars[0].wreck).toBeTruthy();
      expect(cars[1].wreck).toBeTruthy();
      expect(game.carsCrashed).toBe(1);
    } finally {
      config.targetSpawnRate = saved;
    }
  });

  it("a swerving blinded driver crashes head-on into oncoming traffic", () => {
    const saved = config.targetSpawnRate;
    try {
      const { game, cars, run } = street([[300, 1, 100], [900, -1, 80]]);
      blind(game, cars[0], true);
      run(3);
      expect(cars[0].wreck).toBeTruthy();
      expect(cars[1].wreck).toBeTruthy();
    } finally {
      config.targetSpawnRate = saved;
    }
  });

  it("drivers who see fine stop behind a wreck instead of crashing into it", () => {
    const saved = config.targetSpawnRate;
    try {
      const { game, cars, run } = street([[900, 1, 40], [750, 1, 100], [500, 1, 120]]);
      run(0.3);
      blind(game, cars[1], false);
      run(2.5);
      expect(cars[1].wreck).toBeTruthy();
      expect(cars[2].wreck).toBeFalsy();
      // Braking in good time, a safe distance back.
      expect(cars[2].x).toBeGreaterThan(-100);
      expect(cars[1].x - cars[2].x - (carLength(cars[1]) + carLength(cars[2])) / 2).toBeGreaterThan(10);
    } finally {
      config.targetSpawnRate = saved;
    }
  });
});
