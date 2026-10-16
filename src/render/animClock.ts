import type { GameState } from '../sim';

/**
 * Render-side animation clock (milliseconds). It advances with real time
 * only while the simulation clock moves, so flames, walk cycles, the cinema
 * film and street traffic freeze whenever the game is paused or a modal
 * dialog holds the sim (main.ts stops feeding `acc`, so tickCount + alpha
 * stops changing). Views that receive the frame's interpolation alpha call
 * `advanceAnimClock`; it is idempotent within a frame, so several views can
 * call it. Views without alpha read `animTime()` (one frame behind at most).
 */
let animMs = 0;
let lastGameTime = Number.NaN;
let lastNow = -1;

export function advanceAnimClock(state: GameState, alpha: number): number {
  const now = typeof performance === 'undefined' ? 0 : performance.now();
  const game = state.tickCount + alpha;
  if (lastNow >= 0 && game !== lastGameTime) animMs += Math.min(100, Math.max(0, now - lastNow));
  lastGameTime = game;
  lastNow = now;
  return animMs;
}

export function animTime(): number {
  return animMs;
}
