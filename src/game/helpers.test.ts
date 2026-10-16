import { describe, expect, it } from "vitest";
import { config } from "../config";
import { Game } from ".";
import { burst, roll, UPWARD } from "./effects";
import { enterState } from "./world";

describe("burst", () => {
  it("sprays n particles within the given ranges", () => {
    const game = new Game(1000);
    burst(game, 100, 200, 30, {
      angle: UPWARD, speed: [50, 100], lift: -10, life: [0.5, 1], maxLife: 1, size: [2, 4], color: ["#a", "#b"], gravity: 300,
    });
    expect(game.particles).toHaveLength(30);
    for (const p of game.particles) {
      expect(p).toMatchObject({ x: 100, y: 200, maxLife: 1, gravity: 300, world: true });
      // Upward: vy (before the lift) is at most 0, and the speed is in range.
      expect(p.vy).toBeLessThanOrEqual(-10 + 1e-9);
      const speed = Math.hypot(p.vx, p.vy + 10);
      expect(speed).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(speed).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.life).toBeGreaterThanOrEqual(0.5);
      expect(p.life).toBeLessThanOrEqual(1);
      expect(["#a", "#b"]).toContain(p.color);
    }
  });

  it("scatters the start and takes straight velocities", () => {
    const game = new Game(1000);
    burst(game, 0, 0, 20, { spread: [10, 20], vx: 5, vy: [-1, 1], drift: 2, life: 1, maxLife: 1, size: 1, color: "#fff", gravity: 0, world: false });
    for (const p of game.particles) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(5);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(10);
      expect(p.vx).toBe(7);
      expect(Math.abs(p.vy)).toBeLessThanOrEqual(1);
      expect(p.world).toBe(false);
    }
  });

  it("rolls fixed numbers and ranges", () => {
    expect(roll(3)).toBe(3);
    for (let i = 0; i < 20; i++) {
      const r = roll([2, 4]);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(4);
    }
  });
});

describe("scoring", () => {
  it("counts the combo and pays more with it", () => {
    const game = new Game(1000);
    const first = game.scoreHit(2);
    expect(first).toBe(Math.round(config.targetPoints * 2));
    expect(game.scoreLabel(first)).toBe(`+${first}`);
    const second = game.scoreHit(2, 2);
    expect(game.combo).toBe(2);
    expect(game.bestCombo).toBe(2);
    expect(game.targetsHit).toBe(2);
    expect(second).toBe(Math.round(config.targetPoints * 2 * game.comboMultiplier * 2));
    expect(game.bonus).toBe(first + second);
    expect(game.scoreLabel(second)).toBe(`+${second}  x${game.comboMultiplier.toFixed(1)}`);
  });

  it("can score without counting a target, and drops the combo with a floater", () => {
    const game = new Game(1000);
    game.scoreHit(1, 1, false);
    game.scoreHit(1, 1, false);
    expect(game.targetsHit).toBe(0);
    game.dropCombo(10, 20, false);
    expect(game.combo).toBe(0);
    expect(game.floaters).toHaveLength(0);
    game.scoreHit(1);
    game.scoreHit(1);
    game.dropCombo(10, 20);
    expect(game.floaters.map((f) => f.text)).toEqual(["combo lost"]);
    expect(game.bestCombo).toBe(2);
  });
});

describe("enterState", () => {
  it("switches the state and restarts its clock", () => {
    const machine = { state: "a" as "a" | "b", t: 3 };
    enterState(machine, "b");
    expect(machine).toEqual({ state: "b", t: 0 });
  });
});
