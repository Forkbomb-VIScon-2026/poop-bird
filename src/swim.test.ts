import { describe, expect, it } from "vitest";
import {
  applyWaterDrag,
  initialSpikeState,
  popProgress,
  popWarning,
  puffScale,
  stepSpike,
  targetSwimVelocity,
  type SpikeEvent,
  type SpikeParams,
  type SpikeState,
} from "./swim";

const B = { oceanMaxSink: 150, oceanMaxRise: 120, oceanHoverPuff: 0.4 };

const P: SpikeParams = {
  oceanSpikeThreshold: 0.85,
  oceanSpikeRelease: 0.05,
  oceanSpikeMaxHold: 1.5,
  oceanPopWarnTime: 0.3,
  stunTime: 1.0,
};

const DT = 1 / 120;

/** Runs `seconds` of constant puff, returning the final state and all events. */
function run(state: SpikeState, puff: number, seconds: number, p = P) {
  const events: SpikeEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = stepSpike(state, puff, DT, p);
    state = r.state;
    if (r.event) events.push(r.event);
  }
  return { state, events };
}

describe("targetSwimVelocity", () => {
  it("sinks at max speed when deflated, hovers at the hover point, rises when fully puffed", () => {
    expect(targetSwimVelocity(0, B)).toBe(150);
    expect(targetSwimVelocity(0.4, B)).toBeCloseTo(0);
    expect(targetSwimVelocity(1, B)).toBeCloseTo(-120);
  });

  it("is piecewise linear through the hover point", () => {
    expect(targetSwimVelocity(0.2, B)).toBeCloseTo(75);
    expect(targetSwimVelocity(0.7, B)).toBeCloseTo(-60);
  });

  it("is monotonic (more puff never sinks faster)", () => {
    let prev = Infinity;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = targetSwimVelocity(x, B);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps out-of-range puff and survives extreme hover settings", () => {
    expect(targetSwimVelocity(-1, B)).toBe(150);
    expect(targetSwimVelocity(2, B)).toBeCloseTo(-120);
    expect(Number.isFinite(targetSwimVelocity(0.5, { ...B, oceanHoverPuff: 1 }))).toBe(true);
    expect(Number.isFinite(targetSwimVelocity(0.5, { ...B, oceanHoverPuff: 0 }))).toBe(true);
  });
});

describe("applyWaterDrag", () => {
  it("covers ~63% of the way to the target after one drag time", () => {
    expect(applyWaterDrag(0, 100, 0.35, 0.35)).toBeCloseTo(100 * (1 - Math.exp(-1)));
  });

  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 120; i++) a = applyWaterDrag(a, 100, 1 / 120, 0.35);
    let b = 0;
    for (let i = 0; i < 30; i++) b = applyWaterDrag(b, 100, 1 / 30, 0.35);
    expect(a).toBeCloseTo(b, 6);
  });

  it("never overshoots the target", () => {
    let v = -200;
    for (let i = 0; i < 600; i++) {
      v = applyWaterDrag(v, 50, 1 / 120, 0.35);
      expect(v).toBeLessThanOrEqual(50);
    }
    expect(v).toBeCloseTo(50, 1);
  });

  it("snaps when drag time is 0", () => {
    expect(applyWaterDrag(10, 99, 1 / 120, 0)).toBe(99);
  });
});

describe("puffScale", () => {
  it("lerps between the min and max multipliers", () => {
    expect(puffScale(0, 0.75, 1.6)).toBe(0.75);
    expect(puffScale(1, 0.75, 1.6)).toBeCloseTo(1.6);
    expect(puffScale(0.5, 0.75, 1.6)).toBeCloseTo(1.175);
    expect(puffScale(3, 0.75, 1.6)).toBeCloseTo(1.6);
  });
});

describe("stepSpike", () => {
  it("spikes out at the threshold and not below", () => {
    expect(run(initialSpikeState(), 0.84, 0.5).events).toHaveLength(0);
    const r = run(initialSpikeState(), 0.85, DT);
    expect(r.events).toEqual([{ type: "spike" }]);
    expect(r.state.spiked).toBe(true);
  });

  it("retracts below threshold − release, without flickering on a noisy puff", () => {
    let s = run(initialSpikeState(), 0.9, 0.1).state;
    const noisy = [0.84, 0.86, 0.82, 0.85, 0.81, 0.87];
    const events: SpikeEvent[] = [];
    for (const v of noisy) {
      const r = stepSpike(s, v, DT, P);
      s = r.state;
      if (r.event) events.push(r.event);
    }
    expect(events).toHaveLength(0);
    expect(s.spiked).toBe(true);
    const off = stepSpike(s, 0.79, DT, P);
    expect(off.event).toEqual({ type: "unspike" });
    expect(off.state.hold).toBe(0);
  });

  it("pops after being spiked longer than the max hold", () => {
    const r = run(initialSpikeState(), 1, 1.5 + 0.05);
    expect(r.events.map((e) => e.type)).toEqual(["spike", "pop"]);
    expect(r.state.spiked).toBe(false);
    expect(r.state.stun).toBeGreaterThan(0);
  });

  it("does not pop just before the limit", () => {
    const r = run(initialSpikeState(), 1, 1.45);
    expect(r.events.map((e) => e.type)).toEqual(["spike"]);
  });

  it("restarts the clock when the spikes retract", () => {
    let s = run(initialSpikeState(), 1, 1.2).state;
    s = run(s, 0.5, 0.1).state;
    const r = run(s, 1, 1.2);
    expect(r.events.map((e) => e.type)).toEqual(["spike"]);
  });

  it("warns in the last part before the pop", () => {
    const early = run(initialSpikeState(), 1, 1.0).state;
    const late = run(initialSpikeState(), 1, 1.3).state;
    expect(popWarning(early, P)).toBe(false);
    expect(popWarning(late, P)).toBe(true);
    expect(popWarning(initialSpikeState(), P)).toBe(false);
    expect(popProgress(late, P)).toBeCloseTo(1.3 / 1.5, 1);
  });

  it("ignores puff while stunned", () => {
    const popped = run(initialSpikeState(), 1, 1.6).state;
    const r = run(popped, 1, 0.5);
    expect(r.events).toHaveLength(0);
    expect(r.state.spiked).toBe(false);
  });

  it("requires deflating after the stun before spiking again", () => {
    const popped = run(initialSpikeState(), 1, 1.6).state;
    const held = run(popped, 1, 1.5); // stun ends while still puffed
    expect(held.state.stun).toBe(0);
    expect(held.events).toHaveLength(0);
    const deflated = run(held.state, 0.2, DT).state;
    expect(deflated.needsDeflate).toBe(false);
    expect(run(deflated, 1, DT).events).toEqual([{ type: "spike" }]);
  });
});
