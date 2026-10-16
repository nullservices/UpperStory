/**
 * Render-side ambience shared between views drawn in one frame: the day/night
 * view publishes the clock minute, and the screen-space sky (which has no
 * game-state input) reads it to pick its gradient. Purely presentational.
 */
export const ambient = {
  /** Minute of day from the last day/night draw (420..1860; noon default). */
  minuteOfDay: 720,
  /**
   * Halloween full moon (screen px, top-left + drawn size), published by the
   * incident view on a witch day and drawn by the sky behind the tower.
   */
  moon: null as { x: number; y: number; size: number } | null,
};
