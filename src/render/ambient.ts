import type { Texture } from 'pixi.js';

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
  /** Screen y of the street line (world y = 0), published by the day/night view; null before the first frame. */
  horizonY: null as number | null,
  moon: null as { x: number; y: number; size: number } | null,
  /**
   * Seasonal flyover (Santa's sleigh, the witch) in screen px, published by
   * the incident view and drawn by the sky so the flyer passes BEHIND the
   * tower; `sparkles` is a reused list of [x, y, color, alpha] trail dots.
   */
  flyer: {
    visible: false,
    texture: null as Texture | null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    sparkles: [] as [number, number, number, number][],
    sparkleCount: 0,
  },
};
