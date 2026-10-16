import { afterEach, describe, expect, it } from "vitest";
import { config, ramp } from "../config";
import {
  ANCHOR_H, ANCHOR_RIP_Y, ANCHOR_W, BIRD_RADIUS, BOAT_DRAFT, GROUND_Y, Game, OCEAN_MID_Y, PERCH_Y, SURFACE_Y, WATER_Y, WRECK_HULL_H,
  WRECK_MAST_MAX, WRECK_MAST_MIN, obstacleRects, type Obstacle,
} from ".";
import { spawnAngler } from "./angler";
import { spawnOceanObstacle } from "./ocean-obstacles";

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

describe("calm water", () => {
  /** A game that just dived into the ocean, in calm water. */
  function calm(): Game {
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 6 && game.stage === "city"; i++) game.step(1 / 60);
    game.calmWater = true;
    for (let i = 0; i < 60 * 6 && game.transition; i++) game.step(1 / 60);
    return game;
  }

  it("spawns nothing and lets the fish rest on the sea floor, while the world scrolls on", () => {
    const game = calm();
    const start = game.distance;
    game.puffInput = 0; // deflated: sinks to the floor
    for (let i = 0; i < 60 * 30; i++) game.step(1 / 60);
    expect(game.phase).toBe("playing");
    expect(game.distance).toBeGreaterThan(start + 500);
    expect(game.obstacles).toHaveLength(0);
    expect(game.jellies).toHaveLength(0);
    expect(game.bird.y).toBeCloseTo(GROUND_Y - game.bodyRadius, 0);
  });

  it("can't spike or pop the fish", () => {
    const game = calm();
    game.puffInput = 1;
    for (let i = 0; i < 60 * 10; i++) game.step(1 / 60);
    expect(game.spike.spiked).toBe(false);
    expect(game.phase).toBe("playing");
  });

  it("gives a fish on the sea floor a moment to swim off it once it ends", () => {
    const game = calm();
    game.puffInput = 0;
    for (let i = 0; i < 60 * 10; i++) game.step(1 / 60);
    expect(game.onSeaFloor).toBe(true);
    game.calmWater = false;
    for (let i = 0; i < 60 * 1; i++) game.step(1 / 60);
    expect(game.phase).toBe("playing");
    game.puffInput = 1;
    for (let i = 0; i < 60 * 3; i++) game.step(1 / 60);
    expect(game.phase).toBe("playing");
    expect(game.onSeaFloor).toBe(false);
    // Off the floor once, the floor kills again.
    game.puffInput = 0;
    for (let i = 0; i < 60 * 6 && game.phase === "playing"; i++) game.step(1 / 60);
    expect(game.phase).not.toBe("playing");
  });

  for (const [where, puff] of [["sea floor", 0], ["surface", 1]] as const) {
    it(`guides a fish from the ${where} to the middle, whatever the puff input`, () => {
      const game = calm();
      game.puffInput = puff;
      for (let i = 0; i < 60 * 10; i++) game.step(1 / 60);
      game.guideY = OCEAN_MID_Y;
      for (let i = 0; i < 60 * 4; i++) game.step(1 / 60);
      expect(Math.abs(game.bird.y - OCEAN_MID_Y)).toBeLessThan(15);
      expect(Math.abs(game.bird.vy)).toBeLessThan(25);
    });
  }

  it("brings the first obstacle a full delay after it ends", () => {
    const game = calm();
    game.puffInput = 0.4;
    for (let i = 0; i < 60 * 10; i++) game.step(1 / 60);
    game.calmWater = false;
    const from = game.distance;
    for (let i = 0; i < 60 * 30 && game.obstacles.length === 0; i++) game.step(1 / 60);
    expect(game.obstacles.length).toBeGreaterThan(0);
    expect(game.distance - from).toBeGreaterThan(400);
  });
});

describe("calm city", () => {
  it("spawns no obstacles and bounces the bird off the street, while cars still come", () => {
    const game = new Game(1000);
    game.calmCity = true;
    for (let i = 0; i < 60 * 30; i++) game.step(1 / 60);
    expect(game.phase).toBe("playing");
    expect(game.obstacles).toHaveLength(0);
    expect(game.bird.y).toBeLessThan(GROUND_Y - BIRD_RADIUS);
    game.spawnCarNow();
    expect(game.targets.some((t) => t.kind === "car")).toBe(true);
  });

  it("brings the first obstacle a full delay after it ends", () => {
    const game = new Game(1000);
    game.calmCity = true;
    for (let i = 0; i < 60 * 10; i++) game.step(1 / 60);
    game.calmCity = false;
    const from = game.distance;
    for (let i = 0; i < 60 * 30 && game.obstacles.length === 0; i++) {
      // Held in the air: without calm, the street would end the run.
      Object.assign(game.bird, { y: 240, vy: 0 });
      game.step(1 / 60);
    }
    expect(game.obstacles.length).toBeGreaterThan(0);
    expect(game.distance - from).toBeGreaterThan(config.firstObstacleDelay - 50);
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
      expect(game.cityStage).toBe(2);
      expect(game.overWater(game.bird.x)).toBe(false);
      expect(game.bird.y + BIRD_RADIUS).toBeLessThan(GROUND_Y - 100);
    });
  }
});

describe("anchored boats", () => {
  const saved = { chance: config.oceanAnchorChance, open: config.oceanAnchorOpenChance, jelly: config.oceanJellyRate };
  afterEach(() => {
    config.oceanAnchorChance = saved.chance;
    config.oceanAnchorOpenChance = saved.open;
    config.oceanJellyRate = saved.jelly;
  });

  for (const open of [false, true]) {
    it(`keep the gap clear ${open ? "over open water" : "over coral and rocks"}`, () => {
      config.oceanAnchorChance = 1;
      config.oceanAnchorOpenChance = open ? 1 : 0;
      const game = new Game(1000);
      const gap = ramp(config.oceanGap, config.oceanGapMin, game.difficulty);
      for (let i = 0; i < 200; i++) spawnOceanObstacle(game);
      // (stageObstacles stays 0 here, so none of them is the stage's last.)
      for (const o of game.obstacles) {
        expect(o.anchor).toBe(true);
        expect(o.bottom === "none").toBe(open);
        expect(o.gapBottom).toBeLessThanOrEqual(GROUND_Y);
        expect(o.gapBottom - o.gapTop).toBeGreaterThanOrEqual(gap - 1e-6);
        // The boat sits on the surface, and the anchor hangs below it, above the gap.
        expect(o.gapTop - SURFACE_Y).toBeGreaterThan(ANCHOR_H);
        const rects = obstacleRects(o);
        expect(Math.min(...rects.map((r) => r.y))).toBeLessThan(SURFACE_Y);
        for (const r of rects) expect(r.y + r.h <= o.gapTop + 1e-6 || r.y >= o.gapBottom - 1e-6).toBe(true);
      }
    });
  }

  it("stay away while a fisherman is out", () => {
    config.oceanAnchorChance = 1;
    const game = new Game(1000);
    spawnAngler(game);
    for (let i = 0; i < 50; i++) spawnOceanObstacle(game);
    expect(game.obstacles.some((o) => o.anchor)).toBe(false);
  });

  /** In the ocean, alone with an anchor over open water right at the fish, which hovers at `y`. */
  function underBoat(y: number): Game {
    config.oceanJellyRate = 0;
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    const w = 70;
    game.obstacles = [{
      x: game.bird.x - w / 2, w, gapTop: 260, gapBottom: GROUND_Y, bottom: "none", color: "#000", seed: 1,
      passed: false, splats: [], tabloid: null, anchor: true, drop: null,
    }];
    Object.assign(game.bird, { y, vy: 0 });
    game.puffInput = config.oceanHoverPuff;
    return game;
  }

  it("stop a fish hugging the surface", () => {
    const game = underBoat(SURFACE_Y);
    game.step(1 / 60);
    expect(game.phase).not.toBe("playing");
  });

  it("let a fish swim under the anchor", () => {
    const game = underBoat(380);
    for (let i = 0; i < 30; i++) game.step(1 / 60);
    expect(game.phase).toBe("playing");
  });
});

describe("dropping anchors", () => {
  const saved = { open: config.oceanAnchorOpenChance, jelly: config.oceanJellyRate };
  afterEach(() => {
    config.oceanAnchorOpenChance = saved.open;
    config.oceanJellyRate = saved.jelly;
  });

  for (const open of [false, true]) {
    it(`come to rest ${open ? "on the sea floor" : "on the coral or rock"}, leaving a gap above them`, () => {
      config.oceanAnchorOpenChance = open ? 1 : 0;
      const game = new Game(1000);
      const gap = ramp(config.oceanGap, config.oceanGapMin, game.difficulty);
      const hullBottom = SURFACE_Y + BOAT_DRAFT;
      for (let i = 0; i < 200; i++) spawnOceanObstacle(game, true);
      for (const o of game.obstacles) {
        const d = o.drop!;
        expect(d.state).toBe("hanging");
        expect(open ? o.bottom === "none" : o.bottom === "coral" || o.bottom === "rock").toBe(true);
        expect(d.to).toBe(open ? GROUND_Y + 6 : o.gapBottom);
        // Hanging, it's like any anchor: the gap is below it.
        for (const r of obstacleRects(o)) expect(r.y + r.h <= o.gapTop + 1e-6 || r.y >= o.gapBottom - 1e-6).toBe(true);
        // Down, the chain has ripped: the way through is between the stub on the hull and the anchor.
        const above = d.to - ANCHOR_H;
        Object.assign(d, { state: "down", y: d.to, chain: above });
        expect(above - ANCHOR_RIP_Y).toBeGreaterThanOrEqual(gap);
        const rects = obstacleRects(o);
        for (const r of rects) expect(r.y + r.h <= ANCHOR_RIP_Y + 1e-6 || r.y >= above - 1e-6).toBe(true);
        // The stub is still a hit.
        expect(rects.some((r) => r.y <= hullBottom && r.y + r.h >= ANCHOR_RIP_Y - 1e-6 && r.w < 20)).toBe(true);
      }
    });
  }

  it("rip the chain, which is still a hit as it falls with the anchor", () => {
    const game = new Game(1000);
    spawnOceanObstacle(game, true);
    const o = game.obstacles[0];
    const d = o.drop!;
    // Hanging, the chain runs from the hull to the anchor.
    const chain = (rects: ReturnType<typeof obstacleRects>) => rects.filter((r) => r.w === 10);
    expect(chain(obstacleRects(o))).toHaveLength(1);
    expect(chain(obstacleRects(o))[0].y).toBe(SURFACE_Y + BOAT_DRAFT);
    // Falling: the stub, and the torn-off piece from its top end down to the anchor.
    Object.assign(d, { state: "falling", y: o.gapTop + 40, chain: ANCHOR_RIP_Y + 40 });
    const pieces = chain(obstacleRects(o)).sort((a, b) => a.y - b.y);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].y + pieces[0].h).toBe(ANCHOR_RIP_Y);
    expect(pieces[1].y).toBe(ANCHOR_RIP_Y + 40);
    expect(pieces[1].y + pieces[1].h).toBe(d.y - 12);
  });

  /** In the ocean, alone with a boat far ahead that will drop its anchor (over open water); the fish hovers at `y`. */
  function towardDrop(y: number): { game: Game; o: Obstacle } {
    config.oceanJellyRate = 0;
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    const w = 70;
    const o: Obstacle = {
      x: game.width - 160, w, gapTop: 260, gapBottom: GROUND_Y, bottom: "none", color: "#000", seed: 1,
      passed: false, splats: [], tabloid: null, anchor: true, drop: { state: "hanging", t: 0, y: 260, to: GROUND_Y + 6, chain: ANCHOR_RIP_Y },
    };
    game.obstacles = [o];
    Object.assign(game.bird, { y, vy: 0 });
    game.puffInput = config.oceanHoverPuff;
    return { game, o };
  }

  /** Steps until the anchor is behind the fish; returns the drop states seen and the one as the fish reached it. */
  function swimPast(game: Game, o: Obstacle): { seen: Set<string>; onArrival: string | undefined } {
    const seen = new Set<string>();
    let onArrival: string | undefined;
    for (let i = 0; i < 60 * 10 && game.phase === "playing" && o.x + o.w > game.bird.x - 60; i++) {
      game.step(1 / 60);
      game.obstacles = game.obstacles.filter((x) => x === o);
      game.angler = null;
      seen.add(o.drop!.state);
      if (onArrival === undefined && o.x + o.w / 2 - ANCHOR_W / 2 <= game.bird.x + game.hitRadius) onArrival = o.drop!.state;
    }
    return { seen, onArrival };
  }

  it("warn, fall, and are down before the fish gets there", () => {
    // Where the anchor hung: it would hit the fish, but it's gone by the time the fish arrives.
    const { game, o } = towardDrop(230);
    const { seen, onArrival } = swimPast(game, o);
    expect([...seen]).toEqual(expect.arrayContaining(["warning", "falling", "down"]));
    expect(onArrival).toBe("down");
    expect(game.phase).toBe("playing");
  });

  it("block the way under them once they're down", () => {
    const { game, o } = towardDrop(455);
    swimPast(game, o);
    expect(game.phase).not.toBe("playing");
  });
});

describe("shipwrecks", () => {
  const saved = { wreck: config.oceanWreckChance, anchor: config.oceanAnchorChance };
  afterEach(() => {
    config.oceanWreckChance = saved.wreck;
    config.oceanAnchorChance = saved.anchor;
  });

  for (const anchor of [0, 1]) {
    it(`stay low, with only a short mast above the hull${anchor ? " (under an anchor)" : ""}`, () => {
      config.oceanWreckChance = 1;
      config.oceanAnchorChance = anchor;
      // The anchor tests above cover anchors over open water.
      const open = config.oceanAnchorOpenChance;
      config.oceanAnchorOpenChance = 0;
      const game = new Game(1000);
      const gap = ramp(config.oceanGap, config.oceanGapMin, game.difficulty);
      for (let i = 0; i < 200; i++) spawnOceanObstacle(game);
      config.oceanAnchorOpenChance = open;
      for (const o of game.obstacles) {
        expect(o.bottom).toBe("wreck");
        expect(o.gapBottom - o.gapTop).toBeGreaterThanOrEqual(gap - 1e-6);
        const deck = GROUND_Y - WRECK_HULL_H;
        const mast = deck - o.gapBottom;
        expect(mast).toBeGreaterThanOrEqual(WRECK_MAST_MIN - 1e-6);
        expect(mast).toBeLessThanOrEqual(WRECK_MAST_MAX + 1e-6);
        for (const r of obstacleRects(o)) expect(r.y + r.h <= o.gapTop + 1e-6 || r.y >= o.gapBottom - 1e-6).toBe(true);
      }
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

describe("sharks", () => {
  const saved = { jelly: config.oceanJellyRate, angler: config.anglerChance };
  afterEach(() => {
    config.oceanJellyRate = saved.jelly;
    config.anglerChance = saved.angler;
  });

  /** In the ocean, alone with a shark that just swam in; the fish hovers at y 300. */
  function sharkAttack(): Game {
    config.oceanJellyRate = 0;
    config.anglerChance = 0;
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    game.obstacles = [];
    game.nextObstacleAt = Infinity;
    Object.assign(game.bird, { y: 300, vy: 0 });
    game.puffInput = config.oceanHoverPuff;
    game.spawnSharkNow();
    expect(game.sharkTheme).toBe(0);
    // Its music plays a while before it shows up.
    for (let i = 0; i < 60 * 20 && !game.shark; i++) game.step(1 / 60);
    expect(game.shark?.state).toBe("stalking");
    return game;
  }

  /** Steps until the shark winds up, then feeds `puff` until it's done with the fish (or 6 s pass). */
  function waitAndPuff(game: Game, puff: number): void {
    for (let i = 0; i < 60 * 10 && game.shark?.state === "stalking"; i++) game.step(1 / 60);
    expect(game.shark?.state).toBe("windup");
    game.puffInput = puff;
    for (let i = 0; i < 60 * 6 && game.phase === "playing" && game.shark?.state !== "fleeing"; i++) game.step(1 / 60);
  }

  for (const width of [1000, 1400]) {
    it(`lunges on the music's cue (${width} px wide)`, () => {
      const game = sharkAttack();
      game.resize(width);
      for (let i = 0; i < 60 * 20 && game.shark?.state !== "lunge"; i++) game.step(1 / 60);
      expect(game.shark?.state).toBe("lunge");
      expect(game.sharkTheme!).toBeCloseTo(config.sharkThemeAttack, 1);
    });
  }

  it("spawns no obstacles in the last seconds before it swims in", () => {
    config.oceanJellyRate = 0;
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    game.obstacles = [];
    game.puffInput = config.oceanHoverPuff;
    game.spawnSharkNow();
    const spawnAt = config.sharkThemeAttack - config.sharkWindup - config.sharkStalkTime;
    let late = 0;
    for (let i = 0; i < 60 * 20 && !game.shark; i++) {
      // One obstacle falls due inside the clear window.
      if (game.sharkTheme! > spawnAt - 3 && game.sharkTheme! < spawnAt - 3 + 1 / 30) game.nextObstacleAt = game.distance;
      const before = game.obstacles.length;
      game.step(1 / 60);
      if (game.obstacles.length > before && game.sharkTheme! > spawnAt - 3) late++;
      // Only the spawning is under test: wave the fish through the early ones.
      for (const o of game.obstacles) Object.assign(o, { gapTop: -1000, gapBottom: 2000, anchor: false, bottom: "none" });
    }
    expect(game.shark).not.toBeNull();
    expect(late).toBe(0);
  });

  it("stays away during the swim lesson, while the fish can't spike", () => {
    const game = atHarbour(80, 240, 0);
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    game.calmWater = true;
    game.spawnSharkNow();
    expect(game.sharkTheme).toBeNull();
  });

  it("eats a fish that isn't spiked", () => {
    const game = sharkAttack();
    waitAndPuff(game, config.oceanHoverPuff);
    expect(game.phase).not.toBe("playing");
    expect(game.eaten).toBe(true);
    expect(game.shark?.state).toBe("chomped");
  });

  it("can't be outswum: rising just short of spiking still gets you eaten", () => {
    const game = sharkAttack();
    waitAndPuff(game, config.oceanSpikeThreshold - 0.02);
    expect(game.eaten).toBe(true);
  });

  it("bites into the spines and flees from a spiked fish", () => {
    const game = sharkAttack();
    const bonus = game.bonus;
    waitAndPuff(game, 1);
    expect(game.phase).toBe("playing");
    expect(game.eaten).toBe(false);
    expect(game.shark?.state).toBe("fleeing");
    expect(game.sharksSpiked).toBe(1);
    expect(game.sharkTheme).toBeNull(); // its music stops at once
    expect(game.bonus).toBeGreaterThan(bonus);
  });
});

describe("a shark and a fisherman in one ocean stage", () => {
  const saved = { jelly: config.oceanJellyRate, angler: config.anglerChance, shark: config.sharkChance };
  afterEach(() => {
    config.oceanJellyRate = saved.jelly;
    config.anglerChance = saved.angler;
    config.sharkChance = saved.shark;
  });

  it("brings the fisherman first, then the shark, then the far quay", () => {
    config.oceanJellyRate = 0;
    config.anglerChance = 1;
    config.sharkChance = 1;
    const game = atHarbour(80, 240, 0);
    // Only the order is under test: nothing kills the fish.
    (game as unknown as { crash: () => void }).crash = () => {};
    for (let i = 0; i < 60 * 12 && (game.stage === "city" || game.transition); i++) game.step(1 / 60);
    expect(game.stage).toBe("ocean");
    game.puffInput = config.oceanHoverPuff;
    const seen: string[] = [];
    const note = (what: string): void => {
      if (seen.at(-1) !== what) seen.push(what);
    };
    for (let i = 0; i < 60 * 240 && game.shore?.kind !== "exit"; i++) {
      game.step(1 / 60);
      Object.assign(game.bird, { y: 300, vy: 0 });
      // Keep his hook up by the surface, clear of the fish.
      if (game.angler) game.angler.hookY = game.angler.target = SURFACE_Y + 10;
      if (game.angler && game.angler.state !== "leaving") note("fisherman");
      if (game.sharkTheme !== null) {
        expect(game.angler === null || game.angler.state === "leaving").toBe(true);
        note("shark");
      }
    }
    expect(game.shore?.kind).toBe("exit");
    expect(game.shark).toBeNull();
    expect(seen).toEqual(["fisherman", "shark"]);
  });
});

describe("practice perch", () => {
  /** Strains for `strainS`, then relaxes for `relaxS`, on the perch. */
  function practise(game: Game, strainS: number, relaxS: number): void {
    game.straining = true;
    for (let t = 0; t < strainS; t += 1 / 120) game.stepPerch(1 / 120);
    game.straining = false;
    for (let t = 0; t < relaxS; t += 1 / 120) game.stepPerch(1 / 120);
  }

  it("hops off the lamp and lands back on it", () => {
    const game = new Game(1000);
    game.perch();
    practise(game, 0.8, 3);
    expect(game.events.some((e) => e.type === "release")).toBe(true);
    expect(game.bird.y).toBe(PERCH_Y);
    expect(game.phase).toBe("playing");
    expect(game.speed).toBe(0);
  });

  it("survives an accident, and the practice doesn't count once the run starts", () => {
    const game = new Game(1000);
    game.perch();
    practise(game, 4, 3);
    expect(game.accidents).toBe(1);
    expect(game.phase).toBe("playing");
    game.leavePerch();
    expect(game.score).toBe(0);
    expect(game.accidents).toBe(0);
    expect(game.targetsHit).toBe(0);
  });

  it("leaves the lamp behind once the run scrolls", () => {
    const game = new Game(1000);
    game.perch();
    game.leavePerch();
    for (let i = 0; i < 60 * 3; i++) game.step(1 / 60);
    expect(game.perchX === null || game.perchX < game.bird.x - 100).toBe(true);
  });
});

describe("practice perch on a resize", () => {
  it("keeps the lamp under the bird when the screen widens", () => {
    const game = new Game(600);
    game.perch();
    game.resize(1400);
    expect(game.perchX).toBe(game.bird.x);
  });
});
