/** Freeze the existing motion behavior independently of world contacts.
 * Regenerate explicitly; validation never updates expected values.
 */
import { writeFileSync } from "node:fs";
import { BIRD_RADIUS, Game } from "../../src/game";
import { config } from "../../src/config";
import { SeededRng } from "../../src/rng";

const next = new SeededRng(2026).next;
const game = new Game(1000, next);
// Isolate integration from encounters, which run after the recorded motion.
Object.defineProperties(game, {
  floorY: { value: () => 1e9 }, hitsObstacle: { value: () => false }, touchesWire: { value: () => false },
});
const motion = game as unknown as { updateBird(dt: number): void };
const keys = ["y", "vy", "rot", "stretch", "stretchV", "relief", "flap"] as const;
const rows = ["# protocol 2 bird motion: baseline 79a9cf0; 24 input and 8 output numbers"];
const original = { ...config };
try {
  for (let i = 0; i < 1024; i++) {
    game.phase = (["playing", "dying", "over"] as const)[i % 3];
    game.charge.charge = i % 4 === 0 ? 0 : next();
    game.charge.stun = i % 7 === 0 ? 1 : 0;
    game.stageTime = i % 11 === 0 ? 0 : next() * 5;
    // Include exact negative half-turn ties; Rust round() differs from JS.
    Object.assign(game.bird, {
      y: 1 + next() * 600, vy: (next() - 0.5) * 2400,
      rot: i % 9 === 0 ? -Math.PI : (next() - 0.5) * 80,
      stretch: 0.6 + next() * 0.9, stretchV: (next() - 0.5) * 50,
      relief: next(), flap: next(),
    });
    config.gravity = 200 + next() * 1800;
    config.startGrace = i % 5 === 0 ? 0 : next() * 4;
    config.chargeGravityScale = next();
    config.maxFallSpeed = 200 + next() * 800;
    config.chargeMaxFallSpeed = next() * 800;
    const dt = [0, 1 / 120, 1 / 60, 0.1][i % 4];
    const input = [5, ...keys.map(key => game.bird[key]), game.charge.charge, +game.stunned,
      game.phase === "playing" ? 0 : game.phase === "dying" ? 1 : 2, game.stageTime, dt,
      config.gravity, config.startGrace, config.chargeGravityScale, config.maxFallSpeed,
      config.chargeMaxFallSpeed, BIRD_RADIUS];
    motion.updateBird(dt);
    rows.push([...input, ...Array<number>(24 - input.length).fill(0),
      ...keys.map(key => game.bird[key]), 0].join(","));
  }
} finally { Object.assign(config, original); }
writeFileSync("tests/fixtures/bird-v2.csv", rows.join("\n") + "\n");
console.log("Frozen bird-motion cases:", rows.length - 1);
