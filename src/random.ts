// Randomness shared by the simulation, the renderer and the UI.

/** A random item of `items` (Math.random). */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
