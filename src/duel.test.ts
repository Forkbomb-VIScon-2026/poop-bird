import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import {
  DUEL_COUNTDOWN,
  DUEL_STEP,
  Duel,
  birdHitsGate,
  gatePassable,
  homeLane,
  makeGate,
  mulberry32,
  poopFallTime,
  type DuelEvent,
  type DuelInput,
  type DuelParams,
  type Gate,
  type GateKind,
} from "./duel";
import { project, type DuelCamera } from "./duel-camera";

const IDLE: DuelInput = { straining: false, steer: 0 };

function params(over: Partial<DuelParams> = {}): DuelParams {
  return { ...defaultConfig(), ...over };
}

/** A duel past the countdown, with nothing spawning on its own unless asked. */
function playing(over: Partial<DuelParams> = {}, seed = 1): Duel {
  const d = new Duel(params({ duelTargetRate: 0, duelFirstGateDelay: 1000, startGrace: 0, ...over }), seed);
  stepFor(d, DUEL_COUNTDOWN + DUEL_STEP);
  expect(d.phase).toBe("playing");
  d.events.length = 0;
  return d;
}

function stepFor(d: Duel, seconds: number, inputs: (t: number) => [DuelInput, DuelInput] = () => [IDLE, IDLE]): DuelEvent[] {
  const events: DuelEvent[] = [];
  const n = Math.round(seconds / DUEL_STEP);
  for (let i = 0; i < n; i++) {
    d.step(DUEL_STEP, inputs(i * DUEL_STEP));
    events.push(...d.events);
    d.events.length = 0;
  }
  return events;
}

/** Holds both birds still in the air (no gravity) so tests can place them. */
function freeze(d: Duel): void {
  for (const b of d.birds) {
    b.vy = 0;
    b.vx = 0;
  }
}

function gateAt(d: Duel, z: number, rects: Gate["rects"]): Gate {
  const g: Gate = { id: 999, kind: "footbridge", z, depth: 40, rects, opening: null, passed: [false, false], ghost: false, splats: [], seed: 0 };
  d.gates.push(g);
  return g;
}

describe("gates", () => {
  it("crashes a bird inside a solid rect, but not one in the opening", () => {
    const d = playing({ gravity: 0 });
    const [a, b] = d.birds;
    a.y = 300;
    b.y = 100;
    freeze(d);
    // A deck from 260 to 340 across the avenue: a (300) is inside, b (100) passes under.
    gateAt(d, d.z + 20, [{ x0: -1000, x1: 1000, y0: 260, y1: 340, part: "deck" }]);
    const events = stepFor(d, 0.3);
    const crashes = events.filter((e) => e.type === "crash");
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({ player: 0, cause: "gate" });
    expect(d.birds[1].state).toBe("flying");
    expect(events.some((e) => e.type === "gatePassed" && e.player === 1)).toBe(true);
  });

  it("only collides while the bird is inside the gate's z range", () => {
    const d = playing({ gravity: 0 });
    freeze(d);
    const g = gateAt(d, d.z + 1000, [{ x0: -1000, x1: 1000, y0: 0, y1: 1000, part: "wall" }]);
    stepFor(d, 0.1);
    expect(d.birds.every((b) => b.state === "flying")).toBe(true);
    expect(birdHitsGate(d.birds[0].x, d.birds[0].y, 24, g)).toBe(true);
  });

  it("every generated gate leaves an opening for both birds, over many seeds", () => {
    const p = params();
    const kinds: GateKind[] = ["footbridge", "banner", "wires", "arch"];
    for (let seed = 1; seed <= 400; seed++) {
      const rng = mulberry32(seed);
      for (const kind of kinds) {
        for (const progress of [0, 0.5, 1]) {
          const g = makeGate(kind, 0, rng, p, progress, 1);
          expect(gatePassable(g, p), `${kind} seed ${seed} progress ${progress}`).toBe(true);
        }
      }
    }
  });

  it("gates generated during real matches are passable, also with tight settings", () => {
    for (const over of [{}, { duelMinOpening: 200, duelCeiling: 400 }, { duelAvenueHalfWidth: 180 }]) {
      for (let seed = 1; seed <= 25; seed++) {
        const d = new Duel(params({ duelMatchTime: 40, ...over }), seed);
        const seen = new Set<number>();
        for (let i = 0; i < 50 / DUEL_STEP && d.phase !== "over"; i++) {
          d.step(DUEL_STEP, [IDLE, IDLE]);
          d.events.length = 0;
          for (const g of d.gates) {
            if (seen.has(g.id)) continue;
            seen.add(g.id);
            expect(gatePassable(g, d.params), `${g.kind} seed ${seed}`).toBe(true);
          }
        }
        expect(seen.size).toBeGreaterThan(5);
      }
    }
  });

  it("a fully blocked gate is not passable", () => {
    const p = params();
    const g: Gate = { id: 1, kind: "arch", z: 0, depth: 10, rects: [{ x0: -1000, x1: 1000, y0: 0, y1: 1000, part: "wall" }], opening: null, passed: [false, false], ghost: false, splats: [], seed: 0 };
    expect(gatePassable(g, p)).toBe(false);
    // A slot narrower than the min opening isn't enough either.
    g.rects = [
      { x0: -1000, x1: 0, y0: 0, y1: 1000, part: "wall" },
      { x0: p.duelMinOpening - 10, x1: 1000, y0: 0, y1: 1000, part: "wall" },
    ];
    expect(gatePassable(g, p)).toBe(false);
  });

  it("the first gate comes after duelFirstGateDelay", () => {
    const d = new Duel(params({ duelFirstGateDelay: 3 }), 7);
    stepFor(d, DUEL_COUNTDOWN + DUEL_STEP);
    const first = Math.min(...d.gates.filter((g) => g.kind !== "finish").map((g) => g.z));
    expect(first - d.z).toBeGreaterThanOrEqual(d.speed * 3 - 5);
  });
});

describe("bombs", () => {
  function setup(): Duel {
    const d = playing({ gravity: 0, maxFallSpeed: 0 });
    freeze(d);
    return d;
  }

  /** Bird 0 charges a bit and releases. */
  function poopFrom0(d: Duel): DuelEvent[] {
    return [
      ...stepFor(d, 0.3, () => [{ straining: true, steer: 0 }, IDLE]),
      ...stepFor(d, 1.2, () => [IDLE, IDLE]),
    ];
  }

  it("a poop released over the rival falls on it and stuns it", () => {
    const d = setup();
    const [a, b] = d.birds;
    a.x = b.x = 0;
    a.y = 400;
    b.y = 200;
    const events = poopFrom0(d);
    const bomb = events.find((e) => e.type === "bomb");
    expect(bomb).toMatchObject({ player: 0, victim: 1, points: d.params.duelBombPoints });
    expect(d.birds[0].score).toBe(d.params.duelBombPoints);
    expect(d.birds[1].stats.bombed).toBe(1);
    expect(d.birds[0].stats.bombs).toBe(1);
  });

  it("stuns the rival: no charging, needs a release", () => {
    const d = setup();
    const [a, b] = d.birds;
    a.x = b.x = 0;
    a.y = 400;
    b.y = 200;
    stepFor(d, 0.3, () => [{ straining: true, steer: 0 }, IDLE]);
    // Release and look right after the hit.
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      d.step(DUEL_STEP, [IDLE, IDLE]);
      hit = d.events.some((e) => e.type === "bomb");
      d.events.length = 0;
    }
    expect(hit).toBe(true);
    expect(d.birds[1].charge.stun).toBeGreaterThan(0);
    expect(d.birds[1].charge.needsRelease).toBe(true);
    expect(d.birds[1].charge.charge).toBe(0);
  });

  it("misses a rival beside it", () => {
    const d = setup();
    const [a, b] = d.birds;
    a.x = -150;
    b.x = 150;
    a.y = 400;
    b.y = 200;
    const events = poopFrom0(d);
    expect(events.some((e) => e.type === "bomb")).toBe(false);
    expect(events.some((e) => e.type === "splat" && e.where === "street")).toBe(true);
  });

  it("can't hit a rival above it, nor the bomber itself", () => {
    const d = setup();
    const [a, b] = d.birds;
    a.x = b.x = 0;
    a.y = 200;
    b.y = 400;
    // Keep them from bumping: far apart vertically, same x.
    const events = poopFrom0(d);
    expect(events.some((e) => e.type === "bomb")).toBe(false);
    expect(d.birds[0].charge.stun).toBe(0);
    expect(d.birds[1].charge.stun).toBe(0);
  });

  it("gives the victim immunity, so a barrage can't stun-lock it", () => {
    const d = setup();
    const [a, b] = d.birds;
    a.x = b.x = 0;
    a.y = 450;
    b.y = 150;
    // Two quick poops: only the first one counts.
    const events = [...poopFrom0(d), ...poopFrom0(d)];
    expect(events.filter((e) => e.type === "bomb")).toHaveLength(1);
    // After the immunity runs out, it can be hit again.
    stepFor(d, d.params.duelBombImmunity + 0.1);
    freeze(d);
    d.birds[0].y = 450;
    d.birds[1].y = 150;
    d.birds[0].x = d.birds[1].x = 0;
    expect(poopFrom0(d).filter((e) => e.type === "bomb")).toHaveLength(1);
  });
});

describe("targets", () => {
  it("a poop on a car scores with the multiplier and builds the combo; a miss resets it", () => {
    const d = playing({ gravity: 0, maxFallSpeed: 0 });
    freeze(d);
    const b = d.birds[0];
    b.x = 0;
    b.y = 200;
    d.birds[1].x = 250;
    const fire = () => [...stepFor(d, 0.05, () => [{ straining: true, steer: 0 }, IDLE]), d.landingSpot(0)!] as const;
    const hitAt = (kind: "car" | "statue" | "pedestrian") => {
      stepFor(d, 0.05, () => [{ straining: true, steer: 0 }, IDLE]);
      const spot = d.landingSpot(0)!;
      const t = d.spawnTarget(kind, spot.z)!;
      t.x = spot.x;
      t.vx = t.vz = 0;
      const events = stepFor(d, 1.2);
      return events.find((e) => e.type === "targetHit");
    };
    const first = hitAt("car");
    expect(first).toMatchObject({ kind: "car", combo: 1, points: Math.round(d.params.targetPoints * 1) });
    const second = hitAt("pedestrian");
    expect(second).toMatchObject({ kind: "pedestrian", combo: 2, points: Math.round(d.params.targetPoints * 1.5 * (1 + d.params.comboStep)) });
    expect(b.combo).toBe(2);
    // A miss on the street resets it.
    fire();
    const miss = stepFor(d, 1.2);
    expect(miss.some((e) => e.type === "splat" && e.where === "street" && e.comboLost)).toBe(true);
    expect(b.combo).toBe(0);
    const statue = hitAt("statue");
    expect(statue).toMatchObject({ kind: "statue", combo: 1, points: d.params.targetPoints * 2 });
  });

  it("the landing spot is where the poop actually lands", () => {
    const d = playing({ gravity: 0, maxFallSpeed: 0 });
    freeze(d);
    d.birds[0].y = 300;
    d.birds[1].x = 250;
    stepFor(d, 0.4, () => [{ straining: true, steer: 0 }, IDLE]);
    const spot = d.landingSpot(0)!;
    const events = stepFor(d, 1.5);
    const splat = events.find((e) => e.type === "splat");
    expect(splat).toBeDefined();
    if (splat?.type !== "splat") return;
    expect(Math.abs(splat.z - spot.z)).toBeLessThan(15);
    expect(Math.abs(splat.x - spot.x)).toBeLessThan(1e-6);
  });

  it("poopFallTime solves the fall", () => {
    const t = poopFallTime(300, 10, 200, 1000);
    expect(290 - (200 * t + 500 * t * t)).toBeCloseTo(0, 6);
    expect(poopFallTime(5, 10, 200, 1000)).toBe(0);
  });
});

describe("crashes", () => {
  it("street crash: penalty floored at 0, respawn, then a shield", () => {
    const d = playing({ duelCrashPenalty: 150, duelRespawnTime: 1, duelInvulnTime: 2 });
    const b = d.birds[0];
    b.score = 100;
    b.combo = 3;
    b.y = 30;
    b.vy = -200;
    const events = stepFor(d, 0.1);
    const crash = events.find((e) => e.type === "crash");
    expect(crash).toMatchObject({ player: 0, cause: "street", penalty: 100 });
    expect(b.score).toBe(0);
    expect(b.combo).toBe(0);
    expect(b.state).toBe("crashed");
    expect(b.stats.penalty).toBe(100);
    // Strain while tumbling does nothing; respawn after duelRespawnTime.
    const later = stepFor(d, 1.0, () => [{ straining: true, steer: 0 }, IDLE]);
    expect(later.some((e) => e.type === "respawn" && e.player === 0)).toBe(true);
    expect(b.state).toBe("flying");
    expect(b.x).toBeCloseTo(homeLane(0, d.params.duelAvenueHalfWidth), 6);
    expect(b.invuln).toBeGreaterThan(1.5);
    // A held strain from before the respawn doesn't fire.
    expect(b.charge.needsRelease).toBe(true);
    // Shielded: gates and bombs don't count, the street bounces it back.
    gateAt(d, d.z, [{ x0: -1000, x1: 1000, y0: 0, y1: 1000, part: "wall" }]);
    b.y = 30;
    b.vy = -300;
    const shielded = stepFor(d, 0.2);
    expect(shielded.some((e) => e.type === "crash" && e.player === 0)).toBe(false);
    expect(b.state).toBe("flying");
  });

  it("a second crash with a score above the penalty takes the whole penalty", () => {
    const d = playing({ duelCrashPenalty: 150 });
    const b = d.birds[1];
    b.score = 500;
    b.y = 26;
    b.vy = -300;
    stepFor(d, 0.1);
    expect(b.score).toBe(350);
  });

  it("a tall statue is solid", () => {
    const d = playing({ gravity: 0 });
    freeze(d);
    const b = d.birds[0];
    b.x = 0;
    b.y = 60;
    d.birds[1].x = 250;
    d.spawnTarget("statue", d.z + 30);
    const events = stepFor(d, 0.3);
    expect(events.find((e) => e.type === "crash")).toMatchObject({ player: 0, cause: "statue" });
  });
});

describe("bird physics", () => {
  it("bird-bird bump separates them", () => {
    const d = playing({ gravity: 0, maxFallSpeed: 0 });
    freeze(d);
    const [a, b] = d.birds;
    a.x = -5;
    b.x = 5;
    a.y = b.y = 250;
    const events = stepFor(d, DUEL_STEP);
    expect(events.some((e) => e.type === "bump")).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(2 * d.params.duelBirdRadius - 1e-6);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    // Even exactly on top of each other.
    a.x = b.x = 0;
    a.y = b.y = 250;
    stepFor(d, DUEL_STEP);
    expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(0);
  });

  it("clamps to the ceiling (losing the upward speed) and to the avenue", () => {
    const d = playing();
    const b = d.birds[0];
    b.y = d.params.duelCeiling - 30;
    b.vy = 800;
    stepFor(d, 0.1, () => [{ straining: false, steer: -1 }, IDLE]);
    expect(b.y).toBeLessThanOrEqual(d.params.duelCeiling - d.params.duelBirdRadius);
    expect(b.vy).toBeLessThanOrEqual(0);
    stepFor(d, 4, () => [{ straining: false, steer: -1 }, { straining: false, steer: 1 }]);
    const lim = d.params.duelAvenueHalfWidth - d.params.duelBirdRadius;
    expect(d.birds[0].x).toBeGreaterThanOrEqual(-lim);
    expect(d.birds[1].x).toBeLessThanOrEqual(lim);
  });

  it("steering is a velocity: a level head keeps the bird where it is", () => {
    const d = playing({ gravity: 0 });
    freeze(d);
    const b = d.birds[0];
    stepFor(d, 0.5, () => [{ straining: false, steer: 1 }, IDLE]);
    expect(b.vx).toBeGreaterThan(0);
    stepFor(d, 1, () => [IDLE, IDLE]);
    const x = b.x;
    stepFor(d, 1, () => [IDLE, IDLE]);
    expect(Math.abs(b.x - x)).toBeLessThan(1);
  });

  it("charges and releases like the main game: a release pushes the bird up", () => {
    const d = playing();
    const b = d.birds[0];
    b.y = 200;
    b.vy = 0;
    stepFor(d, d.params.chargeTime, () => [{ straining: true, steer: 0 }, IDLE]);
    expect(b.charge.charge).toBeCloseTo(1, 1);
    const events = stepFor(d, DUEL_STEP);
    expect(events.find((e) => e.type === "release")).toMatchObject({ player: 0 });
    expect(b.vy).toBeGreaterThan(d.params.pushMax * 0.8);
  });

  it("overstraining is an accident (stun), as in the main game", () => {
    const d = playing({ gravity: 0 });
    freeze(d);
    const events = stepFor(d, d.params.chargeTime + d.params.overstrainTime + 0.1, () => [{ straining: true, steer: 0 }, IDLE]);
    expect(events.some((e) => e.type === "accident" && e.player === 0)).toBe(true);
    expect(d.birds[0].charge.stun).toBeGreaterThan(0);
  });
});

describe("match flow", () => {
  it("counts down without gravity, then plays", () => {
    const d = new Duel(params(), 3);
    const y = d.birds[0].y;
    const events = stepFor(d, DUEL_COUNTDOWN - 0.1, () => [{ straining: true, steer: 1 }, IDLE]);
    expect(d.phase).toBe("countdown");
    expect(d.birds[0].y).toBeCloseTo(y, 3);
    expect(d.birds[0].charge.charge).toBe(0);
    expect(events.some((e) => e.type === "release")).toBe(false);
    expect(stepFor(d, 0.2).some((e) => e.type === "go")).toBe(true);
    expect(d.phase).toBe("playing");
  });

  it("timer → finish arch → over; inputs no longer do anything", () => {
    const d = new Duel(params({ duelMatchTime: 5 }), 4);
    const events = stepFor(d, DUEL_COUNTDOWN + 5.1, () => [IDLE, IDLE]);
    expect(events.some((e) => e.type === "timeUp")).toBe(true);
    expect(d.phase).toBe("finishing");
    expect(d.gates.some((g) => g.kind === "finish")).toBe(true);
    const scores = d.birds.map((b) => b.score);
    const later = stepFor(d, 3, () => [{ straining: true, steer: 1 }, { straining: true, steer: -1 }]);
    expect(d.phase).toBe("over");
    expect(later.some((e) => e.type === "finish")).toBe(true);
    expect(later.some((e) => e.type === "release" || e.type === "crash")).toBe(false);
    expect(d.birds.map((b) => b.score)).toEqual(scores);
    expect(d.birds.every((b) => b.charge.charge === 0)).toBe(true);
  });

  it("names the winner, or a tie", () => {
    const d = new Duel(params({ duelMatchTime: 1 }), 5);
    d.birds[1].score = 10;
    const events = stepFor(d, DUEL_COUNTDOWN + 4);
    expect(events.find((e) => e.type === "finish")).toMatchObject({ winner: 1 });
    const tie = new Duel(params({ duelMatchTime: 1 }), 5);
    expect(stepFor(tie, DUEL_COUNTDOWN + 4).find((e) => e.type === "finish")).toMatchObject({ winner: null });
  });

  it("is deterministic: same seed and inputs, same state", () => {
    const script = (t: number): [DuelInput, DuelInput] => [
      { straining: Math.sin(t * 3) > 0.2, steer: Math.sin(t * 0.7) },
      { straining: Math.cos(t * 2.3) > 0, steer: Math.cos(t * 0.5) },
    ];
    const run = () => {
      const d = new Duel(params({ duelMatchTime: 20 }), 42);
      const events = stepFor(d, 26, script);
      return { birds: d.birds, gates: d.gates.map((g) => [g.kind, g.z]), targets: d.targets.length, events: events.length };
    };
    expect(run()).toEqual(run());
  });

  it("a whole match with scripted inputs never produces NaN", () => {
    for (const seed of [1, 2, 3]) {
      const d = new Duel(params({ duelMatchTime: 75 }), seed);
      const rng = mulberry32(seed * 99);
      let inputs: [DuelInput, DuelInput] = [IDLE, IDLE];
      const n = Math.round((DUEL_COUNTDOWN + 80) / DUEL_STEP);
      const kinds = new Set<string>();
      for (let i = 0; i < n; i++) {
        if (i % 30 === 0) {
          inputs = [
            { straining: rng() < 0.45, steer: rng() * 2 - 1 },
            { straining: rng() < 0.45, steer: [NaN, Infinity, rng() * 4 - 2][Math.floor(rng() * 3)] },
          ];
        }
        d.step(DUEL_STEP, inputs);
        for (const e of d.events) kinds.add(e.type);
        d.events.length = 0;
        for (const b of d.birds) {
          for (const v of [b.x, b.y, b.vx, b.vy, b.score, b.charge.charge]) expect(Number.isFinite(v)).toBe(true);
        }
        for (const p of d.poops) expect(Number.isFinite(p.y + p.z)).toBe(true);
      }
      expect(d.phase).toBe("over");
      expect(kinds.has("release")).toBe(true);
      expect(Number.isFinite(d.z)).toBe(true);
      expect(d.poops.length).toBeLessThanOrEqual(60);
    }
  });

  it("ignores zero, negative and NaN time steps", () => {
    const d = new Duel(params(), 1);
    d.step(0, [IDLE, IDLE]);
    d.step(-1, [IDLE, IDLE]);
    d.step(NaN, [IDLE, IDLE]);
    expect(d.time).toBe(0);
  });
});

describe("camera projection", () => {
  const cam: DuelCamera = { x: 0, y: 300, z: 0, f: 300, cx: 500, horizon: 180, near: 20 };

  it("a point on the camera axis projects to the centre", () => {
    const p = project(cam, 0, 300, 500)!;
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(180);
  });

  it("further means smaller and closer to the vanishing point", () => {
    const near = project(cam, 100, 0, 300)!;
    const far = project(cam, 100, 0, 3000)!;
    expect(far.s).toBeLessThan(near.s);
    expect(Math.abs(far.x - 500)).toBeLessThan(Math.abs(near.x - 500));
    expect(far.y).toBeLessThan(near.y);
  });

  it("culls points behind the camera or too close", () => {
    expect(project(cam, 0, 0, -10)).toBeNull();
    expect(project(cam, 0, 0, 0)).toBeNull();
    expect(project(cam, 0, 0, 19.9)).toBeNull();
    expect(project(cam, 0, 0, 21)).not.toBeNull();
  });
});
