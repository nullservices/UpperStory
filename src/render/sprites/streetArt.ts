import type { Texture } from 'pixi.js';
import { accent } from './furniture';
import { PixMap, shade, sprite, tint } from './pixmap';

/**
 * Street-level pixel props: a compact side-on car (A = body colour), round
 * street trees in three sizes and a lamp post. Origins: cars are anchored at
 * their road-contact centre, trees and lamps at the base of the trunk/post.
 */

const STREET_CAR = sprite([
  '.........kkkkkkkk.........',
  '........kqCCkCCCcqk.......',
  '.......kqCCckCCccqqk......',
  '..kkkkkqqqqqqqqqqqqqkkkk..',
  '.kqqqqqqqqqqqqqqqqqqqqqqk.',
  'kAAAAAAAAAAAAkAAAAAAAAAAYk',
  'RAAAAAAAAAAAAkAAAAAAAAAAAk',
  'kaakkkkaaaaaaaaaaakkkkaaak',
  '.kkKgGKkkkkkkkkkkkKgGKkkk.',
  '...KwGK..........KwGK.....',
  '....KK............KK......',
]);

export const STREET_CAR_W = STREET_CAR.w;
export const STREET_CAR_H = STREET_CAR.h;

const cars = new Map<number, Texture>();

export function streetCarTexture(color: number): Texture {
  let tex = cars.get(color);
  if (!tex) {
    const pm = new PixMap(STREET_CAR.w, STREET_CAR.h);
    pm.blit(STREET_CAR, 0, 0, { inks: accent(color) });
    tex = pm.texture();
    cars.set(color, tex);
  }
  return tex;
}

const trees = new Map<number, Texture>();

/** Round street tree; size 0..2. Texture is 17 wide, trunk base at bottom centre. */
export function treeTexture(size: number): Texture {
  let tex = trees.get(size);
  if (tex) return tex;
  const r = 4 + size;
  const trunk = 6 + size * 2;
  const w = 17, h = r * 2 + trunk + 1;
  const pm = new PixMap(w, h);
  const cx = 8, cy = r;
  pm.rect(cx - 1, cy + r - 2, 2, trunk + 3, 0x6b4426);
  pm.vline(cx, cy + r - 2, trunk + 3, 0x8a5a34);
  pm.disc(cx, cy, r, 0x24602a);
  pm.disc(cx - 2, cy + 1, r - 1.5, 0x2f7d25);
  pm.disc(cx + 2, cy + 1, r - 2, 0x2f7d25);
  pm.disc(cx - 1, cy - 1, r - 2.5, 0x44a03a);
  pm.dither(cx - r, cy - r, r, r, 0x6cc44a);
  // Keep the highlight dither only on leaves.
  pm.map((c, x, y) => {
    const dx = x - (cx - 1), dy = y - (cy - 1);
    return c === 0x6cc44a && dx * dx + dy * dy > (r - 2.5) * (r - 2.5) ? 0x44a03a : c;
  }, 0, 0, w, cy + r);
  for (let y = 0; y < cy + r + 1; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    if (pm.get(x, y) >= 0 && dx * dx + dy * dy > r * r + r * 0.6 && !(x >= cx - 1 && x <= cx && y > cy)) pm.clear(x, y);
  }
  pm.set(cx + 2, cy + 3, shade(0x24602a, 0.2));
  tex = pm.texture();
  trees.set(size, tex);
  return tex;
}

let lampTex: Texture | null = null;

/** Lamp post 7 x 21, base at bottom; the lamp head is at (3, 1). */
export function lampTexture(): Texture {
  if (lampTex) return lampTex;
  const pm = new PixMap(7, 21);
  pm.vline(3, 2, 19, 0x4a4f5a);
  pm.vline(4, 3, 18, tint(0x4a4f5a, 0.25));
  pm.rect(0, 0, 7, 2, 0x4a4f5a);
  pm.hline(1, 2, 5, 0xf2eccc);
  pm.rect(2, 19, 4, 2, 0x3a3f4a);
  lampTex = pm.texture();
  return lampTex;
}
