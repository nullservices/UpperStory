/**
 * Picking people under the pointer. The people renderer records where it drew
 * each pickable figure (top-left in world px) during its normal draw pass;
 * this pure helper chooses the figure nearest a click. Kept free of PixiJS so
 * it is unit-testable.
 */

/** Figures drawn last frame: `count` entries of id and top-left world x/y. */
export interface DrawnPeople {
  count: number;
  ids: Int32Array;
  xs: Float32Array;
  ys: Float32Array;
}

/**
 * Id of the figure (w×h world px) whose box, grown by `radius`, contains
 * (wx, wy) and whose centre is closest to it; -1 when none.
 */
export function pickNearest(drawn: DrawnPeople, wx: number, wy: number, w: number, h: number, radius: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < drawn.count; i++) {
    const x = drawn.xs[i]!, y = drawn.ys[i]!;
    if (wx < x - radius || wx > x + w + radius || wy < y - radius || wy > y + h + radius) continue;
    const dx = wx - (x + w / 2), dy = wy - (y + h / 2);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = drawn.ids[i]!; }
  }
  return best;
}

/** Append one figure, growing the buffers as needed. */
export function recordDrawn(drawn: DrawnPeople, id: number, x: number, y: number): void {
  if (drawn.count >= drawn.ids.length) {
    const size = Math.max(64, drawn.ids.length * 2);
    const ids = new Int32Array(size); ids.set(drawn.ids);
    const xs = new Float32Array(size); xs.set(drawn.xs);
    const ys = new Float32Array(size); ys.set(drawn.ys);
    drawn.ids = ids; drawn.xs = xs; drawn.ys = ys;
  }
  drawn.ids[drawn.count] = id;
  drawn.xs[drawn.count] = x;
  drawn.ys[drawn.count] = y;
  drawn.count++;
}

export function emptyDrawn(): DrawnPeople {
  return { count: 0, ids: new Int32Array(0), xs: new Float32Array(0), ys: new Float32Array(0) };
}
