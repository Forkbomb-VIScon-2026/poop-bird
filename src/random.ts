// Randomness shared by the simulation, the renderer and the UI.

/** A random item of `items` (Math.random). */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Deterministic pseudo-random in [0,1) from a seed (the drawing code's stable variety). */
export function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
