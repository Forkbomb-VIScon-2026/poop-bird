// Charge → release → overstrain state machine. Pure: feed it "is the player
// straining?" and dt each physics step, get back the new state plus events.

export interface ChargeParams {
  chargeTime: number;
  overstrainTime: number;
  sweetSpotWindow: number;
  sweetSpotMultiplier: number;
  stunTime: number;
  pushMin: number;
  pushMax: number;
  pushCurve: number;
}

export interface ChargeState {
  /** 0..1 */
  charge: number;
  /** Seconds spent at full charge in the current strain. */
  fullHold: number;
  /** Seconds of stun left after an accident (0 = not stunned). */
  stun: number;
  /** After an accident the player must stop straining before charging again. */
  needsRelease: boolean;
}

export type ChargeEvent =
  | { type: "release"; charge: number; push: number; sweetSpot: boolean }
  | { type: "accident"; charge: number };

export interface ChargeStep {
  state: ChargeState;
  event: ChargeEvent | null;
}

export function initialChargeState(): ChargeState {
  return { charge: 0, fullHold: 0, stun: 0, needsRelease: false };
}

/** Upward speed for a release at the given charge (before any sweet-spot bonus). */
export function pushForCharge(charge: number, p: Pick<ChargeParams, "pushMin" | "pushMax" | "pushCurve">): number {
  const c = Math.min(1, Math.max(0, charge));
  return p.pushMin + (p.pushMax - p.pushMin) * Math.pow(c, p.pushCurve);
}

/** True while holding at full charge inside the bonus window right before an accident. */
export function inSweetSpot(state: ChargeState, p: Pick<ChargeParams, "overstrainTime" | "sweetSpotWindow">): boolean {
  if (state.charge < 1 || p.sweetSpotWindow <= 0) return false;
  return state.fullHold >= p.overstrainTime - p.sweetSpotWindow && state.fullHold <= p.overstrainTime;
}

export function stepCharge(state: ChargeState, straining: boolean, dt: number, p: ChargeParams): ChargeStep {
  // Stunned: ignore input until the stun wears off.
  if (state.stun > 0) {
    const stun = Math.max(0, state.stun - dt);
    return { state: { ...state, stun, needsRelease: state.needsRelease || straining }, event: null };
  }

  if (state.needsRelease) {
    return { state: { ...state, needsRelease: straining }, event: null };
  }

  if (straining) {
    const charge = Math.min(1, state.charge + dt / Math.max(1e-3, p.chargeTime));
    // Time that "overflowed" past full charge in this step counts as holding.
    let fullHold = state.fullHold;
    if (charge >= 1) {
      const overflow = state.charge >= 1 ? dt : Math.max(0, dt - (1 - state.charge) * p.chargeTime);
      fullHold += overflow;
    }
    if (fullHold > p.overstrainTime) {
      return {
        state: { charge: 0, fullHold: 0, stun: p.stunTime, needsRelease: true },
        event: { type: "accident", charge },
      };
    }
    return { state: { ...state, charge, fullHold }, event: null };
  }

  // Not straining: release whatever we had.
  if (state.charge > 0) {
    const sweetSpot = inSweetSpot(state, p);
    const push = pushForCharge(state.charge, p) * (sweetSpot ? p.sweetSpotMultiplier : 1);
    return {
      state: { ...state, charge: 0, fullHold: 0 },
      event: { type: "release", charge: state.charge, push, sweetSpot },
    };
  }
  return { state, event: null };
}
