import type { Texture } from 'pixi.js';
import { GridAtlas, PixMap, frameTexture, mix, shade, sprite, type Inks } from './pixmap';

/**
 * Animated incident sprites (fire flicker, smoke puffs, bomb with a lit
 * fuse, cockroaches) in one atlas, and the cinema film reels.
 */

const FIRE_INKS: Inks = { R: 0xd02818, o: 0xf07818, Y: 0xffc838, L: 0xfff4b0 };

const FLAMES = [
  sprite([
    '....R....',
    '....R....',
    '...RoR...',
    '..R.oR...',
    '..RooRR..',
    '.RRoYoR..',
    '.RoYYoRR.',
    'RRoYLYoR.',
    'RoYLLYoRR',
    'RoYLLLYoR',
    'RoYLLLYoR',
    '.RoYLYoR.',
    '.RRoooRR.',
    '..RRRRR..',
  ]),
  sprite([
    '...R.....',
    '..RR.....',
    '..RoR..R.',
    '.RRoR..R.',
    '.RooRRRR.',
    '.RoYoRoR.',
    'RRoYYooR.',
    'RoYYLYoRR',
    'RoYLLYYoR',
    'RoYLLLYoR',
    'RoYLLLYoR',
    '.RoYLYoR.',
    '.RRoooRR.',
    '..RRRRR..',
  ]),
  sprite([
    '.....R...',
    '.....RR..',
    '.R..RoR..',
    '.R..RoRR.',
    '.RRRRooR.',
    '.RoRoYoR.',
    '.RooYYoRR',
    'RRoYLYYoR',
    'RoYYLLYoR',
    'RoYLLLYoR',
    'RoYLLLYoR',
    '.RoYLYoR.',
    '.RRoooRR.',
    '..RRRRR..',
  ]),
  sprite([
    '.........',
    '.........',
    '....R....',
    '...RR....',
    '...RoR.R.',
    '..RRoRRR.',
    '.RRoYooR.',
    '.RoYYYoR.',
    'RoYYLYYoR',
    'RoYLLLYoR',
    'RoYLLLYoR',
    '.RoYLYoR.',
    '.RRoooRR.',
    '..RRRRR..',
  ]),
];

const BOMBS = [
  sprite([
    '........Y.R',
    '.......YLY.',
    '......k.R..',
    '.....k.....',
    '...kkkk....',
    '..kKKKKk...',
    '.kKwKKKKk..',
    '.kKwKKKKk..',
    '.kKKKKKKk..',
    '..kKKKKk...',
    '...kkkk....',
  ]),
  sprite([
    '.......R...',
    '........L.Y',
    '......kY...',
    '.....k.....',
    '...kkkk....',
    '..kKKKKk...',
    '.kKwKKKKk..',
    '.kKwKKKKk..',
    '.kKKKKKKk..',
    '..kKKKKk...',
    '...kkkk....',
  ]),
];

const ROACHES = [
  sprite(['.b.b..', 'bnNnbk', 'b.b.b.']),
  sprite(['b.b.b.', 'bnNnbk', '.b.b..']),
];

export interface EffectAtlas {
  flames: Texture[];
  smoke: Texture[];
  bomb: Texture[];
  roach: Texture[];
}

let effects: EffectAtlas | null = null;

export function effectAtlas(): EffectAtlas {
  if (effects) return effects;
  const grid = new GridAtlas(13, 16, 16);
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  const put = (draw: (pm: PixMap, x: number, y: number) => { w: number; h: number }): number => {
    const at = grid.alloc();
    const size = draw(grid.pm, at.x, at.y);
    cells.push({ x: at.x, y: at.y, w: size.w, h: size.h });
    return cells.length - 1;
  };
  const flames = FLAMES.map(f => put((pm, x, y) => { pm.blit(f, x, y, { inks: FIRE_INKS }); return { w: f.w, h: f.h }; }));
  const smoke = [3, 4, 5, 6].map(r => put((pm, x, y) => {
    const d = r * 2 + 1;
    const cx = x + r, cy = y + r;
    pm.disc(cx, cy, r, 0x54585c);
    pm.disc(cx - 1, cy - 1, r - 1, 0x6c7074);
    pm.dither(x, y, d, d, 0x8a8e92);
    for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + d; xx++) {
      const dx = xx - cx, dy = yy - cy;
      if (dx * dx + dy * dy > r * r + r * 0.6) pm.clear(xx, yy);
      else if (dx + dy > r * 0.6 && pm.get(xx, yy) >= 0) pm.set(xx, yy, 0x45484c);
    }
    return { w: d, h: d };
  }));
  const bomb = BOMBS.map(b => put((pm, x, y) => { pm.blit(b, x, y, { inks: { Y: 0xffdc58, L: 0xfff4bc, R: 0xe03018 } }); return { w: b.w, h: b.h }; }));
  const roach = ROACHES.map(b => put((pm, x, y) => { pm.blit(b, x, y, { inks: { b: 0x2a160a, n: 0x6a3a18, N: 0x8a5428 } }); return { w: b.w, h: b.h }; }));
  const texture = grid.pm.texture();
  const tex = (i: number): Texture => {
    const c = cells[i]!;
    return frameTexture(texture, c.x, c.y, c.w, c.h);
  };
  effects = { flames: flames.map(tex), smoke: smoke.map(tex), bomb: bomb.map(tex), roach: roach.map(tex) };
  return effects;
}

// --- Cinema film ----------------------------------------------------------------

const FILM_SCENE_FRAMES = 10;
const filmCache = new Map<string, Texture[]>();

/** Dithered vertical gradient through a list of colours. */
function skyGradient(pm: PixMap, x: number, y: number, w: number, h: number, colors: number[]): void {
  for (let row = 0; row < h; row++) {
    const t = (row / Math.max(1, h - 1)) * (colors.length - 1);
    const i = Math.min(colors.length - 2, Math.floor(t));
    const f = t - i;
    const a = colors[i]!, b = colors[i + 1]!;
    for (let col = 0; col < w; col++) {
      // 2x2 ordered dither between the two neighbouring stops.
      const threshold = [0.125, 0.625, 0.875, 0.375][((row & 1) << 1) | (col & 1)]!;
      pm.set(x + col, y + row, f > threshold ? b : a);
    }
  }
}

function westernFrame(pm: PixMap, ox: number, oy: number, w: number, h: number, k: number): void {
  skyGradient(pm, ox, oy, w, h, [0xf0a040, 0xf8d080, 0xfff0c0]);
  pm.disc(ox + Math.floor(w * 0.7), oy + Math.floor(h * 0.45), Math.max(2, h * 0.18), 0xfff8e0);
  const ground = oy + Math.floor(h * 0.7);
  // Mesas drifting slowly left (camera pan).
  for (let i = 0; i < 3; i++) {
    const mx = ox + ((i * 70 - k * 2) % (w + 40) + w + 40) % (w + 40) - 30;
    const mh = 4 + i * 2;
    pm.rect(mx, ground - mh, 22 + i * 6, mh, 0xa04a28);
    pm.rect(mx + 3, ground - mh - 2, 14, 2, 0xa04a28);
    pm.hline(mx, ground - mh, 22 + i * 6, 0xc86a38);
  }
  pm.rect(ox, ground, w, oy + h - ground, 0xd89a50);
  pm.dither(ox, ground, w, 1, 0xc07a38);
  // A rider galloping across.
  const rx = ox + 6 + Math.floor((k / FILM_SCENE_FRAMES) * (w * 0.6));
  const up = k % 2;
  const ry = ground - 6 - up;
  pm.rect(rx, ry + 2, 7, 3, 0x3a2010);
  pm.rect(rx + 6, ry + 1, 2, 2, 0x3a2010);
  pm.set(rx + 1 + up, ry + 5, 0x3a2010); pm.set(rx + 5 - up, ry + 5, 0x3a2010);
  pm.rect(rx + 2, ry - 2, 2, 4, 0x2a1a10);
  pm.hline(rx + 1, ry - 3, 4, 0x2a1a10);
}

function spaceFrame(pm: PixMap, ox: number, oy: number, w: number, h: number, k: number): void {
  pm.rect(ox, oy, w, h, 0x080818);
  for (let i = 0; i < 40; i++) {
    const sx = ((i * 53 - k * (1 + (i % 3))) % w + w) % w;
    const sy = (i * 37) % h;
    pm.set(ox + sx, oy + sy, i % 4 ? 0x9098c0 : 0xffffff);
  }
  // Planet.
  const px = ox + w - 18, py = oy + h - 2;
  pm.disc(px, py, Math.max(4, h * 0.45), 0x3a5aa8);
  pm.disc(px - 2, py - 2, Math.max(3, h * 0.35), 0x5a7ac8);
  // Rocket crossing the frame.
  const rx = ox + 4 + Math.floor((k / FILM_SCENE_FRAMES) * (w * 0.55));
  const ry = oy + Math.floor(h * 0.35);
  pm.rect(rx, ry, 10, 4, 0xe0e0e8);
  pm.hline(rx, ry, 10, 0xffffff);
  pm.rect(rx + 10, ry + 1, 2, 2, 0xd03028);
  pm.set(rx + 3, ry + 1, 0x3464bc);
  pm.rect(rx - 2, ry - 1, 3, 1, 0xd03028); pm.rect(rx - 2, ry + 4, 3, 1, 0xd03028);
  pm.rect(rx - 3 - (k % 2), ry + 1, 3 + (k % 2), 2, 0xffc838);
  pm.set(rx - 4 - (k % 2), ry + 1, 0xf07818);
}

function oceanFrame(pm: PixMap, ox: number, oy: number, w: number, h: number, k: number): void {
  skyGradient(pm, ox, oy, w, Math.floor(h * 0.55), [0x4a8ad8, 0x8cc8f0, 0xd0ecff]);
  const sea = oy + Math.floor(h * 0.55);
  pm.rect(ox, sea, w, oy + h - sea, 0x1e5a9a);
  for (let row = sea; row < oy + h; row += 2) {
    for (let x = 0; x < w; x++) {
      if (((x + k * 2 + row * 3) % 12) < 3) pm.set(ox + x, row, 0x68acdc);
    }
  }
  // Sailboat bobbing.
  const bx = ox + Math.floor(w * 0.35) + Math.floor(k / 2);
  const by = sea - 1 + (k % 4 < 2 ? 0 : 1);
  pm.rect(bx, by, 12, 2, 0x8a4a22);
  pm.hline(bx + 1, by + 2, 10, 0x5a3010);
  pm.vline(bx + 6, by - 9, 9, 0x5a3010);
  for (let i = 0; i < 8; i++) pm.hline(bx + 7, by - 9 + i, Math.min(5, 1 + Math.floor(i * 0.7)), 0xffffff);
  // Gull.
  const gx = ox + w - 10 - k * 2, gy = oy + 3 + (k % 3);
  pm.set(gx, gy, 0x26262a); pm.set(gx + 1, gy + 1, 0x26262a); pm.set(gx + 2, gy, 0x26262a);
}

/** Film frames for a w x h screen (cached; one atlas strip per size). */
export function filmFrames(w: number, h: number): Texture[] {
  const key = `${w}x${h}`;
  const cached = filmCache.get(key);
  if (cached) return cached;
  const scenes = [westernFrame, spaceFrame, oceanFrame];
  const count = scenes.length * FILM_SCENE_FRAMES;
  const pm = new PixMap(w, (h + 1) * count);
  let i = 0;
  for (const scene of scenes) {
    for (let k = 0; k < FILM_SCENE_FRAMES; k++, i++) {
      const y = i * (h + 1);
      scene(pm, 0, y, w, h, k);
      // Projector vignette: darkened edges and a faint scanline.
      pm.map(c => shade(c, 0.25), 0, y, w, 1);
      pm.map(c => shade(c, 0.25), 0, y + h - 1, w, 1);
      pm.map(c => shade(c, 0.18), 0, y, 1, h);
      pm.map(c => shade(c, 0.18), w - 1, y, 1, h);
      if (k === 0) pm.map(c => mix(c, 0xffffff, 0.35), 0, y, w, h);
    }
  }
  const texture = pm.texture();
  const frames: Texture[] = [];
  for (let f = 0; f < count; f++) frames.push(frameTexture(texture, 0, f * (h + 1), w, h));
  filmCache.set(key, frames);
  return frames;
}

// --- Rooftop pool ripples ----------------------------------------------------------

const RIPPLE_FRAMES = 8;
const rippleCache = new Map<string, Texture[]>();

/** Shimmer overlay frames for a w x h water surface (transparent elsewhere). */
export function rippleFrames(w: number, h: number): Texture[] {
  const key = `${w}x${h}`;
  const cached = rippleCache.get(key);
  if (cached) return cached;
  const pm = new PixMap(w, (h + 1) * RIPPLE_FRAMES);
  for (let k = 0; k < RIPPLE_FRAMES; k++) {
    const y0 = k * (h + 1);
    for (let x = 0; x < w; x++) {
      if ((x + k * 2) % 14 < 4) pm.set(x, y0, 0xe4f8ff);
      if (h > 1 && (x - k * 2 + 700) % 14 < 3) pm.set(x, y0 + 1, 0x9fdcf4);
    }
    // Caustic sparkles drifting through the body of the water.
    for (let i = 0; i < Math.floor(w / 9); i++) {
      const sx = (i * 37 + k * 3 + (i % 3) * k) % w;
      const sy = 2 + ((i * 13 + (k >> 1)) % Math.max(1, h - 3));
      if (sy < h) { pm.set(sx, y0 + sy, 0x6ac4f0); pm.set(sx + 1, y0 + sy, 0x6ac4f0); }
    }
  }
  const texture = pm.texture();
  const frames: Texture[] = [];
  for (let f = 0; f < RIPPLE_FRAMES; f++) frames.push(frameTexture(texture, 0, f * (h + 1), w, h));
  rippleCache.set(key, frames);
  return frames;
}
