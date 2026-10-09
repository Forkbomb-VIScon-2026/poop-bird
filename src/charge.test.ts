import { describe, expect, it } from "vitest";
import {
  initialChargeState,
  inSweetSpot,
  pushForCharge,
  stepCharge,
  type ChargeEvent,
  type ChargeParams,
  type ChargeState,
} from "./charge";

const P: ChargeParams = {
  chargeTime: 1.2,
  overstrainTime: 1.0,
  sweetSpotWindow: 0.3,
  sweetSpotMultiplier: 1.5,
  stunTime: 1.0,
  pushMin: 100,
  pushMax: 600,
  pushCurve: 1,
};

const DT = 1 / 120;

/** Runs `seconds` of constant input, returning the final state and all events. */
function run(state: ChargeState, straining: boolean, seconds: number, p = P) {
  const events: ChargeEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = stepCharge(state, straining, DT, p);
    state = r.state;
    if (r.event) events.push(r.event);
  }
  return { state, events };
}

describe("pushForCharge", () => {
  it("gives a small pfft at zero charge and full push at full charge", () => {
    expect(pushForCharge(0, P)).toBe(100);
    expect(pushForCharge(1, P)).toBe(600);
    expect(pushForCharge(0.5, P)).toBe(350);
  });

  it("clamps out-of-range charge", () => {
    expect(pushForCharge(2, P)).toBe(600);
    expect(pushForCharge(-1, P)).toBe(100);
  });

  it("applies the curve exponent", () => {
    expect(pushForCharge(0.25, { ...P, pushCurve: 0.5 })).toBeCloseTo(100 + 500 * 0.5);
  });
});

describe("stepCharge: charging", () => {
  it("fills over chargeTime", () => {
    const half = run(initialChargeState(), true, 0.6).state;
    expect(half.charge).toBeCloseTo(0.5, 2);
    const full = run(initialChargeState(), true, 1.2).state;
    expect(full.charge).toBeCloseTo(1, 2);
  });

  it("does nothing without input", () => {
    const r = run(initialChargeState(), false, 1);
    expect(r.state.charge).toBe(0);
    expect(r.events).toHaveLength(0);
  });
});

describe("stepCharge: release", () => {
  it("releases with a push that scales with charge", () => {
    const small = run(run(initialChargeState(), true, 0.12).state, false, DT).events;
    const big = run(run(initialChargeState(), true, 0.9).state, false, DT).events;
    expect(small).toHaveLength(1);
    expect(big).toHaveLength(1);
    const s = small[0];
    const b = big[0];
    if (s.type !== "release" || b.type !== "release") throw new Error("expected releases");
    expect(s.push).toBeGreaterThan(P.pushMin);
    expect(b.push).toBeGreaterThan(s.push);
    expect(b.charge).toBeCloseTo(0.75, 1);
  });

  it("a single frame of strain still gives a tiny pfft", () => {
    const r = stepCharge(stepCharge(initialChargeState(), true, DT, P).state, false, DT, P);
    expect(r.event?.type).toBe("release");
    if (r.event?.type === "release") expect(r.event.push).toBeCloseTo(P.pushMin, -1);
  });

  it("resets the charge after releasing", () => {
    const r = run(run(initialChargeState(), true, 0.5).state, false, DT);
    expect(r.state.charge).toBe(0);
    expect(r.state.fullHold).toBe(0);
  });
});

describe("stepCharge: overstrain", () => {
  it("causes an accident after holding full charge longer than overstrainTime", () => {
    const r = run(initialChargeState(), true, 1.2 + 1.0 + 0.05);
    expect(r.events.map((e) => e.type)).toEqual(["accident"]);
    expect(r.state.charge).toBe(0);
    expect(r.state.stun).toBeGreaterThan(0);
  });

  it("does not cause an accident just before the limit", () => {
    const r = run(initialChargeState(), true, 1.2 + 0.95);
    expect(r.events).toHaveLength(0);
    expect(r.state.charge).toBe(1);
  });

  it("pays a sweet-spot bonus when released right before the accident", () => {
    const early = run(run(initialChargeState(), true, 1.2 + 0.2).state, false, DT).events[0];
    const sweet = run(run(initialChargeState(), true, 1.2 + 0.85).state, false, DT).events[0];
    if (early.type !== "release" || sweet.type !== "release") throw new Error("expected releases");
    expect(early.sweetSpot).toBe(false);
    expect(sweet.sweetSpot).toBe(true);
    expect(sweet.push).toBeCloseTo(P.pushMax * P.sweetSpotMultiplier);
    expect(early.push).toBeCloseTo(P.pushMax);
  });

  it("reports the sweet spot window", () => {
    expect(inSweetSpot({ charge: 1, fullHold: 0.5, stun: 0, needsRelease: false }, P)).toBe(false);
    expect(inSweetSpot({ charge: 1, fullHold: 0.75, stun: 0, needsRelease: false }, P)).toBe(true);
    expect(inSweetSpot({ charge: 0.9, fullHold: 0.75, stun: 0, needsRelease: false }, P)).toBe(false);
  });

  it("ignores input while stunned and gives no push", () => {
    const accident = run(initialChargeState(), true, 2.3).state;
    const r = run(accident, false, 0.5);
    expect(r.events).toHaveLength(0);
    // Accident hit at ~2.2 s, so 0.1 s of the 1 s stun had already passed.
    expect(r.state.stun).toBeCloseTo(0.4, 1);
  });

  it("requires releasing the strain after the stun before charging again", () => {
    const accident = run(initialChargeState(), true, 2.3).state;
    const held = run(accident, true, 1.5); // stun ends while still straining
    expect(held.state.stun).toBe(0);
    expect(held.state.charge).toBe(0);
    expect(held.events).toHaveLength(0);
    const released = run(held.state, false, DT).state;
    const charging = run(released, true, 0.6).state;
    expect(charging.charge).toBeGreaterThan(0.4);
  });
});
