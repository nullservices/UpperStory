import { BufferImageSource, Rectangle, Texture } from 'pixi.js';

/**
 * Pixel-art core. Sprites are authored as palette-indexed character maps
 * (one character per world pixel, '.' or ' ' transparent) and composed into
 * RGBA PixMaps, which are baked once into nearest-sampled textures. Every
 * sprite in the game is original art authored in these files.
 *
 * Coordinates are integer world pixels: a cell is 8 px wide and a floor
 * band 24 px tall, so a sprite drawn here maps 1:1 onto the tower grid and
 * stays crisp at every zoom (nearest-neighbour magnification).
 */

/** Shared ink palette: a SimTower-era 256-colour feel, a few shades per hue. */
export const INK: Record<string, number> = {
  k: 0x16161a, // outline black
  K: 0x3a3a42, // charcoal
  g: 0x6c6c74, // grey
  G: 0x9c9ca4, // light grey
  w: 0xcfd0d4, // silver
  W: 0xffffff, // white
  b: 0x45280f, // dark wood
  n: 0x7a4a22, // wood
  N: 0xa86c36, // light wood
  m: 0xd09a58, // pale wood
  y: 0xd0a028, // gold
  Y: 0xffdc58, // yellow
  L: 0xfff4bc, // lamp light
  r: 0x7c1820, // dark red
  R: 0xc83030, // red
  p: 0xec80a0, // pink
  o: 0xe07020, // orange
  v: 0x1c3070, // navy
  B: 0x3464bc, // blue
  c: 0x68acdc, // screen / sky
  C: 0xbce2f8, // glass highlight
  e: 0x24582a, // dark green
  E: 0x44a03a, // green
  l: 0x8cd05c, // light green
  s: 0xf2bc94, // skin
  S: 0x9c6440, // skin dark
  h: 0x3a2212, // hair
  u: 0x5c2c88, // purple
  t: 0xe2d2a8, // beige
  T: 0xac9a70, // tan
  // Accent slots, recoloured per variant at blit time (defaults shown).
  A: 0x3c6cc0,
  a: 0x24448a,
  q: 0x6c90d4,
  Z: 0xd04040,
  z: 0x902828,
  // Clothing slots used by the people atlas.
  H: 0x3a2212, // hair
  J: 0x2c3c64, // top
  j: 0x1c2848, // top shade
  X: 0xf4f4f4, // collar / accent
  P: 0x23283a, // trousers
  F: 0x18181c, // shoes
};

export type Inks = Record<string, number>;

/** A parsed character-map sprite (codes are char codes, 0 = transparent). */
export interface PixelSprite {
  readonly w: number;
  readonly h: number;
  readonly codes: Uint8Array;
}

/** Parse a character map. Rows may differ in length (padded transparent). */
export function sprite(rows: readonly string[]): PixelSprite {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const h = rows.length;
  const codes = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch !== '.' && ch !== ' ') codes[y * w + x] = ch.charCodeAt(0);
    }
  });
  return { w, h, codes };
}

export interface BlitOptions {
  /** Mirror horizontally. */
  flip?: boolean;
  /** Per-call ink overrides (accent slots, clothing). */
  inks?: Inks;
}

/** Linear RGB blend of two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
export const shade = (c: number, t: number): number => mix(c, 0x000000, t);
export const tint = (c: number, t: number): number => mix(c, 0xffffff, t);

/** An RGBA pixel buffer with a handful of pixel-art drawing primitives. */
export class PixMap {
  readonly data: Uint8Array;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8Array(Math.max(1, w * h * 4));
  }

  set(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = (color >> 16) & 0xff; d[i + 1] = (color >> 8) & 0xff; d[i + 2] = color & 0xff; d[i + 3] = 255;
  }

  /** Colour at (x, y), or -1 when transparent / out of bounds. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    return d[i + 3] ? (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]! : -1;
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  rect(x: number, y: number, w: number, h: number, color: number): this {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, color);
    return this;
  }

  hline(x: number, y: number, w: number, color: number): this { return this.rect(x, y, w, 1, color); }
  vline(x: number, y: number, h: number, color: number): this { return this.rect(x, y, 1, h, color); }

  /** 1 px Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, color: number): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled pixel disc. */
  disc(cx: number, cy: number, r: number, color: number): this {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + r * 0.6) this.set(x, y, color);
      }
    }
    return this;
  }

  /** 50% checkerboard of `color` over the region (classic dither). */
  dither(x: number, y: number, w: number, h: number, color: number, phase = 0): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (((xx + yy + phase) & 1) === 0) this.set(xx, yy, color);
    return this;
  }

  /** Sparse 25% ordered dither (every other pixel on every other row). */
  sparse(x: number, y: number, w: number, h: number, color: number, phase = 0): this {
    for (let yy = y; yy < y + h; yy++) {
      if (((yy + phase) & 1) !== 0) continue;
      for (let xx = x; xx < x + w; xx++) if (((xx + (yy >> 1) + phase) & 1) === 0) this.set(xx, yy, color);
    }
    return this;
  }

  /** Recolour every opaque pixel in the region through `fn`. */
  map(fn: (color: number, x: number, y: number) => number, x = 0, y = 0, w = this.w, h = this.h): this {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const c = this.get(xx, yy);
        if (c >= 0) this.set(xx, yy, fn(c, xx, yy));
      }
    }
    return this;
  }

  /** Blend opaque pixels toward `color` by t. */
  wash(color: number, t: number, x = 0, y = 0, w = this.w, h = this.h): this {
    return this.map(c => mix(c, color, t), x, y, w, h);
  }

  /** Draw a sprite with its top-left at (x, y). */
  blit(s: PixelSprite, x: number, y: number, opts: BlitOptions = {}): this {
    const inks = opts.inks;
    const x0 = Math.round(x), y0 = Math.round(y);
    let lastCode = -1, lastColor = 0;
    for (let sy = 0; sy < s.h; sy++) {
      for (let sx = 0; sx < s.w; sx++) {
        const code = s.codes[sy * s.w + (opts.flip ? s.w - 1 - sx : sx)]!;
        if (!code) continue;
        if (code !== lastCode) {
          const ch = String.fromCharCode(code);
          lastColor = inks?.[ch] ?? INK[ch] ?? 0xff00ff;
          lastCode = code;
        }
        this.set(x0 + sx, y0 + sy, lastColor);
      }
    }
    return this;
  }

  /** Draw a sprite so its bottom row sits on row `base - 1`. */
  stand(s: PixelSprite, x: number, base: number, opts?: BlitOptions): this {
    return this.blit(s, x, base - s.h, opts);
  }

  /** Copy a region of another PixMap (opaque pixels only). */
  paste(src: PixMap, dx: number, dy: number, sx = 0, sy = 0, w = src.w, h = src.h): this {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = src.get(sx + x, sy + y);
      if (c >= 0) this.set(dx + x, dy + y, c);
    }
    return this;
  }

  /** Bake into a nearest-sampled texture (the PixMap must not change after). */
  texture(): Texture {
    return bakeTexture(this.data, this.w, this.h);
  }
}

/** A nearest-sampled texture over an RGBA byte buffer. */
export function bakeTexture(data: Uint8Array, w: number, h: number): Texture {
  const source = new BufferImageSource({
    resource: data,
    width: w,
    height: h,
    scaleMode: 'nearest',
    autoGenerateMipmaps: false,
  });
  return new Texture({ source });
}

/** Frame textures cut from one atlas source (one batch for all of them). */
export function frameTexture(atlas: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: atlas.source, frame: new Rectangle(x, y, w, h) });
}

/**
 * Simple grid atlas: fixed-size cells with a 1 px transparent gutter so
 * nearest sampling at fractional zoom never bleeds a neighbour frame in.
 */
export class GridAtlas {
  readonly pm: PixMap;
  private next = 0;
  readonly cols: number;
  constructor(readonly cellW: number, readonly cellH: number, count: number) {
    this.cols = Math.max(1, Math.min(count, Math.floor(2048 / (cellW + 1))));
    const rows = Math.ceil(count / this.cols);
    this.pm = new PixMap(this.cols * (cellW + 1) + 1, rows * (cellH + 1) + 1);
  }
  /** Reserve the next cell; returns its top-left. */
  alloc(): { x: number; y: number } {
    const i = this.next++;
    return { x: 1 + (i % this.cols) * (this.cellW + 1), y: 1 + Math.floor(i / this.cols) * (this.cellH + 1) };
  }
}

/** Deterministic small hash (for variant / per-instance choices). */
export function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
