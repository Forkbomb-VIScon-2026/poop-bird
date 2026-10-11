// Pufferfish physics helpers and the spike-out → pop state machine. Pure,
// like charge.ts: feed it the puff level and dt each physics step, get back
// the new state plus events.
//
// Buoyancy: puff 0 sinks at maxSink, puff = hover hovers, puff 1 rises at
// maxRise (piecewise linear through the hover point). The actual velocity
// eases toward that target with water drag.

import { clamp } from "./strain";

export interface BuoyancyParams {
  oceanMaxSink: number;
  oceanMaxRise: number;
  oceanHoverPuff: number;
}

/** Target vertical velocity in px/s for a puff level (screen space: + = sinking). */
export function targetSwimVelocity(puff: number, p: BuoyancyParams): number {
  const x = clamp(puff, 0, 1);
  const hover = clamp(p.oceanHoverPuff, 0.01, 0.99);
  if (x <= hover) return p.oceanMaxSink * (1 - x / hover);
  return -p.oceanMaxRise * ((x - hover) / (1 - hover));
}

/** The puff whose target velocity is `vy` (the inverse of targetSwimVelocity, clamped to what puff 0..1 can do). */
export function puffForSwimVelocity(vy: number, p: BuoyancyParams): number {
  const hover = clamp(p.oceanHoverPuff, 0.01, 0.99);
  if (vy >= 0) return hover * (1 - clamp(vy / Math.max(1e-6, p.oceanMaxSink), 0, 1));
  return hover + (1 - hover) * clamp(-vy / Math.max(1e-6, p.oceanMaxRise), 0, 1);
}

/** The puff that swims a fish at `y` to `targetY`, closing the distance in about `time` s (at most at full speed). */
export function guidePuff(y: number, targetY: number, time: number, p: BuoyancyParams): number {
  return puffForSwimVelocity((targetY - y) / Math.max(0.05, time), p);
}

/**
 * Eases `vy` toward `target` with an exponential response: after `dragTime`
 * seconds ~63% of the difference is gone, independent of the step size.
 */
export function applyWaterDrag(vy: number, target: number, dt: number, dragTime: number): number {
  if (dragTime <= 0) return target;
  return target + (vy - target) * Math.exp(-Math.max(0, dt) / dragTime);
}

/** Hitbox (and drawn size) multiplier: lerp from `min` at puff 0 to `max` at puff 1. */
export function puffScale(puff: number, min: number, max: number): number {
  return min + (max - min) * clamp(puff, 0, 1);
}

// --- Spike-out & pop ------------------------------------------------------------

export interface SpikeParams {
  oceanSpikeThreshold: number;
  /** Spikes retract below threshold − release, so a noisy puff doesn't flicker. */
  oceanSpikeRelease: number;
  oceanSpikeMaxHold: number;
  oceanPopWarnTime: number;
  stunTime: number;
}

export interface SpikeState {
  spiked: boolean;
  /** Seconds spent spiked in the current spike. */
  hold: number;
  /** Seconds of stun left after a pop (0 = not stunned). */
  stun: number;
  /** After a pop the player must deflate below the threshold before spiking again. */
  needsDeflate: boolean;
}

export type SpikeEvent = { type: "spike" } | { type: "unspike" } | { type: "pop" };

export interface SpikeStep {
  state: SpikeState;
  event: SpikeEvent | null;
}

export function initialSpikeState(): SpikeState {
  return { spiked: false, hold: 0, stun: 0, needsDeflate: false };
}

/** Fraction (0..1) of the max spiked time used up. */
export function popProgress(state: SpikeState, p: Pick<SpikeParams, "oceanSpikeMaxHold">): number {
  if (!state.spiked) return 0;
  return clamp(state.hold / Math.max(1e-3, p.oceanSpikeMaxHold), 0, 1);
}

/** True in the last `oceanPopWarnTime` seconds before a pop. */
export function popWarning(state: SpikeState, p: Pick<SpikeParams, "oceanSpikeMaxHold" | "oceanPopWarnTime">): boolean {
  if (!state.spiked || p.oceanPopWarnTime <= 0) return false;
  return state.hold >= p.oceanSpikeMaxHold - p.oceanPopWarnTime;
}

export function stepSpike(state: SpikeState, puff: number, dt: number, p: SpikeParams): SpikeStep {
  const offLevel = p.oceanSpikeThreshold - Math.max(0, p.oceanSpikeRelease);

  // Stunned: no spikes, input ignored until the stun wears off.
  if (state.stun > 0) {
    const stun = Math.max(0, state.stun - dt);
    return { state: { ...state, stun, needsDeflate: state.needsDeflate || puff >= offLevel }, event: null };
  }

  if (state.needsDeflate) {
    return { state: { ...state, needsDeflate: puff >= offLevel }, event: null };
  }

  if (state.spiked) {
    if (puff < offLevel) return { state: { ...state, spiked: false, hold: 0 }, event: { type: "unspike" } };
    const hold = state.hold + dt;
    if (hold > p.oceanSpikeMaxHold) {
      return { state: { spiked: false, hold: 0, stun: p.stunTime, needsDeflate: true }, event: { type: "pop" } };
    }
    return { state: { ...state, hold }, event: null };
  }

  if (puff >= p.oceanSpikeThreshold) return { state: { ...state, spiked: true, hold: 0 }, event: { type: "spike" } };
  return { state, event: null };
}
