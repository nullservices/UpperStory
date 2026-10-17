/**
 * Current room lighting tints, published by the floor view whenever it
 * re-tints the rooms (night bucket, lit set or blackout flicker changed) and
 * read by the people view so figures inside a dark room dim with it.
 * Purely presentational.
 */
export const roomLighting = {
  /** Tint per tenant id (0xffffff = full daylight). */
  rooms: new Map<number, number>(),
  /** Tint for people out in the open (corridors, lobbies, shafts): white unless the power is out. */
  open: 0xffffff,
  /** Tint for unlit structure (empty floor, stairwells, elevator shafts) after dark or in a blackout. */
  structure: 0xffffff,
};
