/** Matches poop-bird-core::rng; explicit streams make replay tests reproducible. */
export class SeededRng {
  private seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; }
  readonly next = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };
}
