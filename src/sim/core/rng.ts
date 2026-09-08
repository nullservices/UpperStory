/**
 * Deterministic seeded RNG (mulberry32). The generator state lives in
 * GameState.rngState so save/replay restores the exact stream. ALL sim
 * randomness must flow through here — Math.random is banned in src/sim
 * (enforced by ESLint).
 */

const MULBERRY_A = 0x6d2b79f5;

/** Convert a user-facing seed into the initial generator state. */
export function seedRng(seed: number): number {
  return (seed >>> 0) || 0x9e3779b9;
}

/** Advance the generator; returns a float in [0, 1). */
export function rngNext(state: { rngState: number }): number {
  let t = (state.rngState += MULBERRY_A) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Float in [min, max). */
export function rngRange(state: { rngState: number }, min: number, max: number): number {
  return min + rngNext(state) * (max - min);
}

/** Integer in [min, max] inclusive. */
export function rngInt(state: { rngState: number }, min: number, max: number): number {
  const span = max - min + 1;
  if (span <= 0) return min;
  return min + Math.floor(rngNext(state) * span);
}

/** Uniform pick from a non-empty array. */
export function rngPick<T>(state: { rngState: number }, arr: readonly T[]): T {
  const value = arr[rngInt(state, 0, arr.length - 1)];
  if (value === undefined) throw new Error('rngPick: empty array');
  return value;
}
