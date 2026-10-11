import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { SeededRng } from "./rng";

describe("seeded simulation reference", () => {
  it("uses the same unsigned sequence as Rust", () => {
    const rng = new SeededRng(1234);
    expect(Array.from({ length: 5 }, () => rng.next() * 4294967296)).toEqual([
      3067928073, 889114580, 3219257635, 1486326822, 3450746189,
    ]);
  });
  it("isolates explicit gameplay streams from intervening cosmetic random draws", () => {
    const a = new Game(1000, new SeededRng(1234).next);
    const b = new Game(1000, new SeededRng(1234).next);
    a.startDemo(); b.startDemo();
    for (let i = 0; i < 1200; i++) {
      a.stepDemo(1 / 120);
      for (let n = 0; n < 10; n++) Math.random();
      b.stepDemo(1 / 120);
    }
    expect(a.bird).toEqual(b.bird);
    expect(a.targets).toEqual(b.targets);
    expect(a.particles).toEqual(b.particles);
    expect(a.events).toEqual(b.events);
    expect(a.score).toEqual(b.score);
  });
});
