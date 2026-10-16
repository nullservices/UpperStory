import type { Texture } from 'pixi.js';
import { PixMap, frameTexture } from './pixmap';

/**
 * Pixel-art cumulus clouds (original art): three shapes, large / medium /
 * small, each a flat-bottomed stack of puffs with a bright sunlit crown, a
 * body tone, a dithered shade band and a darker underside. Painted in near
 * whites so the sky view can tint them for dawn, dusk and night.
 */

const HIGHLIGHT = 0xffffff;
const BODY = 0xf0f5fc;
const SHADE = 0xd2e0f2;
const UNDER = 0xb4c6e0;

/** Puffs as [cx, cy, r] over a flat base at row `base`. */
interface CloudShape {
  w: number;
  h: number;
  base: number;
  puffs: readonly (readonly [number, number, number])[];
}

const SHAPES: readonly CloudShape[] = [
  { w: 64, h: 26, base: 23, puffs: [[12, 17, 7], [24, 11, 9], [38, 9, 9], [50, 15, 7], [57, 19, 5], [6, 20, 4]] },
  { w: 46, h: 20, base: 17, puffs: [[9, 12, 6], [20, 8, 7.5], [32, 10, 6.5], [40, 14, 4.5]] },
  { w: 32, h: 15, base: 12, puffs: [[8, 8, 4.5], [17, 6, 5.5], [25, 9, 4]] },
];

export interface CloudArt {
  texture: Texture;
  w: number;
  h: number;
}

let clouds: CloudArt[] | null = null;

function paintCloud(pm: PixMap, ox: number, shape: CloudShape): void {
  const inside = (x: number, y: number): boolean => {
    if (y > shape.base) return false;
    for (const [cx, cy, r] of shape.puffs) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r + r * 0.6) return true;
    }
    // Flat base slab joining the puffs.
    const first = shape.puffs[0]!, last = shape.puffs[shape.puffs.length - 1]!;
    return y >= shape.base - 4 && x >= first[0] - first[2] + 2 && x <= last[0] + last[2] - 2;
  };
  for (let y = 0; y < shape.h; y++) {
    for (let x = 0; x < shape.w; x++) {
      if (!inside(x, y)) continue;
      const fromBase = shape.base - y;
      let color = BODY;
      if (fromBase <= 0) color = UNDER;
      else if (fromBase <= 2) color = SHADE;
      else if (fromBase === 3 && ((x + y) & 1) === 0) color = SHADE;
      // Sunlit crown: the top edge (and a second row toward the upper left).
      if (!inside(x, y - 1) || (!inside(x - 1, y - 1) && !inside(x, y - 2))) color = HIGHLIGHT;
      // Shaded right flank on the lower half.
      else if (!inside(x + 1, y) && fromBase <= 6) color = SHADE;
      pm.set(ox + x, y, color);
    }
  }
}

/** The three cloud shapes, largest first (one shared atlas). */
export function cloudArt(): CloudArt[] {
  if (clouds) return clouds;
  const total = SHAPES.reduce((sum, s) => sum + s.w + 1, 0);
  const pm = new PixMap(total, Math.max(...SHAPES.map(s => s.h)));
  const offsets: number[] = [];
  let ox = 0;
  for (const shape of SHAPES) {
    offsets.push(ox);
    paintCloud(pm, ox, shape);
    ox += shape.w + 1;
  }
  const texture = pm.texture();
  clouds = SHAPES.map((shape, i) => ({ texture: frameTexture(texture, offsets[i]!, 0, shape.w, shape.h), w: shape.w, h: shape.h }));
  return clouds;
}
