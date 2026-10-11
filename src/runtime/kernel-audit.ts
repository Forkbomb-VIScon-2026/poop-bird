/** Debug-only differential checking: one WASM call for every recorded frame. */
import type { ChargeParams, ChargeState, ChargeStep } from "../charge";
import type { SpikeParams, SpikeState, SpikeStep } from "../swim";
import { popProgress, popWarning } from "../swim";
import { BIRD_RADIUS, type Game } from "../game";
import type { config } from "../config";
import type * as Wasm from "../../public/game-wasm/poop_bird_wasm";

declare const __APP_COMMIT__: string;

type Module = typeof Wasm;
export interface KernelObserver {
  charge(before: ChargeState, straining: boolean, dt: number, params: ChargeParams, result: ChargeStep): void;
  spike(before: SpikeState, puff: number, dt: number, params: SpikeParams, result: SpikeStep): void;
  bird(before: Readonly<Game["bird"]>, charge: number, stunned: boolean,
    phase: Game["phase"], stageTime: number, dt: number, params: typeof config): void;
  birdResult(after: Readonly<Game["bird"]>): void;
}
const CHARGE_KEYS = ["chargeTime", "overstrainTime", "sweetSpotWindow", "sweetSpotMultiplier", "stunTime", "pushMin", "pushMax", "pushCurve"] as const;
const SPIKE_KEYS = ["oceanSpikeThreshold", "oceanSpikeRelease", "oceanSpikeMaxHold", "oceanPopWarnTime", "stunTime"] as const;
const BIRD_KEYS = ["y", "vy", "rot", "stretch", "stretchV", "relief", "flap"] as const;

export class KernelAudit implements KernelObserver {
  private input = new Float64Array(24 * 16);
  private expected = new Float64Array(8 * 16);
  private count = 0;
  private batches = 0;
  private cases = 0;
  private maxError = 0;
  private birdOutput = -1;
  private readonly evaluate: Module["evaluate_batch"];

  constructor(evaluate: Module["evaluate_batch"]) { this.evaluate = evaluate; }
  get stats() { return { batches: this.batches, cases: this.cases, maxError: this.maxError }; }

  private slot(): [number, number] {
    if ((this.count + 1) * 24 > this.input.length) {
      const input = new Float64Array(this.input.length * 2);
      input.set(this.input); this.input = input;
      const expected = new Float64Array(this.expected.length * 2);
      expected.set(this.expected); this.expected = expected;
    }
    return [this.count * 24, this.count++ * 8];
  }

  charge(before: ChargeState, held: boolean, dt: number, p: ChargeParams, r: ChargeStep): void {
    const [i, o] = this.slot();
    this.input.set([0, before.charge, before.fullHold, before.stun, +before.needsRelease, +held, dt], i);
    CHARGE_KEYS.forEach((key, n) => { this.input[i + 7 + n] = p[key]; });
    const s = r.state; const e = r.event;
    this.expected.set([s.charge, s.fullHold, s.stun, +s.needsRelease,
      e?.type === "release" ? 1 : e ? 2 : 0, e?.charge ?? 0,
      e?.type === "release" ? e.push : 0, +(e?.type === "release" && e.sweetSpot)], o);
  }

  spike(before: SpikeState, puff: number, dt: number, p: SpikeParams, r: SpikeStep): void {
    const [i, o] = this.slot();
    this.input.set([1, +before.spiked, before.hold, before.stun, +before.needsDeflate, puff, dt], i);
    SPIKE_KEYS.forEach((key, n) => { this.input[i + 7 + n] = p[key]; });
    const s = r.state; const e = r.event;
    this.expected.set([+s.spiked, s.hold, s.stun, +s.needsDeflate,
      e?.type === "spike" ? 1 : e?.type === "unspike" ? 2 : e ? 3 : 0,
      popProgress(s, p), +popWarning(s, p), 0], o);
  }

  bird(before: Readonly<Game["bird"]>, charge: number, stunned: boolean,
    phase: Game["phase"], stageTime: number, dt: number, p: typeof config): void {
    const [i, o] = this.slot();
    this.birdOutput = o;
    this.input.set([5, ...BIRD_KEYS.map(key => before[key]), charge, +stunned,
      phase === "playing" ? 0 : phase === "dying" ? 1 : 2, stageTime, dt,
      p.gravity, p.startGrace, p.chargeGravityScale, p.maxFallSpeed, p.chargeMaxFallSpeed, BIRD_RADIUS], i);
  }

  birdResult(after: Readonly<Game["bird"]>): void {
    if (this.birdOutput < 0) throw new Error("Bird output without input");
    this.expected.set([...BIRD_KEYS.map(key => after[key]), 0], this.birdOutput);
    this.birdOutput = -1;
  }

  flush(): void {
    if (this.count === 0) return;
    const actual = this.evaluate(this.input.subarray(0, this.count * 24));
    if (actual.length !== this.count * 8) throw new Error("Rust kernel output length mismatch");
    for (let n = 0; n < actual.length; n++) {
      const expected = this.expected[n];
      const error = Math.abs(actual[n] - expected);
      if (!Number.isFinite(actual[n]) || error > 1e-12 * Math.max(1, Math.abs(expected))) {
        throw new Error(`Rust kernel mismatch: record ${Math.floor(n / 8)}, field ${n % 8}: ${actual[n]} != ${expected}`);
      }
      this.maxError = Math.max(this.maxError, error);
    }
    this.batches++; this.cases += this.count; this.count = 0;
    // Clear padding that may have held fields from a different operation.
    this.input.fill(0);
  }
}

export async function loadKernelAudit(): Promise<KernelAudit> {
  // An absolute URL keeps Vite from rewriting this public module as a source import.
  const url = new URL(`${import.meta.env.BASE_URL}game-wasm/poop_bird_wasm.js?v=${__APP_COMMIT__}`, location.href).href;
  const module: Module = await import(/* @vite-ignore */ url);
  await module.default();
  if (module.protocol_version() !== 2) throw new Error("Unsupported Rust kernel protocol");
  return new KernelAudit(module.evaluate_batch);
}
